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
import { useWorkspace, activeWorkspace } from "./store";
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

// ── Hook ───────────────────────────────────────────────────────────────────

export interface UseLiveSessionResult {
  /** Whether live sync is currently active (provider exists and connected). */
  isActive: boolean;
  /** Connection status for UI indicator. */
  status: "connecting" | "connected" | "disconnected";
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

  // Read the current workspace for seeding
  const ws = useWorkspace(activeWorkspace);

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
      bindings.clear();
      // Synchronizing local state with this effect's own external resource (the
      // provider), not deriving from props/state — safe to set directly.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("disconnected");
      setAwareness(null);
      return;
    }

    // Create provider with existing doc or new one
    const provider = new LiveSyncProviderImpl(wsUrl);
    providerRef.current = provider;
    setStatus("connecting");
    setAwareness(provider.awareness);

    // Listen for status changes
    provider.on("status", ({ status }) => {
      setStatus(status);
    });

    // Seed initial content from workspace into Y.Text fields
    seedDoc(provider.doc, ws);

    // Sync Yjs → Zustand store
    const yTexts: Map<string, Y.Text> = new Map();

    // Observe each Y.Text field and write back to store
    const observeHandler = () => {
      if (isSyncingRef.current) return; // prevent loop
      isSyncingRef.current = true;

      try {
        const doc = provider.doc;

        // Sync subgraph SDLs
        ws.subgraphs.forEach((_, i) => {
          const field = sgField(i);
          const yText = doc.getText(field);
          const sdl = yText.toString();
          if (sdl !== ws.subgraphs[i]?.sdl) {
            useWorkspace.getState().setSubgraphSdl(i, sdl);
          }
        });

        // Sync query tabs
        ws.queryTabs.forEach((_, i) => {
          const field = queryField(i);
          const yText = doc.getText(field);
          const query = yText.toString();
          if (query !== ws.queryTabs[i]?.query) {
            useWorkspace.getState().setQueryTabQuery(i, query);
          }
        });

        // Sync mock config
        const mcField = doc.getText(MOCK_CONFIG_FIELD);
        const mc = mcField.toString();
        if (mc !== ws.mockConfig) {
          useWorkspace.getState().setMockConfig(mc);
        }
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Register observers on existing fields
    const registerObservers = () => {
      const doc = provider.doc;

      ws.subgraphs.forEach((_, i) => {
        const yText = doc.getText(sgField(i));
        yText.observe(observeHandler);
        yTexts.set(sgField(i), yText);
      });

      ws.queryTabs.forEach((_, i) => {
        const yText = doc.getText(queryField(i));
        yText.observe(observeHandler);
        yTexts.set(queryField(i), yText);
      });

      const mcYText = doc.getText(MOCK_CONFIG_FIELD);
      mcYText.observe(observeHandler);
      yTexts.set(MOCK_CONFIG_FIELD, mcYText);
    };

    registerObservers();

    // Also listen for doc-level updates (for new fields added dynamically)
    provider.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin === "store") return;
    });

    return () => {
      provider.destroy();
      providerRef.current = null;
      bindings.clear();
      setStatus("disconnected");
      setAwareness(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // ── Re-seed when workspace changes (non-live edits) ─────────────────────

  useEffect(() => {
    if (!providerRef.current || !wsUrl) return;
    const doc = providerRef.current.doc;

    // Guard against re-entrancy: only re-seed if this change came from
    // the store (e.g., user loaded a different workspace step)
    isSyncingRef.current = true;

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
  }, [wsUrl, ws.subgraphs, ws.queryTabs, ws.mockConfig]);

  // ── Editor binding ──────────────────────────────────────────────────────

  const bindEditor = useCallback(
    (
      editor: _monaco.editor.IStandaloneCodeEditor,
      model: _monaco.editor.ITextModel,
      fieldName: string,
    ) => {
      const provider = providerRef.current;
      if (!provider) return () => {};

      const yText = provider.doc.getText(fieldName);
      const binding = new MonacoBinding(yText, model, new Set([editor]), provider.awareness);
      bindingsRef.current.set(fieldName, binding);

      return () => {
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
    bindingsRef.current.clear();
  }, []);

  // ── Result ──────────────────────────────────────────────────────────────

  return useMemo(
    () => ({
      isActive: !!awareness && status === "connected",
      status,
      awareness,
      bindEditor,
      setLocalState,
      destroy,
    }),
    [status, awareness, bindEditor, setLocalState, destroy],
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Seed the Y.Doc with content from the current workspace payload.
 */
function seedDoc(doc: Y.Doc, ws: ReturnType<typeof activeWorkspace>): void {
  // Seed subgraph SDLs
  ws.subgraphs.forEach((sg, i) => {
    const yText = doc.getText(sgField(i));
    if (yText.length === 0) {
      yText.insert(0, sg.sdl);
    }
  });

  // Seed query tabs
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
