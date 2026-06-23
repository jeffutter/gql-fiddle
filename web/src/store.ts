import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CompositionError, QueryTab, SubgraphInput } from "./core/types";
import type { PaneId, Tour, WorkspacePayload } from "./share";
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
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export interface WorkspaceState {
  subgraphs: SubgraphInput[];
  activeSubgraph: number;
  queryTabs: QueryTab[];
  activeQueryTab: number;
  seed: number;

  // Composition results (persisted so later panes can read them independently).
  supergraphSdl: string | null;
  composeErrors: CompositionError[] | null;
  composeHints: number;

  tourDraft: Tour | null;
  setTourDraft: (tour: Tour | null) => void;

  // Session-only tour authoring state — NOT persisted.
  tourActiveStep: number | null;
  setTourActiveStep: (i: number | null) => void;

  /**
   * Load the resolved workspace for a given step index into the live editors.
   * Calls resolveTourStep and writes the result into the workspace state.
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

const DEFAULT_SUBGRAPHS: SubgraphInput[] = [
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

const DEFAULT_QUERY = `query {
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

const DEFAULT_QUERY_TABS: QueryTab[] = [{ name: "Query 1", query: DEFAULT_QUERY }];

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      subgraphs: DEFAULT_SUBGRAPHS,
      activeSubgraph: 0,
      queryTabs: DEFAULT_QUERY_TABS,
      activeQueryTab: 0,
      seed: DEFAULT_SEED,

      tourDraft: null,
      setTourDraft: (tour) => set({ tourDraft: tour }),

      // Session-only authoring state — not in partialize.
      tourActiveStep: null,
      setTourActiveStep: (i) => set({ tourActiveStep: i }),

      loadTourStep: (stepIndex) =>
        set((state) => {
          if (!state.tourDraft) return state;
          const payload = resolveTourStep(state.tourDraft, stepIndex);
          return {
            subgraphs: payload.subgraphs,
            queryTabs: payload.queryTabs,
            activeQueryTab: payload.activeQueryTab,
            seed: payload.seed,
          };
        }),

      snapshotCurrentToStep: (stepIndex) =>
        set((state) => {
          if (!state.tourDraft) return state;
          const current: WorkspacePayload = {
            subgraphs: state.subgraphs,
            queryTabs: state.queryTabs,
            activeQueryTab: state.activeQueryTab,
            seed: state.seed,
          };
          const overrides = computeOverrides(state.tourDraft.base, current);
          if (stepIndex === "new") {
            const newStep = {
              label: `Step ${state.tourDraft.steps.length + 1}`,
              prose: "",
              overrides,
            };
            return {
              tourDraft: { ...state.tourDraft, steps: [...state.tourDraft.steps, newStep] },
            };
          } else {
            const updatedSteps = state.tourDraft.steps.map((step, i) =>
              i === stepIndex ? { ...step, overrides } : step,
            );
            return { tourDraft: { ...state.tourDraft, steps: updatedSteps } };
          }
        }),

      setStepAnchor: (stepIndex, anchor) =>
        set((state) => {
          if (!state.tourDraft) return state;
          const updatedSteps = state.tourDraft.steps.map((step, i) =>
            i === stepIndex ? { ...step, anchor } : step,
          );
          return { tourDraft: { ...state.tourDraft, steps: updatedSteps } };
        }),

      setStepPaneVisibility: (stepIndex, pane, visible) =>
        set((state) => {
          if (!state.tourDraft) return state;
          const updatedSteps = state.tourDraft.steps.map((step, i) => {
            if (i !== stepIndex) return step;
            const pv = { ...(step.paneVisibility ?? {}), [pane]: visible };
            return { ...step, paneVisibility: pv };
          });
          return { tourDraft: { ...state.tourDraft, steps: updatedSteps } };
        }),

      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,

      addSubgraph: (name) =>
        set((state) => ({
          subgraphs: [...state.subgraphs, { name, sdl: "" }],
          activeSubgraph: state.subgraphs.length,
        })),
      removeSubgraph: (index) =>
        set((state) => {
          const remaining = state.subgraphs.filter((_, i) => i !== index);
          if (remaining.length === 0) return state; // keep at least 1
          const newActive = Math.min(index, remaining.length - 1);
          return { subgraphs: remaining, activeSubgraph: newActive };
        }),
      renameSubgraph: (index, name) =>
        set((state) => ({
          subgraphs: state.subgraphs.map((sg, i) => (i === index ? { ...sg, name } : sg)),
        })),
      setSubgraphSdl: (index, sdl) =>
        set((state) => ({
          subgraphs: state.subgraphs.map((sg, i) => (i === index ? { ...sg, sdl } : sg)),
        })),
      setActiveSubgraph: (index) => set({ activeSubgraph: index }),
      addQueryTab: () =>
        set((state) => {
          let n = 1;
          while (state.queryTabs.some((t) => t.name === `Query ${n}`)) n++;
          const newTab: QueryTab = { name: `Query ${n}`, query: "" };
          return {
            queryTabs: [...state.queryTabs, newTab],
            activeQueryTab: state.queryTabs.length,
          };
        }),
      removeQueryTab: (index) =>
        set((state) => {
          const remaining = state.queryTabs.filter((_, i) => i !== index);
          if (remaining.length === 0) {
            return {
              queryTabs: [{ name: "Query 1", query: "" }],
              activeQueryTab: 0,
            };
          }
          let newActive: number;
          if (state.activeQueryTab === index) {
            newActive = Math.min(index, remaining.length - 1);
          } else if (state.activeQueryTab > index) {
            newActive = state.activeQueryTab - 1;
          } else {
            newActive = state.activeQueryTab;
          }
          return { queryTabs: remaining, activeQueryTab: newActive };
        }),
      renameQueryTab: (index, name) =>
        set((state) => ({
          queryTabs: state.queryTabs.map((t, i) => (i === index ? { ...t, name } : t)),
        })),
      setQueryTabQuery: (index, query) =>
        set((state) => ({
          queryTabs: state.queryTabs.map((t, i) => (i === index ? { ...t, query } : t)),
        })),
      setActiveQueryTab: (index) => set({ activeQueryTab: index }),
      setSeed: (seed) => set({ seed }),
      setComposeResult: (sdl, errors, hintCount) =>
        set((state) => ({
          supergraphSdl: sdl ?? state.supergraphSdl,
          composeErrors: errors,
          composeHints: hintCount,
        })),
      resetToDefaults: () =>
        set({
          subgraphs: DEFAULT_SUBGRAPHS,
          activeSubgraph: 0,
          queryTabs: DEFAULT_QUERY_TABS,
          activeQueryTab: 0,
          seed: DEFAULT_SEED,
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
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0) {
          const { query, ...rest } = persistedState as Record<string, unknown>;
          const q = typeof query === "string" ? query : DEFAULT_QUERY;
          return {
            ...rest,
            queryTabs: [{ name: "Query 1", query: q }],
            activeQueryTab: 0,
          } as unknown as WorkspaceState;
        }
        return persistedState as WorkspaceState;
      },
      partialize: (state) => ({
        subgraphs: state.subgraphs,
        activeSubgraph: state.activeSubgraph,
        queryTabs: state.queryTabs,
        activeQueryTab: state.activeQueryTab,
        seed: state.seed,
        tourDraft: state.tourDraft,
      }),
    },
  ),
);
