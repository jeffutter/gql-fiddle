// The TypeScript view of the Rust/WASM core. These shapes mirror the JSON
// envelopes returned by crates/gql-core (see its dto.rs). The UI depends on
// these types, never on apollo-federation internals.

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line: number;
  col: number;
  len: number;
}

export interface SubgraphInput {
  name: string;
  sdl: string;
}

export type ComposeResult =
  | { ok: true; supergraph_sdl: string; api_schema_sdl: string; hints: CompositionHint[] }
  | { ok: false; errors: CompositionError[] };

export interface CompositionHint {
  code: string;
  message: string;
}

export interface CompositionError {
  code: string;
  message: string;
  locations?: { line: number; col: number }[];
}

export interface MockResult {
  data: unknown;
  errors?: { message: string }[];
}

/** Functions exported by the WASM module, wrapped with typed I/O. */
export interface GqlCore {
  validateSubgraph(sdl: string): { diagnostics: Diagnostic[] };
  compose(subgraphs: SubgraphInput[]): ComposeResult;
  validateQuery(supergraphSdl: string, operation: string): { diagnostics: Diagnostic[] };
  plan(supergraphSdl: string, operation: string, opName?: string): unknown;
  executeMock(
    supergraphSdl: string,
    operation: string,
    variables: Record<string, unknown>,
    seed: number,
  ): MockResult;
}
