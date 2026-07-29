/**
 * useLiveSession — React hook that manages the live collaboration session
 * for Monaco editors. Bridges the Zustand store with Yjs CRDT sync.
 *
 * Responsibilities:
 *   - Create/destroy Y.Doc and LiveSyncProvider when wsUrl changes
 *   - Seed initial content from workspace payload into Y.Text fields
 *   - Bidirectional sync between Yjs and Zustand store (with re-entrancy guard)
 *   - MonacoBinding lifecycle per editor instance
 *   - Tab switching support (rebind to correct Y.Text field)
 */

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import type * as _monaco from "monaco-editor";
import type { Awareness } from "y-protocols/awareness";
import { useWorkspace, activeWorkspace, updateWorkspaceById } from "./store";
import type { WorkspaceEntry } from "./share";
import { LiveSyncProviderImpl } from "./liveSyncProvider";

// ── Y.Text field naming convention ─────────────────────────────────────────

/** Returns the Y.Text field name for a subgraph at the given index. */
function sgField(index: number): string {
  return `sg-${index}`;
}

/** Returns the Y.Text field name for a query tab at the given index. */
function queryField(index: number): string {
  return `query-${index}`;
}

/** Field name for mock config YAML. */
const MOCK_CONFIG_FIELD = "mock-config";

/**
 * Y.Array field tracking the ordered list of subgraph names. Per-field sync
 * (observeHandler/seedDoc below) only ever touches fields a client already
 * knows about locally — a joiner's minimal "(collaboration)" template starts
 * with just one subgraph, and would never discover a host's second one
 * without this: reconcileSubgraphNames watches this array and grows/shrinks
 * the store's subgraphs array to match, pulling each new entry's content
 * straight from its already-synced Y.Text field.
 */
const SUBGRAPH_NAMES_FIELD = "subgraph-names";
/** Same, for query tabs. */
const QUERY_TAB_NAMES_FIELD = "query-tab-names";

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Destroy every tracked MonacoBinding (unsubscribes its Yjs/Monaco listeners) and empty the map. */
function destroyAllBindings(bindings: Map<string, MonacoBinding>): void {
  for (const binding of bindings.values()) {
    binding.destroy();
  }
  bindings.clear();
}

/**
 * Patch the workspace a live session is pinned to, by id — never the
 * currently active one, which may differ once the user switches away or
 * creates a new workspace while the session keeps running in the
 * background. `computePatch` receives the pinned workspace's current
 * (fresh, not render-stale) state.
 */
function patchPinnedWorkspace(
  pinnedId: string,
  computePatch: (current: WorkspaceEntry) => Partial<WorkspaceEntry>,
): void {
  useWorkspace.setState((state) => {
    const target = state.workspaces.find((w) => w.id === pinnedId);
    if (!target) return {};
    return updateWorkspaceById(state, pinnedId, computePatch(target));
  });
}

// ── Hook ───────────────────────────────────────────────────────────────────

export interface UseLiveSessionResult {
  /** Whether live sync is currently active (provider exists and connected). */
  isActive: boolean;
  /** Connection status for UI indicator. */
  status: "connecting" | "connected" | "disconnected";
  /**
   * Whether the initial sync handshake has completed — i.e. we know for
   * certain what the session already had. Callers MUST wait for this before
   * calling bindEditor: MonacoBinding's constructor forcibly reconciles the
   * model to match Y.Text if they differ, and binding before this is true
   * means Y.Text is still empty (pre-sync), so it would wipe out whatever
   * content the model already had (from the store's `value=` prop) — content
   * that may never come back, since the fields it discards don't
   * necessarily get another chance to resync (a joiner's tab whose default
   * name coincidentally matches the host's, e.g. both "Query 1", never
   * triggers reconcile*Names' rebuild-from-scratch path, since a name match
   * short-circuits it — see reconcileQueryTabNames).
   */
  synced: boolean;
  /** Awareness instance for remote cursor rendering. */
  awareness: Awareness | null;
  /** Bind a Monaco editor to a Y.Text field. Returns cleanup function. */
  bindEditor: (
    editor: _monaco.editor.IStandaloneCodeEditor,
    model: _monaco.editor.ITextModel,
    fieldName: string,
  ) => () => void;
  /** Set local awareness state (user info for cursors). */
  setLocalState: (state: Record<string, unknown> | null) => void;
  /** Destroy the provider and clean up all bindings. */
  destroy: () => void;
}

/**
 * Manage a live collaboration session. Only activates when `wsUrl` is provided.
 *
 * @param wsUrl WebSocket URL from POST /api/live-session, or null for solo mode.
 */
export function useLiveSession(wsUrl: string | null): UseLiveSessionResult {
  const providerRef = useRef<LiveSyncProviderImpl | null>(null);
  const bindingsRef = useRef<Map<string, MonacoBinding>>(new Map());
  const isSyncingRef = useRef(false); // re-entrancy guard

  // Real state (not refs) for anything the returned result exposes — refs mutated in
  // event callbacks don't trigger a re-render, so a ref-backed status/awareness would
  // silently freeze at whatever it was on first render instead of reflecting reality.
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  // Gates the re-seed effect below: pushing local structural/content changes
  // into the Y.Doc before the initial sync confirms what the session already
  // had would race it the same way seeding did (see provider.on("synced")).
  const [synced, setSynced] = useState(false);

  // Read the workspace this session is pinned to (set when it started/was
  // joined) — NOT necessarily the currently active one. Sync must stay
  // scoped to that one workspace regardless of what the user switches to or
  // creates afterward, since Y.Text field names are index-based ("sg-0"),
  // not workspace-scoped, and would otherwise happily mix content from an
  // unrelated workspace into the shared session. Falls back to whatever's
  // active only if the pinned workspace can't be found (e.g. deleted).
  const pinnedWorkspaceId = useWorkspace((s) => s.liveSession.workspaceId);
  const ws = useWorkspace(
    (s) => s.workspaces.find((w) => w.id === pinnedWorkspaceId) ?? activeWorkspace(s),
  );

  // ── Provider lifecycle ──────────────────────────────────────────────────

  useEffect(() => {
    // Captured once so the cleanup below reads the same Map instance the effect body
    // used, rather than dereferencing the ref (which could point elsewhere by the time
    // cleanup runs) — the ref's `.current` itself is never reassigned, only mutated in
    // place, but this keeps the effect and its cleanup unambiguously in sync.
    const bindings = bindingsRef.current;

    if (!wsUrl) {
      // Solo mode — no provider needed
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }
      // Clean up all bindings
      destroyAllBindings(bindings);
      // Synchronizing local state with this effect's own external resource (the
      // provider), not deriving from props/state — safe to set directly.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("disconnected");
      setAwareness(null);
      setSynced(false);
      return;
    }

    // Create provider with existing doc or new one
    const provider = new LiveSyncProviderImpl(wsUrl);
    providerRef.current = provider;
    setStatus("connecting");
    setAwareness(provider.awareness);
    setSynced(false);

    // Listen for status changes
    provider.on("status", ({ status }) => {
      setStatus(status);
    });

    // Seed default content only after the initial sync tells us for certain
    // whether the session already had some — seeding before that (into a
    // session another client already populated) creates two independent
    // concurrent insertions that Yjs merges as a duplicate, not a no-op.
    // seedDoc()'s own per-field emptiness check then does the right thing
    // either way: skip fields the sync already filled, seed the rest.
    provider.on("synced", () => {
      seedDoc(provider.doc, ws);
      setSynced(true);
    });

    // Sync Yjs → Zustand store, one observer per field. A Y.Text observer
    // can fire with an empty event.delta — nothing actually changed for
    // THIS field — when an unrelated part of the same sync transaction
    // (e.g. another field in the same handshake message) touches the doc.
    // Skipping on an empty delta matters: without it, a spurious fire
    // reads/writes this field's content on every unrelated change too,
    // which — combined with the fact this can happen before this specific
    // field has actually been seeded — was overwriting real content with a
    // premature empty read.
    const fieldObserver =
      (write: (content: string) => void) =>
      (event: Y.YTextEvent): void => {
        if (isSyncingRef.current || !pinnedWorkspaceId || event.delta.length === 0) return;
        isSyncingRef.current = true;
        try {
          write((event.target as Y.Text).toString());
        } finally {
          isSyncingRef.current = false;
        }
      };

    const registerObservers = () => {
      const doc = provider.doc;

      ws.subgraphs.forEach((_, i) => {
        doc.getText(sgField(i)).observe(
          fieldObserver((sdl) => {
            patchPinnedWorkspace(pinnedWorkspaceId!, (cur) => ({
              subgraphs: cur.subgraphs.map((sg, idx) => (idx === i ? { ...sg, sdl } : sg)),
            }));
          }),
        );
      });

      ws.queryTabs.forEach((_, i) => {
        doc.getText(queryField(i)).observe(
          fieldObserver((query) => {
            patchPinnedWorkspace(pinnedWorkspaceId!, (cur) => ({
              queryTabs: cur.queryTabs.map((t, idx) => (idx === i ? { ...t, query } : t)),
            }));
          }),
        );
      });

      doc.getText(MOCK_CONFIG_FIELD).observe(
        fieldObserver((mockConfig) => {
          patchPinnedWorkspace(pinnedWorkspaceId!, () => ({ mockConfig }));
        }),
      );
    };

    registerObservers();

    // Discover subgraphs/query tabs this client doesn't know about locally
    // yet — a joiner's minimal template starts with one of each, and would
    // otherwise never learn the host has more. Fires for any change to the
    // names arrays, including the one the initial sync handshake produces
    // (its applyUpdate call triggers this synchronously, same as any other
    // Yjs observer), so a joiner's tab list is complete as soon as it syncs.
    const reconcileSubgraphNames = () => {
      if (isSyncingRef.current || !pinnedWorkspaceId) return;
      isSyncingRef.current = true;
      try {
        const doc = provider.doc;
        const names = doc.getArray<string>(SUBGRAPH_NAMES_FIELD).toArray();
        if (names.length === 0) return;
        patchPinnedWorkspace(pinnedWorkspaceId, (cur) => {
          const currentNames = cur.subgraphs.map((sg) => sg.name);
          if (arraysEqual(currentNames, names)) return {};
          // Always pull content fresh from Y.Text rather than reusing an
          // existing entry just because its name happens to match at this
          // position — a joiner's placeholder tab can coincidentally share
          // a name with the host's (e.g. both default to "Query 1") while
          // holding completely different (stale, empty) content locally.
          const subgraphs = names.map((name, i) => ({
            name,
            sdl: doc.getText(sgField(i)).toString(),
          }));
          return {
            subgraphs,
            activeSubgraph: Math.min(cur.activeSubgraph, subgraphs.length - 1),
          };
        });
      } finally {
        isSyncingRef.current = false;
      }
    };

    const reconcileQueryTabNames = () => {
      if (isSyncingRef.current || !pinnedWorkspaceId) return;
      isSyncingRef.current = true;
      try {
        const doc = provider.doc;
        const names = doc.getArray<string>(QUERY_TAB_NAMES_FIELD).toArray();
        if (names.length === 0) return;
        patchPinnedWorkspace(pinnedWorkspaceId, (cur) => {
          const currentNames = cur.queryTabs.map((t) => t.name);
          if (arraysEqual(currentNames, names)) return {};
          // See reconcileSubgraphNames for why content is always pulled
          // fresh rather than reused when a name happens to match.
          const queryTabs = names.map((name, i) => ({
            name,
            query: doc.getText(queryField(i)).toString(),
          }));
          return {
            queryTabs,
            activeQueryTab: Math.min(cur.activeQueryTab, queryTabs.length - 1),
          };
        });
      } finally {
        isSyncingRef.current = false;
      }
    };

    provider.doc.getArray<string>(SUBGRAPH_NAMES_FIELD).observe(reconcileSubgraphNames);
    provider.doc.getArray<string>(QUERY_TAB_NAMES_FIELD).observe(reconcileQueryTabNames);

    return () => {
      provider.destroy();
      providerRef.current = null;
      destroyAllBindings(bindings);
      setStatus("disconnected");
      setAwareness(null);
      setSynced(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // ── Re-seed when workspace changes (non-live edits) ─────────────────────

  useEffect(() => {
    // Gated on `synced`, not just providerRef/wsUrl: pushing local state
    // into the Y.Doc before the initial sync confirms what the session
    // already had races it the same way seeding did (see provider.on
    // ("synced") above) — a joiner's local names/content would otherwise
    // get pushed out before the host's real ones ever arrive.
    if (!providerRef.current || !wsUrl || !synced || !pinnedWorkspaceId) return;
    const doc = providerRef.current.doc;

    // Guard against re-entrancy: only re-seed if this change came from
    // the store (e.g., user loaded a different workspace step)
    isSyncingRef.current = true;

    // Push local structural changes (add/remove/rename a subgraph or query
    // tab) into the shared names arrays so other clients learn about them —
    // reconcileSubgraphNames/reconcileQueryTabNames on their end pick this up.
    const sgNames = doc.getArray<string>(SUBGRAPH_NAMES_FIELD);
    const localSgNames = ws.subgraphs.map((sg) => sg.name);
    if (!arraysEqual(sgNames.toArray(), localSgNames)) {
      doc.transact(() => {
        sgNames.delete(0, sgNames.length);
        sgNames.push(localSgNames);
      });
    }

    const qtNames = doc.getArray<string>(QUERY_TAB_NAMES_FIELD);
    const localQtNames = ws.queryTabs.map((tab) => tab.name);
    if (!arraysEqual(qtNames.toArray(), localQtNames)) {
      doc.transact(() => {
        qtNames.delete(0, qtNames.length);
        qtNames.push(localQtNames);
      });
    }

    // Update Y.Text fields to match current workspace state
    ws.subgraphs.forEach((sg, i) => {
      const yText = doc.getText(sgField(i));
      if (yText.toString() !== sg.sdl) {
        yText.delete(0, yText.length);
        yText.insert(0, sg.sdl);
      }
    });

    ws.queryTabs.forEach((tab, i) => {
      const yText = doc.getText(queryField(i));
      if (yText.toString() !== tab.query) {
        yText.delete(0, yText.length);
        yText.insert(0, tab.query);
      }
    });

    const mcYText = doc.getText(MOCK_CONFIG_FIELD);
    if (mcYText.toString() !== ws.mockConfig) {
      mcYText.delete(0, mcYText.length);
      mcYText.insert(0, ws.mockConfig);
    }

    isSyncingRef.current = false;
  }, [wsUrl, synced, pinnedWorkspaceId, ws.subgraphs, ws.queryTabs, ws.mockConfig]);

  // ── Editor binding ──────────────────────────────────────────────────────

  const bindEditor = useCallback(
    (
      editor: _monaco.editor.IStandaloneCodeEditor,
      model: _monaco.editor.ITextModel,
      fieldName: string,
    ) => {
      const provider = providerRef.current;
      if (!provider) return () => {};

      // Callers (App.tsx's Monaco `onMount`) don't reliably invoke the
      // cleanup this returns before re-binding the same field (e.g. a tab
      // remount), so guard here too: an unclosed prior binding for this
      // field would keep listening and double-apply every remote edit to
      // the model, corrupting content on every sync.
      bindingsRef.current.get(fieldName)?.destroy();

      const yText = provider.doc.getText(fieldName);
      const binding = new MonacoBinding(yText, model, new Set([editor]), provider.awareness);
      bindingsRef.current.set(fieldName, binding);

      return () => {
        binding.destroy();
        bindingsRef.current.delete(fieldName);
      };
    },
    [],
  );

  // ── Awareness ───────────────────────────────────────────────────────────

  const setLocalState = useCallback((state: Record<string, unknown> | null) => {
    providerRef.current?.awareness.setLocalState(state);
  }, []);

  // ── Cleanup ─────────────────────────────────────────────────────────────

  const destroy = useCallback(() => {
    providerRef.current?.destroy();
    providerRef.current = null;
    destroyAllBindings(bindingsRef.current);
  }, []);

  // ── Result ──────────────────────────────────────────────────────────────

  return useMemo(
    () => ({
      isActive: !!awareness && status === "connected",
      status,
      synced,
      awareness,
      bindEditor,
      setLocalState,
      destroy,
    }),
    [status, synced, awareness, bindEditor, setLocalState, destroy],
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Seed the Y.Doc with content from the current workspace payload.
 */
function seedDoc(doc: Y.Doc, ws: ReturnType<typeof activeWorkspace>): void {
  // Seed subgraph names + SDLs
  const sgNames = doc.getArray<string>(SUBGRAPH_NAMES_FIELD);
  if (sgNames.length === 0) {
    sgNames.push(ws.subgraphs.map((sg) => sg.name));
  }
  ws.subgraphs.forEach((sg, i) => {
    const yText = doc.getText(sgField(i));
    if (yText.length === 0) {
      yText.insert(0, sg.sdl);
    }
  });

  // Seed query tab names + queries
  const qtNames = doc.getArray<string>(QUERY_TAB_NAMES_FIELD);
  if (qtNames.length === 0) {
    qtNames.push(ws.queryTabs.map((tab) => tab.name));
  }
  ws.queryTabs.forEach((tab, i) => {
    const yText = doc.getText(queryField(i));
    if (yText.length === 0) {
      yText.insert(0, tab.query);
    }
  });

  // Seed mock config
  const mcYText = doc.getText(MOCK_CONFIG_FIELD);
  if (mcYText.length === 0) {
    mcYText.insert(0, ws.mockConfig);
  }
}
