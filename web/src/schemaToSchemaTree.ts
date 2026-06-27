/**
 * schemaToSchemaTree.ts — Schema containment hierarchy types.
 *
 * The schema tree is now computed inside the Rust compose() call and returned
 * as the `schema_tree` field on the compose result (see crates/gql-core/src/dto.rs
 * and web/src/core/types.ts). This module re-exports the TypeScript interfaces for
 * consumer modules (e.g. queryToQueryShape.ts) that depend on the `SchemaTreeField`
 * type.
 *
 * The graphql-js SDL parsing that previously lived here has been removed as part
 * of TASK-90. The Rust implementation (compose.rs: build_schema_tree) is the
 * canonical source of truth.
 */

export type { SchemaTreeField, SchemaTreeNode, SchemaTree } from "./core/types";
