---
id: TASK-127
title: Seed new subgraphs with default schema so they compile
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-07 13:14'
updated_date: '2026-08-08 04:13'
labels:
  - frontend
  - subgraphs
  - dx
  - planned
dependencies: []
priority: medium
type: bug
ordinal: 163000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`addSubgraph` in `web/src/store.ts:478` creates a new subgraph with `sdl: ""` — a completely empty schema. An empty SDL string has no `Query` type, so it fails to compose/validate the moment it's added, before the user has typed anything. The user is dropped into a broken state by default rather than a valid starting point.

## Desired outcome

When a new subgraph is added, seed its `sdl` with a minimal, valid federation schema — just enough to compile — instead of an empty string. It doesn't need to be a fleshed-out example (the app already ships richer examples in `DEFAULT_SUBGRAPHS`, `web/src/store.ts:35`, used for the initial workspace); a minimal placeholder query field like `_tmp: String` is enough, e.g.:

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3")
{
  query: Query
}

type Query {
  _tmp: String
}
```

Exact placeholder field name/wording is an implementation detail — the requirement is just that a freshly added subgraph composes/validates without the user having to write anything first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Adding a new subgraph (via the + button / addSubgraph) seeds it with non-empty SDL that includes an `extend schema` header and a minimal Query type, instead of an empty string
- [x] #2 A freshly added subgraph passes schema validation/composition on its own, without the user editing it first
- [x] #3 web/src/store.test.ts is updated to assert the new subgraph's default SDL is non-empty and valid rather than ""
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Trivial, single-file fix — no sub-tickets needed.

1. In `web/src/store.ts`, add a `DEFAULT_NEW_SUBGRAPH_SDL` constant (or inline
   template literal) near `DEFAULT_SUBGRAPHS`/`DEFAULT_QUERY`:

   ```ts
   export const DEFAULT_NEW_SUBGRAPH_SDL = `extend schema
     @link(url: "https://specs.apollo.dev/federation/v2.3")
   {
     query: Query
   }

   type Query {
     _tmp: String
   }
   `;
   ```

2. In `addSubgraph` (store.ts:485-492), change
   `{ name, sdl: "" }` → `{ name, sdl: DEFAULT_NEW_SUBGRAPH_SDL }`.

3. Update `web/src/store.test.ts`:
   - The two existing assertions that check a freshly-added subgraph's sdl is
     `""` (line 49, and any others found via `rg 'sdl\).toBe\(""\)'`) must be
     updated: since `addSubgraph` is now the thing under test for this
     ticket, those expectations should assert the new subgraph's sdl is
     non-empty (e.g. `expect(ws.subgraphs[1].sdl).not.toBe("")`) rather than
     `toBe("")`. Note line 49's test ("updates only the targeted subgraph's
     sdl") is specifically checking that `setSubgraphSdl(0, ...)` didn't
     touch subgraph 1 — keep that intent, just change the untouched value's
     expectation from `""` to the new default (or `.not.toBe("")`).
   - Add a new test under the "adds a subgraph" describe block (or a new
     `describe("addSubgraph default sdl", ...)`) that asserts:
     - `ws.subgraphs[1].sdl` is non-empty
     - it contains `extend schema` and `type Query` (sanity check on shape)
     - it parses as valid GraphQL SDL via `graphql`'s `parse()` (already a
       project dependency — see `web/src/planToFieldRanges.ts` for import
       style: `import { parse } from "graphql"`) — call `parse(sdl)` and
       assert it does not throw. This is a lightweight syntax check; full
       federation composition validation (via the WASM core's
       `validateSubgraph`/`compose`) is out of scope for this unit test file,
       which is intentionally WASM-free and synchronous. If deeper
       composition confidence is wanted later, that belongs in an
       integration test (e.g. alongside `App.test.tsx` /
       `LiveSession.integration.test.ts`, which already exercise
       `addSubgraph` through the UI).
   - Do NOT change the `beforeEach` seed workspace's `products` subgraph
     (store.test.ts:23) — that's pre-existing fixture data unrelated to the
     `addSubgraph` default, leave `sdl: ""` there as-is.

4. Sanity-check other call sites: `App.test.tsx` and
   `LiveSession.integration.test.ts` reference `addSubgraph` — grep them for
   any assertion on the resulting sdl (e.g. `toBe("")`) that would now break,
   and update if found. Expected to be none (they likely test
   name/activeSubgraph, not sdl), but verify.

## Verification

- `cd web && pnpm test -- store.test.ts` (or project's equivalent test
  command — check `web/package.json` / `AGENTS.md` for exact invocation)
- `cd web && pnpm test` full suite to catch any other broken assertions in
  App.test.tsx / LiveSession.integration.test.ts
- `cd web && pnpm typecheck` / `pnpm lint` if available, per AGENTS.md
- Manually confirms AC #2: the seeded SDL is a copy of the pattern already
  proven valid by `DEFAULT_SUBGRAPHS` in the same file (extend schema +
  @link + query:Query + type Query), so it composes/validates on its own by
  construction — no new composition logic is introduced.

## Acceptance criteria mapping

- AC #1 → step 1 + 2
- AC #2 → satisfied by using the same proven-valid SDL shape as
  `DEFAULT_SUBGRAPHS`
- AC #3 → step 3
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added `DEFAULT_NEW_SUBGRAPH_SDL` (web/src/store.ts:90) — same proven-valid extend-schema/@link/query:Query shape as DEFAULT_SUBGRAPHS, with a `_tmp: String` placeholder field. addSubgraph (store.ts:506) now seeds new subgraphs with this constant instead of `""`. store.test.ts updated: existing assertions checking the sibling subgraph's untouched sdl now expect the new default instead of `""`, plus a new "addSubgraph default sdl (TASK-127)" describe block asserting the seeded sdl is non-empty, contains `extend schema`/`type Query`, and parses via graphql's `parse()` without throwing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed addSubgraph seeding an empty (uncompilable) schema. New subgraphs now start with a minimal valid federation schema (extend schema + @link + query:Query + a _tmp: String placeholder), matching the same shape already proven valid by DEFAULT_SUBGRAPHS. Full suite verified: 492/492 tests passing, clean tsc, clean lint (only pre-existing unrelated warnings in useGraphQLPipeline.ts).
<!-- SECTION:FINAL_SUMMARY:END -->
