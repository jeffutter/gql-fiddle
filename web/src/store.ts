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
  setQueryTabVariables: (index: number, variables: string) => void;
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
const DEFAULT_VARIABLES = "{}";
const DEFAULT_SEED = 42;

const DEFAULT_QUERY_TABS: QueryTab[] = [
  { name: "Query 1", query: DEFAULT_QUERY, variables: DEFAULT_VARIABLES },
];

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
          const newTab: QueryTab = { name: `Query ${n}`, query: "", variables: "{}" };
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
              queryTabs: [{ name: "Query 1", query: "", variables: "{}" }],
              activeQueryTab: 0,
            };
          }
          const newActive = Math.min(index, remaining.length - 1);
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
      setQueryTabVariables: (index, variables) =>
        set((state) => ({
          queryTabs: state.queryTabs.map((t, i) => (i === index ? { ...t, variables } : t)),
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
      name: "graphql-playground",
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        if (version === 0) {
          const { query, variables, ...rest } = persistedState as Record<string, unknown>;
          const q = typeof query === "string" ? query : DEFAULT_QUERY;
          const v = typeof variables === "string" ? variables : DEFAULT_VARIABLES;
          return {
            ...rest,
            queryTabs: [{ name: "Query 1", query: q, variables: v }],
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
