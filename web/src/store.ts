import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CompositionError, SubgraphInput } from "./core/types";

// Single source of truth for the workspace. Composition output is *derived*
// state (recomputed when subgraphs change), never hand-edited.

export interface WorkspaceState {
  subgraphs: SubgraphInput[];
  activeSubgraph: number;
  query: string;
  variables: string;
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
  setQuery: (query: string) => void;
  setVariables: (variables: string) => void;
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

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      subgraphs: DEFAULT_SUBGRAPHS,
      activeSubgraph: 0,
      query: DEFAULT_QUERY,
      variables: DEFAULT_VARIABLES,
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
      setQuery: (query) => set({ query }),
      setVariables: (variables) => set({ variables }),
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
          query: DEFAULT_QUERY,
          variables: DEFAULT_VARIABLES,
          seed: DEFAULT_SEED,
        }),
    }),
    {
      name: "graphql-playground",
      partialize: (state) => ({
        subgraphs: state.subgraphs,
        activeSubgraph: state.activeSubgraph,
        query: state.query,
        variables: state.variables,
        seed: state.seed,
      }),
    },
  ),
);
