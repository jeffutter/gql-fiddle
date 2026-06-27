---
id: TASK-90
title: 'refactor(rust): move schema-tree computation into compose() Rust layer'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-27 17:12'
updated_date: '2026-06-27 18:03'
labels:
  - architecture
  - rust
  - wasm
  - planned
dependencies:
  - TASK-90.1
  - TASK-90.2
  - TASK-90.3
references:
  - web/src/schemaToSchemaTree.ts
  - web/src/SchemaTree.tsx
  - web/src/queryToQueryShape.ts
  - crates/gql-core/src/compose.rs
  - crates/gql-core/src/dto.rs
  - web/src/core/types.ts
  - >-
    backlog/tasks/task-61 -
    refactorrust-move-entity-graph-type-graph-analysis-into-compose-Rust-layer.md
priority: medium
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`schemaToSchemaTree.ts` (~360 lines) re-parses the supergraph SDL from scratch using `graphql-js` every time it's called. The `compose()` function in Rust already has the fully-parsed supergraph in memory immediately after composition and discards it — the schema tree can be computed there instead.

The schema tree is a recursive containment hierarchy rooted at `Query`, `Mutation`, and `Subscription`. It walks all reachable types, detects cycles, and filters federation-internal types (`join__`, `link__`, `_Service`, etc.). The current output shape:

```ts
interface SchemaTree {
  roots: SchemaTreeNode[];
}
interface SchemaTreeNode {
  rootTypeName: "Query" | "Mutation" | "Subscription";
  fields: SchemaTreeField[];
}
interface SchemaTreeField {
  fieldName: string;
  typeName: string;
  isList: boolean;
  isNonNull: boolean;
  isLeaf: boolean;
  isCycleRef: boolean;
  children: SchemaTreeField[];  // recursive
}
```

## Prior art in this codebase

TASK-61 moved `entity_graph` and `type_graph` from `schemaToEntityGraph.ts` / `schemaToTypeGraph.ts` into the compose result using the same pattern. Follow that approach exactly: add a `schema_tree` field to the Rust compose success JSON, update `core/types.ts`, and refactor the web consumer. See `crates/gql-core/src/compose.rs` functions `build_entity_graph` and `build_type_graph` for the established Rust pattern.

## Goal

Add `schema_tree` to the `compose()` return value. The web layer drops the `graphql-js` parse from `schemaToSchemaTree.ts` and instead maps the pre-computed Rust data to the same output shape the `SchemaTree.tsx` component already consumes.

## Shape of the change

**Rust side (`crates/gql-core/`):**
- Add `SchemaTreeNode`, `SchemaTreeField`, `SchemaTree` DTO structs to `dto.rs` (recursive, with `Box` for children)
- Add `build_schema_tree(sdl: &str) -> SchemaTree` in `compose.rs`, analogous to `build_entity_graph` / `build_type_graph`
- Walk the parsed supergraph using `apollo_compiler::Schema`, filtering federation-internal names using the existing `is_federation_internal()` helper
- Emit the tree with proper cycle detection (track ancestor type names to set `is_cycle_ref: true`)
- Serialize into the compose success JSON as `schema_tree` alongside existing fields

**Web side (`web/src/`):**
- Update `core/types.ts` to add `schema_tree: SchemaTree` on `ComposeResult`
- Refactor `schemaToSchemaTree.ts` to accept the pre-computed data from the compose result (mapping Rust DTOs to the existing `SchemaTree` output shape) rather than calling `graphql-js` `parse()`
- `SchemaTree.tsx` and `App.tsx` call sites should require no changes if the output shape is preserved

## Execution order

1. TASK-90.1 first — add snapshot tests against the current JS implementation so regressions are immediately visible
2. TASK-90.2 — add `schema_tree` to the Rust compose result
3. TASK-90.3 — migrate the web layer to consume the Rust-computed data

## Risk notes

- The `success_path_keys_match_contract` test in `compose.rs` asserts the exact set of keys in a successful compose response. Adding `schema_tree` will break it. TASK-90.2 must update that test.
- Cycle detection: `schemaToSchemaTree.ts` uses a mutable `Set` passed through recursive calls (`ancestorPath`). The Rust equivalent must track the same ancestor path per traversal branch.
- Union members: the JS code renders union members as `"… on MemberType"` children with `fieldName: "… on MemberType"`. The Rust DTO must emit this string verbatim so the web layer maps it correctly.
- Root type extension merging: the supergraph SDL can have multiple `extend type Query { ... }` blocks. The JS handles this by accumulating field lists during pass 1. The Rust side using `apollo_compiler::Schema` already merges extensions, so this should be simpler.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TASK-90.1 snapshot tests pass against the current JS implementation before any Rust work begins
- [x] #2 cargo test -p gql-core passes after TASK-90.2
- [x] #3 pnpm test run passes after TASK-90.3
- [x] #4 The Schema Tree tab in the web app renders identically before and after the migration for schemas with objects, unions, interfaces, scalars, enums, cross-type references, and cycles
- [x] #5 schemaToSchemaTree.ts has no import from 'graphql' after TASK-90.3
- [x] #6 The compose result JSON includes a schema_tree field on success and the existing entity_graph / type_graph fields are unaffected
- [x] #7 Federation-internal types (join__, link__, _Service, _Any, _FieldSet, _Entity) do not appear in the schema tree output
- [x] #8 The snapshot tests added in TASK-90.1 still pass after TASK-90.3 (identical output from Rust-backed implementation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Move `schemaToSchemaTree` from a graphql-js re-parse in the browser to a field pre-computed inside the Rust `compose()` call. The pattern mirrors TASK-61 which moved `entity_graph` and `type_graph` by the same mechanism.

## Sub-ticket sequencing

```
TASK-90.1 (snapshot tests, JS) → TASK-90.2 (Rust implementation) → TASK-90.3 (web migration)
```

All three subtasks must run in order. TASK-90.2 blocks on TASK-90.1 because the snapshots are the regression guard. TASK-90.3 blocks on TASK-90.2 because it requires the WASM rebuild to expose `schema_tree` in the generated TypeScript types.

## Sub-ticket breakdown

### TASK-90.1 — Snapshot tests for the current JS implementation

Add or convert existing tests in `web/src/schemaToSchemaTree.test.ts` to use `toMatchSnapshot()` for all non-trivial cases (the file already has assertion-based tests; this task adds snapshot coverage). Generate and commit the snapshot file at `web/src/__snapshots__/schemaToSchemaTree.test.ts.snap`. No implementation changes.

### TASK-90.2 — Rust: add `schema_tree` to compose result

- Add `SchemaTreeField`, `SchemaTreeNode`, `SchemaTree` structs to `crates/gql-core/src/dto.rs` (mirroring the TS interfaces in `schemaToSchemaTree.ts`)
- Add `pub(crate) fn build_schema_tree(sdl: &str) -> SchemaTree` to `crates/gql-core/src/compose.rs` following the `build_entity_graph` / `build_type_graph` pattern
- Use `apollo_compiler::Schema` (which already merges type extensions) for traversal
- Apply `is_federation_internal()` and `is_builtin_scalar()` helpers already in scope
- Track `ancestor_path: HashSet<String>` for cycle detection (insert before recurse, remove after — same as JS `Set` approach)
- Emit union members as `"… on MemberType"` strings using U+2026 (not three ASCII dots)
- Wire into `compose()` success JSON as `"schema_tree"` alongside `entity_graph` and `type_graph`
- Update `success_path_keys_match_contract` test in `compose.rs` to include `"schema_tree"` in the expected key list
- Add Rust unit tests: minimal compose with schema_tree, federation-internal filtering, cycle detection

### TASK-90.3 — Web: consume Rust schema_tree, remove graphql-js parse

- Add `SchemaTreeFieldDto`, `SchemaTreeNodeDto`, `SchemaTreeDto` interfaces to `web/src/core/types.ts`
- Add `schema_tree: SchemaTreeDto` to the `ComposeResult` success branch
- Change `schemaToSchemaTree` signature from `(supergraphSdl: string): SchemaTree` to `(rustTree: SchemaTreeDto): SchemaTree`; remove all graphql-js imports and SDL-parsing logic; the body becomes a thin pass-through (or identity cast if shapes are structurally identical)
- Update `SchemaTree.tsx`: the component currently calls `schemaToSchemaTree(supergraphSdl)` inside `useMemo`. Its `SchemaTreeProps` must change from `{ supergraphSdl: string }` to receive the pre-computed `SchemaTreeDto` from the compose result instead
- Update callers of `<SchemaTree>` to pass `schema_tree` from the compose result instead of the SDL string
- Update `web/src/schemaToSchemaTree.test.ts` to compose via WASM `compose()` and pass `composeResult.schema_tree` to `schemaToSchemaTree`; snapshots must match without updates
- Rebuild WASM (`pnpm build:wasm` in `web/`) before running tests

## Integration verification

After TASK-90.3 is merged:
1. `pnpm test run` passes with all `schemaToSchemaTree` snapshots matching (no updates required)
2. `pnpm tsc --noEmit` passes
3. `cargo test -p gql-core` passes
4. The Schema Tree tab in the running app renders identically for schemas with objects, unions, interfaces, scalars, enums, cross-type references, and cycles

## Key technical considerations

- **U+2026 ellipsis**: JS uses `"… on MemberType"` (Unicode ellipsis, U+2026). The Rust implementation must emit the same character verbatim.
- **Cycle detection granularity**: the JS uses a per-field-path mutable `Set` (insert before recursing children, delete after). The Rust must replicate this exactly to avoid marking sibling-branch repeats as cycle refs.
- **Extension merging**: `apollo_compiler::Schema` already merges `extend type Query { }` blocks, so the two-pass approach in JS (accumulating root fields across extensions) is handled automatically.
- **`success_path_keys_match_contract` test**: this test asserts the exact set of JSON keys in a successful compose result. TASK-90.2 must update it to include `"schema_tree"`.
- **WASM rebuild**: TASK-90.3 must run `pnpm build:wasm` before tests or TypeScript compilation to pick up the new `schema_tree` field.
- **`SchemaTree.tsx` prop change**: the component receives `supergraphSdl: string` today and calls `schemaToSchemaTree` internally. After TASK-90.3 it must receive the pre-computed tree instead. All render sites must be updated.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed in three sequential subtasks following the pattern established by TASK-61 (entity_graph / type_graph migration).\n\nTASK-90.1: Added 11 snapshot tests plus 24 behavioral tests to schemaToSchemaTree.test.ts covering all specified cases (scalars, nesting, list/non-null, unions, interfaces, cycle detection, federation filtering, multiple root types, enums).\n\nTASK-90.2: Added SchemaTreeField / SchemaTreeNode / SchemaTree structs to dto.rs (serde camelCase). Implemented build_schema_tree() in compose.rs using apollo_compiler::Schema: federation-internal filtering, per-branch ancestor HashSet for cycle detection, union members as U+2026 inline-fragment stubs. Wired into compose() success JSON as schema_tree. Updated success_path_keys_match_contract test and 3 insta integration snapshots. Added 3 Rust unit tests. cargo test -p gql-core: 77 passed.\n\nTASK-90.3: Stripped all graphql-js imports and SDL parsing from schemaToSchemaTree.ts (now a pure type re-export module). Added SchemaTreeField / SchemaTreeNode / SchemaTree interfaces to core/types.ts; added schema_tree?: SchemaTree to ComposeResult success branch. Refactored SchemaTree.tsx to accept tree: SchemaTree prop instead of supergraphSdl: string. Updated tests to call loadCore().compose() and extract schema_tree using initSync filesystem bootstrap in beforeAll (avoids jsdom fetch failure). pnpm test run: 372 tests pass. pnpm tsc --noEmit: clean."]
<!-- SECTION:FINAL_SUMMARY:END -->
