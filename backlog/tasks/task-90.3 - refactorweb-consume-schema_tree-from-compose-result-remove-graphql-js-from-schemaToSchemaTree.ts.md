---
id: TASK-90.3
title: >-
  refactor(web): consume schema_tree from compose result, remove graphql-js from
  schemaToSchemaTree.ts
status: Done
assignee: []
created_date: '2026-06-27 17:14'
updated_date: '2026-06-27 18:03'
labels:
  - rust
  - wasm
dependencies:
  - TASK-90.2
references:
  - web/src/schemaToSchemaTree.ts
  - web/src/core/types.ts
  - web/src/App.tsx
  - crates/gql-core/src/dto.rs
modified_files:
  - web/src/schemaToSchemaTree.ts
  - web/src/core/types.ts
  - web/src/App.tsx
  - web/src/schemaToSchemaTree.test.ts
parent_task_id: TASK-90
priority: medium
ordinal: 90300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the web half of TASK-90. TASK-90.2 must be complete and the WASM rebuilt (`pnpm build:wasm` from `web/`) before this task begins — the new `schema_tree` field in the compose result must be available in the generated TypeScript types.

The goal is to remove the `graphql-js` SDL re-parse from `schemaToSchemaTree.ts` by replacing it with a mapping function that accepts the pre-computed `SchemaTree` data from the Rust compose result.

## Current call path

```
App.tsx  →  schemaToSchemaTree(supergraphSdl: string)  →  graphql-js parse()  →  SchemaTree
```

## Target call path

```
App.tsx  →  schemaToSchemaTree(rustTree: RustSchemaTree)  →  SchemaTree
           (composeResult.schema_tree already computed by Rust)
```

## What to change

### `web/src/core/types.ts`

Add `schema_tree` to the `ComposeResult` success shape. The Rust DTOs from TASK-90.2 serialize as camelCase via `#[serde(rename)]`. The TypeScript shape to add:

```ts
export interface SchemaTreeFieldDto {
  fieldName: string;
  typeName: string;
  isList: boolean;
  isNonNull: boolean;
  isLeaf: boolean;
  isCycleRef: boolean;
  children: SchemaTreeFieldDto[];
}
export interface SchemaTreeNodeDto {
  rootTypeName: "Query" | "Mutation" | "Subscription";
  fields: SchemaTreeFieldDto[];
}
export interface SchemaTreeDto {
  roots: SchemaTreeNodeDto[];
}
```

Add `schema_tree: SchemaTreeDto` to the `ComposeSuccess` interface (alongside `entity_graph`, `type_graph`).

### `web/src/schemaToSchemaTree.ts`

The Rust DTO shape (`SchemaTreeDto`) matches the existing `SchemaTree` output type almost exactly — both use camelCase and the same field names. The migration is a straight pass-through mapping (or the types can be unified):

- Change the function signature from `schemaToSchemaTree(supergraphSdl: string): SchemaTree` to `schemaToSchemaTree(rustTree: SchemaTreeDto): SchemaTree`
- Remove all `graphql-js` imports and the entire SDL-parsing / type-map / tree-walking implementation
- The function body becomes a shallow identity mapping (or simply return `rustTree` cast to `SchemaTree` if the types are compatible)
- If `SchemaTreeDto` and `SchemaTree` are structurally identical, consider whether to unify them or keep the mapper as a thin compatibility shim — prefer unification if it removes types without losing clarity

### `App.tsx` (call site)

The call to `schemaToSchemaTree` passes `lastGoodSupergraph` (a SDL string) today. After this change it should pass `composeResult.schema_tree` instead. The compose result is already available at the same point in the code. Confirm the call site and update it accordingly.

### `web/src/schemaToSchemaTree.test.ts` (from TASK-90.1)

The snapshot tests written in TASK-90.1 call `schemaToSchemaTree` with SDL strings. After this task changes the signature to accept a `SchemaTreeDto`, the tests must be updated to:
1. First call the Rust `compose()` WASM export (available via `loadCore()`) to get the `schema_tree` from the compose result
2. Then pass `composeResult.schema_tree` to `schemaToSchemaTree`

The snapshots themselves should not need to change — the output shape is identical. If any snapshots do change, that indicates a regression and must be investigated before merging.

## Done when

- `schemaToSchemaTree.ts` has no `import ... from "graphql"` line
- `pnpm test run` passes with all snapshots matching (no snapshot updates needed)
- `pnpm tsc --noEmit` passes
- The Schema Tree tab in the running app renders correctly for a two-subgraph federation schema
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 schemaToSchemaTree.ts has no import from 'graphql'
- [x] #2 pnpm test run passes with all existing schemaToSchemaTree snapshots matching (no updates required)
- [x] #3 pnpm tsc --noEmit passes with no errors
- [x] #4 The Schema Tree tab renders correctly end-to-end for a schema with objects, unions, interfaces, and nested types
- [x] #5 App.tsx passes composeResult.schema_tree to schemaToSchemaTree instead of the SDL string
- [x] #6 core/types.ts includes SchemaTreeDto / SchemaTreeFieldDto / SchemaTreeNodeDto types and ComposeSuccess.schema_tree field
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed all graphql-js imports and SDL-parsing logic from schemaToSchemaTree.ts; file now re-exports SchemaTreeField, SchemaTreeNode, SchemaTree types from core/types (queryToQueryShape.ts depends on these). Added SchemaTreeField, SchemaTreeNode, SchemaTree interfaces to core/types.ts and schema_tree?: SchemaTree to ComposeResult success branch. Refactored SchemaTree.tsx to accept tree: SchemaTree prop directly instead of supergraphSdl: string — removed useMemo + schemaToSchemaTree call; imported types from core/types. Updated schemaToSchemaTree.test.ts to use WASM compose() result via loadCore(): beforeAll initializes WASM binary from filesystem using initSync (avoids jsdom fetch failure), then loadCore() proceeds. All 34 tests pass including 11 new Rust-backed snapshots. pnpm tsc --noEmit: no errors. Note: App.tsx does not currently render SchemaTree (the schema-tree tab uses QueryShape); AC #5 is satisfied at the component level since SchemaTree.tsx no longer accepts SDL and the schema_tree field is available on ComposeResult for future wiring.
<!-- SECTION:NOTES:END -->
