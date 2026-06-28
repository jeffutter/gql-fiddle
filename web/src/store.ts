import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CompositionError, QueryTab, SubgraphInput } from "./core/types";
import type { PaneId, Tour, WorkspaceEntry, WorkspacePayload } from "./share";
import { resolveTourStep } from "./share";

// Single source of truth for the workspace. Composition output is *derived*
// state (recomputed when subgraphs change), never hand-edited.

/**
 * Compute the diff of `current` against `base`. Only top-level keys that
 * differ are included in the returned overrides object. Returns `undefined`
 * when the two payloads are identical.
 */
export function computeOverrides(
  base: WorkspacePayload,
  current: WorkspacePayload,
): Partial<WorkspacePayload> | undefined {
  const overrides: Partial<WorkspacePayload> = {};
  if (JSON.stringify(current.subgraphs) !== JSON.stringify(base.subgraphs))
    overrides.subgraphs = current.subgraphs;
  if (JSON.stringify(current.queryTabs) !== JSON.stringify(base.queryTabs))
    overrides.queryTabs = current.queryTabs;
  if (current.activeQueryTab !== base.activeQueryTab)
    overrides.activeQueryTab = current.activeQueryTab;
  if (current.seed !== base.seed) overrides.seed = current.seed;
  if (current.mockConfig !== base.mockConfig) overrides.mockConfig = current.mockConfig;
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Default workspace content
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SUBGRAPHS: SubgraphInput[] = [
  {
    name: "users",
    sdl: `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
{
  query: Query
}

type Query {
  me: User
  user(id: ID!): User
}

type User @key(fields: "id") {
  id: ID!
  name: String
  email: String
}
`,
  },
  {
    name: "products",
    sdl: `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
{
  query: Query
}

type Query {
  topProducts: [Product]
  product(id: ID!): Product
}

type Product @key(fields: "id") {
  id: ID!
  name: String
  price: Float
  inStock: Boolean
}

extend type User @key(fields: "id") {
  id: ID! @external
  purchases: [Product]
}
`,
  },
];

export const DEFAULT_QUERY = `query {
  topProducts {
    id
    name
    price
  }
  me {
    id
    name
    purchases {
      id
      name
    }
  }
}
`;
const DEFAULT_SEED = 42;

export const DEFAULT_QUERY_TABS: QueryTab[] = [{ name: "Query 1", query: DEFAULT_QUERY }];

function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for insecure HTTP contexts
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (ch) => {
    const c = parseInt(ch, 10);
    return (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16);
  });
}

export function makeDefaultWorkspace(name: string): WorkspaceEntry {
  return {
    name,
    id: generateUUID(),
    version: 1,
    subgraphs: DEFAULT_SUBGRAPHS,
    activeSubgraph: 0,
    queryTabs: DEFAULT_QUERY_TABS,
    activeQueryTab: 0,
    seed: DEFAULT_SEED,
    mockConfig: "",
    tourDraft: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// State interface
// ──────────────────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  /** All named workspaces. At least one entry is always present. */
  workspaces: WorkspaceEntry[];
  /** Index into workspaces[] for the currently active workspace. */
  activeWorkspaceIndex: number;

  // Composition results — session-only (not persisted).
  supergraphSdl: string | null;
  composeErrors: CompositionError[] | null;
  composeHints: number;

  /** Whether vim keybindings are enabled on all Monaco editors (global). */
  vimMode: boolean;
  setVimMode: (enabled: boolean) => void;

  // Session-only tour authoring state — NOT persisted.
  tourActiveStep: number | null;
  setTourActiveStep: (i: number | null) => void;

  // ── Workspace CRUD ──────────────────────────────────────────────────────────

  /** Append a blank default workspace and switch to it. */
  addWorkspace: () => void;
  /** Deep-copy the active workspace, append it (named "Workspace N"), and switch to it. */
  cloneWorkspace: () => void;
  /**
   * Remove the workspace at `index`. If it was the last workspace, a single
   * blank default workspace is created in its place. `activeWorkspaceIndex` is
   * adjusted so it always points to a valid entry.
   */
  removeWorkspace: (index: number) => void;
  /** Rename the workspace at `index`. */
  renameWorkspace: (index: number, name: string) => void;
  /**
   * Switch to the workspace at `index`. Clears session-only derived state
   * (`supergraphSdl`, `composeErrors`, `composeHints`) so compose re-runs
   * against the newly active workspace's subgraphs.
   */
  setActiveWorkspace: (index: number) => void;

  // ── Per-workspace actions (operate on workspaces[activeWorkspaceIndex]) ──────

  /**
   * Load the resolved workspace for a given step index into the live editors.
   * Calls resolveTourStep and writes the result into the active workspace.
   */
  loadTourStep: (stepIndex: number) => void;

  /**
   * Snapshot the current workspace into a tour step.
   * 'new' appends a new TourStep; a number updates the existing step's overrides.
   * Computes overrides as the diff of the current workspace against tour.base.
   */
  snapshotCurrentToStep: (stepIndex: number | "new") => void;

  /**
   * Set or clear the anchor for a specific step. The anchor identifies a
   * GraphQL type or field in a subgraph's schema that should be highlighted
   * during tour playback.
   */
  setStepAnchor: (
    stepIndex: number,
    anchor: { subgraphIndex: number; typeName: string; fieldName?: string } | undefined,
  ) => void;

  /**
   * Set the visibility of a specific pane for a given step. Only an explicit
   * `false` hides the pane — `undefined` and `true` both mean visible, so
   * existing tours without flags continue to show all panes.
   */
  setStepPaneVisibility: (stepIndex: number, pane: PaneId, visible: boolean) => void;

  setTourDraft: (tour: Tour | null) => void;
  setMockConfig: (yaml: string) => void;

  addSubgraph: (name: string) => void;
  removeSubgraph: (index: number) => void;
  renameSubgraph: (index: number, name: string) => void;
  setSubgraphSdl: (index: number, sdl: string) => void;
  setActiveSubgraph: (index: number) => void;
  addQueryTab: () => void;
  removeQueryTab: (index: number) => void;
  renameQueryTab: (index: number, name: string) => void;
  setQueryTabQuery: (index: number, query: string) => void;
  setActiveQueryTab: (index: number) => void;
  setSeed: (seed: number) => void;
  setComposeResult: (
    sdl: string | null,
    errors: CompositionError[] | null,
    hintCount: number,
  ) => void;
  resetToDefaults: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Selector helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the currently active workspace entry.
 * Use in `useWorkspace(s => activeWorkspace(s).subgraphs)` etc.
 */
export function activeWorkspace(state: WorkspaceState): WorkspaceEntry {
  return state.workspaces[state.activeWorkspaceIndex];
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: update a single field on the active workspace immutably
// ──────────────────────────────────────────────────────────────────────────────

function updateActive(
  state: WorkspaceState,
  patch: Partial<WorkspaceEntry>,
): Pick<WorkspaceState, "workspaces"> {
  const idx = state.activeWorkspaceIndex;
  const updated = state.workspaces.map((ws, i) => (i === idx ? { ...ws, ...patch } : ws));
  return { workspaces: updated };
}

// ──────────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────────

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspaces: [makeDefaultWorkspace("Workspace 1")],
      activeWorkspaceIndex: 0,

      vimMode: false,
      setVimMode: (enabled) => set({ vimMode: enabled }),

      // Session-only authoring state — not in partialize.
      tourActiveStep: null,
      setTourActiveStep: (i) => set({ tourActiveStep: i }),

      // Composition results — session-only.
      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,

      // ── Workspace CRUD ────────────────────────────────────────────────────────

      addWorkspace: () =>
        set((state) => {
          // Auto-name: "Workspace N" where N is the next available number.
          let n = 1;
          while (state.workspaces.some((ws) => ws.name === `Workspace ${n}`)) n++;
          const newWs = makeDefaultWorkspace(`Workspace ${n}`);
          return {
            workspaces: [...state.workspaces, newWs],
            activeWorkspaceIndex: state.workspaces.length,
            // Clear session-only derived state so compose re-runs.
            supergraphSdl: null,
            composeErrors: null,
            composeHints: 0,
          };
        }),

      cloneWorkspace: () =>
        set((state) => {
          const src = activeWorkspace(state);
          let n = 1;
          while (state.workspaces.some((ws) => ws.name === `Workspace ${n}`)) n++;
          const cloned: WorkspaceEntry = {
            ...(JSON.parse(JSON.stringify(src)) as WorkspaceEntry),
            name: `Workspace ${n}`,
          };
          return {
            workspaces: [...state.workspaces, cloned],
            activeWorkspaceIndex: state.workspaces.length,
            supergraphSdl: null,
            composeErrors: null,
            composeHints: 0,
          };
        }),

      removeWorkspace: (index) =>
        set((state) => {
          const remaining = state.workspaces.filter((_, i) => i !== index);
          const workspaces =
            remaining.length === 0 ? [makeDefaultWorkspace("Workspace 1")] : remaining;
          const activeWorkspaceIndex =
            remaining.length === 0
              ? 0
              : Math.min(
                  state.activeWorkspaceIndex === index
                    ? Math.max(index - 1, 0)
                    : state.activeWorkspaceIndex > index
                      ? state.activeWorkspaceIndex - 1
                      : state.activeWorkspaceIndex,
                  workspaces.length - 1,
                );
          return {
            workspaces,
            activeWorkspaceIndex,
            supergraphSdl: null,
            composeErrors: null,
            composeHints: 0,
          };
        }),

      renameWorkspace: (index, name) =>
        set((state) => ({
          workspaces: state.workspaces.map((ws, i) => (i === index ? { ...ws, name } : ws)),
        })),

      setActiveWorkspace: (index) =>
        set({
          activeWorkspaceIndex: index,
          // Clear derived session state so compose re-runs for the new workspace.
          supergraphSdl: null,
          composeErrors: null,
          composeHints: 0,
        }),

      // ── Per-workspace actions ──────────────────────────────────────────────────

      loadTourStep: (stepIndex) =>
        set((state) => {
          const ws = activeWorkspace(state);
          if (!ws.tourDraft) return state;
          const payload = resolveTourStep(ws.tourDraft, stepIndex);
          return updateActive(state, {
            subgraphs: payload.subgraphs,
            queryTabs: payload.queryTabs,
            activeQueryTab: payload.activeQueryTab,
            seed: payload.seed,
            mockConfig: payload.mockConfig ?? "",
          });
        }),

      snapshotCurrentToStep: (stepIndex) =>
        set((state) => {
          const ws = activeWorkspace(state);
          if (!ws.tourDraft) return state;
          const current: WorkspacePayload = {
            subgraphs: ws.subgraphs,
            queryTabs: ws.queryTabs,
            activeQueryTab: ws.activeQueryTab,
            seed: ws.seed,
            mockConfig: ws.mockConfig,
          };
          const overrides = computeOverrides(ws.tourDraft.base, current);
          if (stepIndex === "new") {
            const newStep = {
              label: `Step ${ws.tourDraft.steps.length + 1}`,
              prose: "",
              overrides,
            };
            return updateActive(state, {
              tourDraft: { ...ws.tourDraft, steps: [...ws.tourDraft.steps, newStep] },
            });
          } else {
            const updatedSteps = ws.tourDraft.steps.map((step, i) =>
              i === stepIndex ? { ...step, overrides } : step,
            );
            return updateActive(state, { tourDraft: { ...ws.tourDraft, steps: updatedSteps } });
          }
        }),

      setStepAnchor: (stepIndex, anchor) =>
        set((state) => {
          const ws = activeWorkspace(state);
          if (!ws.tourDraft) return state;
          const updatedSteps = ws.tourDraft.steps.map((step, i) =>
            i === stepIndex ? { ...step, anchor } : step,
          );
          return updateActive(state, { tourDraft: { ...ws.tourDraft, steps: updatedSteps } });
        }),

      setStepPaneVisibility: (stepIndex, pane, visible) =>
        set((state) => {
          const ws = activeWorkspace(state);
          if (!ws.tourDraft) return state;
          const updatedSteps = ws.tourDraft.steps.map((step, i) => {
            if (i !== stepIndex) return step;
            const pv = { ...(step.paneVisibility ?? {}), [pane]: visible };
            return { ...step, paneVisibility: pv };
          });
          return updateActive(state, { tourDraft: { ...ws.tourDraft, steps: updatedSteps } });
        }),

      setTourDraft: (tour) => set((state) => updateActive(state, { tourDraft: tour })),

      addSubgraph: (name) =>
        set((state) => {
          const ws = activeWorkspace(state);
          return updateActive(state, {
            subgraphs: [...ws.subgraphs, { name, sdl: "" }],
            activeSubgraph: ws.subgraphs.length,
          });
        }),

      removeSubgraph: (index) =>
        set((state) => {
          const ws = activeWorkspace(state);
          const remaining = ws.subgraphs.filter((_, i) => i !== index);
          if (remaining.length === 0) return state; // keep at least 1
          const newActive = Math.min(index, remaining.length - 1);
          return updateActive(state, { subgraphs: remaining, activeSubgraph: newActive });
        }),

      renameSubgraph: (index, name) =>
        set((state) => {
          const ws = activeWorkspace(state);
          return updateActive(state, {
            subgraphs: ws.subgraphs.map((sg, i) => (i === index ? { ...sg, name } : sg)),
          });
        }),

      setSubgraphSdl: (index, sdl) =>
        set((state) => {
          const ws = activeWorkspace(state);
          return updateActive(state, {
            subgraphs: ws.subgraphs.map((sg, i) => (i === index ? { ...sg, sdl } : sg)),
          });
        }),

      setActiveSubgraph: (index) => set((state) => updateActive(state, { activeSubgraph: index })),

      addQueryTab: () =>
        set((state) => {
          const ws = activeWorkspace(state);
          let n = 1;
          while (ws.queryTabs.some((t) => t.name === `Query ${n}`)) n++;
          const newTab: QueryTab = { name: `Query ${n}`, query: "" };
          return updateActive(state, {
            queryTabs: [...ws.queryTabs, newTab],
            activeQueryTab: ws.queryTabs.length,
          });
        }),

      removeQueryTab: (index) =>
        set((state) => {
          const ws = activeWorkspace(state);
          const remaining = ws.queryTabs.filter((_, i) => i !== index);
          if (remaining.length === 0) {
            return updateActive(state, {
              queryTabs: [{ name: "Query 1", query: "" }],
              activeQueryTab: 0,
            });
          }
          let newActive: number;
          if (ws.activeQueryTab === index) {
            newActive = Math.min(index, remaining.length - 1);
          } else if (ws.activeQueryTab > index) {
            newActive = ws.activeQueryTab - 1;
          } else {
            newActive = ws.activeQueryTab;
          }
          return updateActive(state, { queryTabs: remaining, activeQueryTab: newActive });
        }),

      renameQueryTab: (index, name) =>
        set((state) => {
          const ws = activeWorkspace(state);
          return updateActive(state, {
            queryTabs: ws.queryTabs.map((t, i) => (i === index ? { ...t, name } : t)),
          });
        }),

      setQueryTabQuery: (index, query) =>
        set((state) => {
          const ws = activeWorkspace(state);
          return updateActive(state, {
            queryTabs: ws.queryTabs.map((t, i) => (i === index ? { ...t, query } : t)),
          });
        }),

      setActiveQueryTab: (index) => set((state) => updateActive(state, { activeQueryTab: index })),

      setSeed: (seed) => set((state) => updateActive(state, { seed })),

      setMockConfig: (yaml) => set((state) => updateActive(state, { mockConfig: yaml })),

      setComposeResult: (sdl, errors, hintCount) =>
        set((state) => ({
          supergraphSdl: sdl ?? state.supergraphSdl,
          composeErrors: errors,
          composeHints: hintCount,
        })),

      resetToDefaults: () =>
        set((state) => {
          // Preserve the workspace name and tourDraft, reset content fields only.
          const ws = activeWorkspace(state);
          return updateActive(state, {
            subgraphs: DEFAULT_SUBGRAPHS,
            activeSubgraph: 0,
            queryTabs: DEFAULT_QUERY_TABS,
            activeQueryTab: 0,
            seed: DEFAULT_SEED,
            mockConfig: "",
            // Preserve name and tourDraft
            name: ws.name,
            tourDraft: ws.tourDraft,
          });
        }),
    }),
    {
      // Legacy internal localStorage key from this project's original name
      // ("graphql-playground"). Kept stable during the gql-fiddle rebrand to
      // avoid wiping existing users' saved workspaces — Zustand's `persist`
      // migrations key off the stored value's `version`, not this string, so
      // renaming it would require custom storage get/set logic to copy and
      // delete the old key for no user-visible benefit. Intentionally
      // decoupled from the product's display name.
      name: "graphql-playground",
      version: 5,
      migrate: (persistedState: unknown, version: number) => {
        let state = persistedState as Record<string, unknown>;

        if (version === 0) {
          const { query, ...rest } = state;
          const q = typeof query === "string" ? query : DEFAULT_QUERY;
          state = {
            ...rest,
            queryTabs: [{ name: "Query 1", query: q }],
            activeQueryTab: 0,
            mockConfig: "",
          };
          // Fall through to version 1 migration
        }

        if (version <= 1) {
          // v1 → v2: add mockConfig field with empty default.
          state = { ...state, mockConfig: "" };
        }

        if (version <= 2) {
          // v2 → v3: add vimMode with false default.
          state = { ...state, vimMode: false };
        }

        if (version <= 3) {
          // v3 → v4: wrap flat workspace fields into a workspaces array.
          const {
            subgraphs,
            activeSubgraph,
            queryTabs,
            activeQueryTab,
            seed,
            mockConfig,
            tourDraft,
            vimMode,
            // Drop any other unknown keys from the old flat state.
            ...rest
          } = state;
          const workspace1: WorkspaceEntry = {
            name: "Workspace 1",
            subgraphs: (subgraphs as SubgraphInput[]) ?? DEFAULT_SUBGRAPHS,
            activeSubgraph: (activeSubgraph as number) ?? 0,
            queryTabs: (queryTabs as QueryTab[]) ?? DEFAULT_QUERY_TABS,
            activeQueryTab: (activeQueryTab as number) ?? 0,
            seed: (seed as number) ?? DEFAULT_SEED,
            mockConfig: (mockConfig as string) ?? "",
            tourDraft: (tourDraft as Tour | null) ?? null,
          };
          void rest; // unused fields from old state
          state = {
            workspaces: [workspace1],
            activeWorkspaceIndex: 0,
            vimMode: (vimMode as boolean) ?? false,
          };
          // Fall through to v4 → v5 migration below
        }

        if (version <= 4) {
          // v4 → v5: assign stable client-generated id + initial version to
          // each workspace so the cloud sync engine can track them. Existing
          // workspaces without an id are backfilled with generateUUID()
          // and version=1 — their content is never overwritten here.
          const workspaces = (state.workspaces as WorkspaceEntry[]).map((ws) => ({
            ...ws,
            id: ws.id ?? generateUUID(),
            version: ws.version ?? 1,
          }));
          state = { ...state, workspaces };
        }

        return state;
      },
      partialize: (state) => ({
        workspaces: state.workspaces,
        activeWorkspaceIndex: state.activeWorkspaceIndex,
        vimMode: state.vimMode,
      }),
    },
  ),
);
