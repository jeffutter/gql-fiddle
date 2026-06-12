// Loader and typed wrapper around the Rust/WASM core.

import init, * as wasm from "../wasm/gql_core.js";
import type {
  ComposeResult,
  Diagnostic,
  GqlCore,
  MockResult,
  PlanResult,
  SubgraphInput,
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
    validateQuery(supergraphSdl: string, operation: string): { diagnostics: Diagnostic[] } {
      return json(ns.validate_query(supergraphSdl, operation));
    },
    plan(supergraphSdl: string, operation: string, opName?: string): PlanResult {
      return json(ns.plan(supergraphSdl, operation, opName ?? ""));
    },
    executeMock(
      supergraphSdl: string,
      operation: string,
      variables: Record<string, unknown>,
      seed: number,
    ): MockResult {
      return json(
        ns.execute_mock(supergraphSdl, operation, JSON.stringify(variables), BigInt(seed)),
      );
    },
  };
}
