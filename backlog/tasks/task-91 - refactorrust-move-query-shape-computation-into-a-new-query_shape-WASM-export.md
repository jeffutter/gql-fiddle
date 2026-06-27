---
id: TASK-91
title: >-
  refactor(rust): move query-shape computation into a new query_shape() WASM
  export
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-27 17:14'
updated_date: '2026-06-27 18:26'
labels:
  - architecture
  - rust
  - wasm
  - planned
dependencies:
  - TASK-91.1
  - TASK-91.2
  - TASK-91.3
references:
  - web/src/queryToQueryShape.ts
  - web/src/QueryShape.tsx
  - web/src/schemaToSchemaTree.ts
  - crates/gql-core/src/validate.rs
  - crates/gql-core/src/plan.rs
  - crates/gql-core/src/lib.rs
  - crates/gql-core/src/dto.rs
  - web/src/core/types.ts
  - >-
    backlog/tasks/task-90 -
    refactorrust-move-schema-tree-computation-into-compose-Rust-layer.md
priority: medium
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`queryToQueryShape.ts` (~335 lines) re-parses both the API schema SDL and the user's query string using `graphql-js` on every query run to compute the "response shape" — a tree of selected fields matching the response the server will return. Both of these strings are already parsed by the Rust layer during `plan()` and `execute_mock()`.

The query shape is distinct from the schema tree (TASK-90): it is query-specific (only the fields selected by the current query, not the full schema), updated every time the query editor changes, and displayed in the Query Shape tab (formerly Schema Tree).

Unlike `schemaToSchemaTree`, which fits naturally into the `compose()` result, `queryToQueryShape` depends on both the API schema SDL and a query string that changes independently. It should be a new top-level WASM export `query_shape(api_schema_sdl, query)` — similar in structure to the existing `validate_query(supergraph_sdl, operation)` export.

## Current output shape

```ts
interface QueryShapeTree {
  operations: QueryShapeOperation[];
}
interface QueryShapeOperation {
  header: string;          // e.g. "query GetUser" or "query"
  fields: SchemaTreeField[]; // same recursive type as schemaToSchemaTree
}
```

`SchemaTreeField` is the same recursive type used by `SchemaTree`. After TASK-90 completes `SchemaTreeField` / `SchemaTreeFieldDto` types will already exist in `dto.rs` and `core/types.ts`, making TASK-91 cheaper.

## Prior art

`validate_query` in `validate.rs` parses the supergraph SDL and query in Rust. `plan` in `plan.rs` does the same. The new `query_shape` function follows the same pattern: parse the API schema SDL, parse the query, walk the selection set recursively against the type map.

## Goal

Add `query_shape(api_schema_sdl: &str, query: &str) -> String` as a new `#[wasm_bindgen]` export in `lib.rs`, backed by `query_shape::query_shape()` in a new `crates/gql-core/src/query_shape.rs` module. The web layer replaces the `graphql-js` implementation in `queryToQueryShape.ts` with a thin wrapper that calls this WASM export.

## Execution order

1. TASK-91.1 first — snapshot tests against the current JS implementation
2. TASK-91.2 — Rust implementation (depends on TASK-90.2 since it reuses `SchemaTreeField` DTO)
3. TASK-91.3 — Web migration

## Note on TASK-90 dependency

TASK-91.2 can reuse `SchemaTreeField`, `SchemaTreeFieldDto` from TASK-90.2 since the output shape is identical. Plan TASK-91.2 after TASK-90.2 is merged. If parallelism is needed, the types can be duplicated temporarily and merged later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TASK-91.1 snapshot tests pass against the current JS implementation before any Rust work begins
- [x] #2 cargo test -p gql-core passes after TASK-91.2
- [x] #3 pnpm test run passes after TASK-91.3
- [x] #4 The Query Shape tab renders identically before and after the migration for diverse queries including fragments, inline fragments, aliases, and union type conditions
- [x] #5 queryToQueryShape.ts has no import from 'graphql' after TASK-91.3
- [x] #6 The WASM bundle exports query_shape as a callable function
- [x] #7 The snapshot tests added in TASK-91.1 still pass after TASK-91.3 (identical output from Rust-backed implementation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Port `queryToQueryShape.ts` from a ~335-line graphql-js implementation to a new Rust WASM export `query_shape(api_schema_sdl, query)`. The web layer becomes a thin wrapper.

The work follows the same pattern as TASK-90 (schema tree migration) and TASK-61 (entity/type graph migration). Three sequential sub-tickets drive execution.

## Sub-ticket sequencing

```
TASK-91.1 (snapshot tests, JS baseline)
  → TASK-91.2 (Rust query_shape.rs module)
    → TASK-91.3 (web migration, remove graphql-js)
```

Each task blocks the next. Do not begin TASK-91.2 until TASK-91.1's snapshots are committed. Do not begin TASK-91.3 until TASK-91.2's Rust export passes `cargo test -p gql-core`.

## How sub-tickets fit together

**TASK-91.1** establishes the regression contract: snapshot tests for the current JS implementation that the Rust port must match exactly. These snapshots catch any output divergence between JS and Rust during TASK-91.3.

**TASK-91.2** creates the Rust implementation in `crates/gql-core/src/query_shape.rs`, adds `QueryShapeOperation` and `QueryShapeTree` DTOs to `dto.rs` (reusing `SchemaTreeField` from TASK-90.2), and wires the `query_shape()` function as a `#[wasm_bindgen]` export in `lib.rs`. No web changes.

**TASK-91.3** rebuilds the WASM, updates `web/src/core/types.ts` and `web/src/core/index.ts` to expose `queryShape()` on `GqlCore`, replaces the 335-line implementation in `queryToQueryShape.ts` with a one-liner call to `core.queryShape()`, updates `QueryShape.tsx` to accept a `core` prop, threads `core` through `App.tsx`, and updates the test file to load `core` via `loadCore()`.

## Integration and verification

After all three sub-tickets merge:

1. `pnpm test run` passes — all `queryToQueryShape.test.ts` snapshots match without updates
2. `pnpm tsc --noEmit` passes — no TypeScript errors
3. `cargo test -p gql-core` passes — all Rust unit tests pass
4. The Query Shape tab renders identically in the running app for queries with fragments, inline fragments, aliases, and union type conditions
5. `queryToQueryShape.ts` has zero imports from `"graphql"`

## Risks

- **apollo-compiler API surface for ExecutableDocument**: The pseudocode in TASK-91.2 shows the intended approach; the actual API may differ slightly. Consult `validate.rs` and `plan.rs` for working examples.
- **Anonymous vs named operation ordering**: The JS iterates `queryDoc.definitions` in source order (anonymous first if written first). The Rust walker must produce the same ordering. Verify with the multi-operation snapshot test.
- **Snapshot stability**: TASK-91.3 must not require any snapshot updates. If snapshots differ, fix the Rust implementation — do not update snapshots.
- **WASM rebuild**: TASK-91.3 requires `pnpm build:wasm` before TypeScript compilation or tests; skipping this step causes confusing "property does not exist" errors.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation note: Used ExecutableDocument::parse (not parse_and_validate) to match JS graphql.parse() permissiveness. The linked field.definition.ty on each Field node in the parsed ExecutableDocument provides type metadata directly, making a separate type map unnecessary. __typename is special-cased to output typeName: '__typename' with isList/isNonNull: false to match the JS behavior where __typename is not found in the typeMap. Named operations are iterated via doc.operations.named (IndexMap preserves document source order), followed by the anonymous operation if present.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed all three sub-tasks (91.1, 91.2, 91.3) sequentially:\n\n1. TASK-91.1: Added snapshot tests to web/src/queryToQueryShape.test.ts covering 12 cases (empty inputs, invalid SDL/query, scalar fields, nested objects, named operations, fragment inlining, inline fragments, list types, multiple operations, __typename, alias). Generated 9 snapshots as the regression contract.\n\n2. TASK-91.2: Created crates/gql-core/src/query_shape.rs with pub fn query_shape(api_schema_sdl, query) -> Value. Added QueryShapeOperation and QueryShapeTree DTOs to dto.rs. Wired as #[wasm_bindgen] export in lib.rs. 92 Rust tests pass.\n\n3. TASK-91.3: Built WASM. Replaced 335-line graphql-js implementation in queryToQueryShape.ts with a 1-line WASM call. Added QueryShapeOperation/QueryShapeTree to core/types.ts and queryShape() to GqlCore in core/index.ts. Updated QueryShape.tsx to accept core prop. Added coreInstance state to App.tsx. Updated queryToQueryShape.test.ts to use WASM core via loadCore(). All 373 tests pass, all 9 snapshots match without updates, pnpm tsc --noEmit passes.
<!-- SECTION:FINAL_SUMMARY:END -->
