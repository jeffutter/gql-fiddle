// Loader and typed wrapper around the Rust/WASM core.

import init, * as wasm from "../wasm/gql_core.js";
import type {
  ComposeResult,
  Diagnostic,
  GqlCore,
  MockResult,
  PlanResult,
  QueryShapeTree,
  SubgraphInput,
  ValidateQueryResult,
} from "./types";

let corePromise: Promise<GqlCore> | null = null;

/** Load the core once; subsequent calls return the cached instance. */
export function loadCore(): Promise<GqlCore> {
  corePromise ??= (async () => {
    await init();
    return wrap(wasm);
  })();
  return corePromise;
}

function wrap(ns: typeof wasm): GqlCore {
  const json = <T>(s: string): T => JSON.parse(s);
  return {
    validateSubgraph(sdl: string): { diagnostics: Diagnostic[] } {
      return json(ns.validate_subgraph(sdl));
    },
    compose(subgraphs: SubgraphInput[]): ComposeResult {
      return json(ns.compose(JSON.stringify(subgraphs)));
    },
    validateQuery(supergraphSdl: string, operation: string): ValidateQueryResult {
      // The wire shape is a discriminated union — check for schema_error
      // before assuming the payload is query diagnostics (TASK-104).
      const raw = json<{ diagnostics?: Diagnostic[]; schema_error?: { message: string } }>(
        ns.validate_query(supergraphSdl, operation),
      );
      return raw.schema_error
        ? { schemaError: raw.schema_error.message }
        : { diagnostics: raw.diagnostics ?? [] };
    },
    plan(supergraphSdl: string, operation: string, opName?: string): PlanResult {
      return json(ns.plan(supergraphSdl, operation, opName ?? ""));
    },
    executeMock(
      supergraphSdl: string,
      operation: string,
      seed: number,
      mockConfig: string,
    ): MockResult {
      return json(ns.execute_mock(supergraphSdl, operation, BigInt(seed), mockConfig));
    },
    nodeAtPosition(
      sdl: string,
      line: number,
      col: number,
    ): { typeName: string; fieldName?: string } | null {
      const raw = ns.node_at_position(sdl, line, col);
      return JSON.parse(raw);
    },
    queryShape(apiSchemaSdl: string, query: string): QueryShapeTree {
      return json(ns.query_shape(apiSchemaSdl, query));
    },
  };
}
