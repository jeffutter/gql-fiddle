---
id: TASK-91.1
title: 'refactor(test): add snapshot tests for queryToQueryShape before Rust port'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-27 17:15'
updated_date: '2026-06-27 18:25'
labels:
  - testing
  - rust
  - wasm
  - planned
dependencies: []
references:
  - web/src/queryToQueryShape.ts
  - web/src/QueryShape.tsx
parent_task_id: TASK-91
priority: medium
ordinal: 91100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

TASK-91 will port `queryToQueryShape.ts` from a graphql-js-based implementation to a new Rust WASM export. Before touching any implementation, this task establishes a comprehensive snapshot test suite for the **current** JS implementation. The snapshots serve as a contract: the Rust port must produce identical output for identical inputs.

`queryToQueryShape(apiSchemaSdl: string, query: string): QueryShapeTree` is called in `App.tsx` (or `QueryShape.tsx`) after every query run. It currently has no unit tests.

## What to test

Write vitest tests in `web/src/queryToQueryShape.test.ts`. For each test, provide:
- A realistic `apiSchemaSdl` string (use the API schema SDL, not the supergraph SDL — the function receives the clean client-facing schema)
- A valid GraphQL query string

Cover these cases:

1. **Empty inputs** — `queryToQueryShape("", "")`, `queryToQueryShape("", "{ user { id } }")`, and `queryToQueryShape(validSdl, "")` all return `{ operations: [] }` without throwing.

2. **Invalid SDL** — `queryToQueryShape("not sdl", "{ user { id } }")` returns `{ operations: [] }`.

3. **Invalid query** — `queryToQueryShape(validSdl, "not a query")` returns `{ operations: [] }`.

4. **Simple scalar-only query** — a schema with `type Query { version: String }` and query `{ version }` should produce one operation with one leaf field.

5. **Nested object fields** — schema with `User { id: ID!, name: String! }` and `Query { user: User }`, query `{ user { id name } }`. Snapshot the full `operations[0].fields` tree including `isList`, `isNonNull`, `isLeaf`, `children`.

6. **Named operation** — `query GetUser { user { id } }` should produce `header: "query GetUser"`. An anonymous query `{ user { id } }` should produce `header: "query"`.

7. **Fragment spread** — define a fragment `fragment UserFields on User { id name }` and use it via `{ user { ...UserFields } }`. The output should inline the fragment's fields (no wrapper node for the spread itself).

8. **Inline fragment on union** — schema has `union SearchResult = User | Product`, query `{ search { ... on User { id } ... on Product { sku } } }`. Verify the inline fragment children appear as `"… on User"` and `"… on Product"` nodes.

9. **List fields** — `users: [User!]!` with query `{ users { id } }`. Verify `isList: true, isNonNull: true` on the `users` field.

10. **Multiple operations** — a document with two named operations (`query A { ... }` and `query B { ... }`) should produce `operations` with two entries, each with the correct `header`.

11. **`__typename` introspection field** — `{ user { __typename id } }` should include a leaf node for `__typename` without crashing even though it's not in the type map.

12. **Alias** — `{ me: user { id } }` — check whether the output uses the alias or the field name (document what the current behavior is in the snapshot, so the Rust port can match it).

## Snapshot strategy

Use `expect(result).toMatchSnapshot()` for cases 5–12. Cases 1–3 (error/empty handling) use plain `toEqual({ operations: [] })`. Run `pnpm test run web/src/queryToQueryShape.test.ts` to generate the initial snapshots, then commit both the test file and the snapshot file.

## Done when

- All tests pass with `pnpm test run web/src/queryToQueryShape.test.ts`
- Snapshot file `web/src/__snapshots__/queryToQueryShape.test.ts.snap` is committed
- No changes to `queryToQueryShape.ts` itself
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web/src/queryToQueryShape.test.ts exists and covers all 12 cases listed in the description
- [x] #2 pnpm test run web/src/queryToQueryShape.test.ts passes with snapshots committed
- [x] #3 No changes to web/src/queryToQueryShape.ts (implementation is untouched)
- [x] #4 Snapshot file web/src/__snapshots__/queryToQueryShape.test.ts.snap is committed alongside the test
- [x] #5 The fragment-spread test confirms fragments are inlined (no spread wrapper node in the output)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plan: Add snapshot tests to queryToQueryShape.test.ts

### Current state

`web/src/queryToQueryShape.test.ts` already exists with assertion-based tests covering most of the 12 required cases. However it has no `toMatchSnapshot()` calls and there is no `web/src/__snapshots__/queryToQueryShape.test.ts.snap` file. This task adds snapshot assertions as the regression contract for the Rust port.

### What to change

**File: `web/src/queryToQueryShape.test.ts`**

1. Add `expect(result).toMatchSnapshot()` to the complex test cases (cases 5–12 from the task description). Each case already has an assertion-based test; add the snapshot call immediately after the last assertion so both run.

   Target tests (by describe/it path):
   - `nested selection sets / includes children for nested object types` → add `expect(result).toMatchSnapshot()` after existing assertions
   - `nested selection sets / nests two levels deep` → add snapshot
   - `named fragment inlining / inlines named fragment fields at the use site` → add snapshot
   - `inline fragments / renders inline fragments as '… on TypeName' nodes` → add snapshot
   - `inline fragments / includes children inside inline fragments` → add snapshot
   - `lists and non-null types / sets isList: true for [Product!]! return type` → call `queryToQueryShape` once and snapshot the full result, replacing the individual property assertions with a single snapshot + targeted assertion for the specific property being tested
   - `multiple operations / returns one QueryShapeOperation per operation definition` → add snapshot
   - `basic field selection / handles __typename as a leaf node` → add snapshot

2. Add a new `it` test for **alias** (case 12, not yet present):
   ```ts
   it("records alias as the field name in the output", () => {
     const sdl = `type Query { user: User }\ntype User { id: ID! name: String }`;
     const result = queryToQueryShape(sdl, "{ me: user { id } }");
     // The current JS impl uses the alias as fieldName — document this behaviour
     expect(result).toMatchSnapshot();
   });
   ```
   This documents the current alias behaviour (field name vs alias name) so the Rust port can match it exactly.

### Steps

1. Edit `web/src/queryToQueryShape.test.ts` as described above (~15 line additions across the file).
2. Run `pnpm --filter web test run web/src/queryToQueryShape.test.ts -- --updateSnapshot` (or `pnpm test run web/src/queryToQueryShape.test.ts -u`) to generate the initial snapshot file.
3. Inspect the generated `web/src/__snapshots__/queryToQueryShape.test.ts.snap` — verify the snapshot content looks structurally correct.
4. Commit both files: `web/src/queryToQueryShape.test.ts` and `web/src/__snapshots__/queryToQueryShape.test.ts.snap`.

### Done when

- `pnpm test run web/src/queryToQueryShape.test.ts` passes with no snapshot update prompts
- Snapshot file is committed and present on disk
- No changes to `web/src/queryToQueryShape.ts` (implementation untouched)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added snapshot tests to web/src/queryToQueryShape.test.ts. Added toMatchSnapshot() calls to 8 existing test cases (nested selection sets, fragment inlining, inline fragments, list types, multiple operations, __typename). Added a new alias test case (case 12) documenting that field name is used rather than alias. Generated 9 snapshots in web/src/__snapshots__/queryToQueryShape.test.ts.snap. No changes to queryToQueryShape.ts itself. All tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
