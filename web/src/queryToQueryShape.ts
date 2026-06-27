/**
 * queryToQueryShape.ts — Query-driven schema slice view.
 *
 * The query shape is now computed inside the Rust `query_shape()` WASM export.
 * This module is a thin wrapper that delegates to `core.queryShape()` and
 * re-exports the `QueryShapeTree` type for consumer modules.
 *
 * The graphql-js SDL parsing that previously lived here has been removed as part
 * of TASK-91. The Rust implementation (`query_shape.rs`) is the canonical source.
 */

import type { GqlCore } from "./core/types";
export type { QueryShapeOperation, QueryShapeTree } from "./core/types";

/**
 * Parse a query document and API schema SDL via Rust WASM, returning the
 * shape of the response. Returns `{ operations: [] }` for invalid/empty inputs.
 */
export function queryToQueryShape(
  core: GqlCore,
  apiSchemaSdl: string,
  query: string,
): import("./core/types").QueryShapeTree {
  return core.queryShape(apiSchemaSdl, query);
}
