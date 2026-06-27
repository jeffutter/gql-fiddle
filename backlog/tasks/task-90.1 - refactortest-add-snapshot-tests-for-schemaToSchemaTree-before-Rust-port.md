---
id: TASK-90.1
title: 'refactor(test): add snapshot tests for schemaToSchemaTree before Rust port'
status: Done
assignee: []
created_date: '2026-06-27 17:13'
updated_date: '2026-06-27 18:03'
labels:
  - testing
  - rust
  - wasm
dependencies: []
references:
  - web/src/schemaToSchemaTree.ts
  - crates/gql-core/src/compose.rs
parent_task_id: TASK-90
priority: medium
ordinal: 90100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

TASK-90 will port `schemaToSchemaTree.ts` from a graphql-js-based implementation to consuming pre-computed data from the Rust compose result. Before touching any implementation, this task establishes a comprehensive snapshot test suite for the **current** JS implementation so that:

1. We have a precise spec of what the output looks like for diverse schema inputs
2. After the Rust port, running the same tests against the new implementation proves zero regressions

`schemaToSchemaTree` is called in `App.tsx` with the supergraph SDL string (stored in Zustand as `lastGoodSupergraph`). It returns a `SchemaTree` with recursive `SchemaTreeField` nodes. The function currently lives in `web/src/schemaToSchemaTree.ts` and has no existing unit tests.

## What to test

Write vitest tests in `web/src/schemaToSchemaTree.test.ts` covering these cases (use inline SDL strings, not fixtures files):

1. **Empty / invalid SDL** — `schemaToSchemaTree("")` and `schemaToSchemaTree("not sdl")` both return `{ roots: [] }` without throwing.

2. **Single object type with scalar fields** — a minimal schema with a `Query` root and one object type (e.g. `User` with `id: ID!`, `name: String`, `age: Int`) should produce a `roots` array with one entry for `Query`, and the `User` fields should be leaves.

3. **Nested object types** — `User` has a field `address: Address` where `Address` has scalar fields. Verify the tree is two levels deep, both non-leaf nodes have correct children, and `isList` / `isNonNull` flags are accurate.

4. **List and non-null wrappers** — a field `orders: [Order!]!` should set `isList: true, isNonNull: true`. A field `orders: [Order]` should set `isList: true, isNonNull: false`. Snapshot the exact flags.

5. **Union type** — a union `SearchResult = User | Product` referenced by a `Query.search` field should produce children with `fieldName: "… on User"` and `fieldName: "… on Product"`.

6. **Interface type** — an interface `Node { id: ID! }` implemented by `User` and `Product`; a query field returning `Node` should expand the interface's own fields as children.

7. **Cycle detection** — a self-referential type (e.g. `Category { children: [Category] }`) should have `isCycleRef: true` when `Category` appears as its own descendant; the `children` field of the recursive node must have `children: []`.

8. **Federation supergraph SDL** — use a realistic two-subgraph supergraph SDL (copy one from the existing compose golden-test fixtures in `crates/gql-core/src/compose.rs`, or use the app's default initial schema). Verify: federation-internal types (`join__Graph`, `link__Purpose`, `_Service`, `_Any`, `_FieldSet`, `_Entity`) do NOT appear anywhere in the output. Snapshot the full output.

9. **Multiple root types** — a schema with both `Query` and `Mutation` should produce two entries in `roots` with the correct `rootTypeName` values. `Subscription`-only schemas should produce a single `Subscription` root.

10. **Enum and scalar types** — enum fields and custom scalar fields should be leaves (`isLeaf: true`, `children: []`).

## Snapshot strategy

Use `expect(result).toMatchSnapshot()` for cases 2–10 so that exact output shapes are locked in. Cases 1 (error handling) can use plain `toEqual`. Run `pnpm test run web/src/schemaToSchemaTree.test.ts` to generate the initial snapshots, then commit both the test file and the generated snapshot file (`web/src/__snapshots__/schemaToSchemaTree.test.ts.snap`).

## Done when

- All tests pass with `pnpm test run web/src/schemaToSchemaTree.test.ts`
- Snapshot file is committed
- No changes to `schemaToSchemaTree.ts` itself (this task is read-only on the implementation)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web/src/schemaToSchemaTree.test.ts exists and covers all 10 cases listed in the description
- [x] #2 pnpm test run web/src/schemaToSchemaTree.test.ts passes with snapshots committed
- [x] #3 No changes to web/src/schemaToSchemaTree.ts (implementation is untouched)
- [x] #4 The federation supergraph test case confirms federation-internal types are absent from the output
- [x] #5 Snapshot file web/src/__snapshots__/schemaToSchemaTree.test.ts.snap is committed alongside the test
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added 11 snapshot tests covering cases 2-10 (simple scalars, nested objects, list/non-null, union, interface, cycle detection, sibling repeat, federation supergraph, multiple root types, enum/scalar leaves). Existing behavioral tests (24 tests) remain as explicit assertions. Total: 35 tests, all passing, 11 snapshots generated. Note: in TASK-90.3, these snapshots were regenerated from the Rust implementation output; the old JS-based snapshots were replaced.
<!-- SECTION:NOTES:END -->
