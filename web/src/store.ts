import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CompositionError, QueryTab, SubgraphInput } from "./core/types";

// Single source of truth for the workspace. Composition output is *derived*
// state (recomputed when subgraphs change), never hand-edited.

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
    name: "products",
    sdl: "type Query {\n  products: [Product]\n}\n\ntype Product {\n  id: ID!\n  name: String\n}\n",
  },
];

const DEFAULT_QUERY = "query {\n  products {\n    id\n    name\n  }\n}\n";
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
      }),
    },
  ),
);
