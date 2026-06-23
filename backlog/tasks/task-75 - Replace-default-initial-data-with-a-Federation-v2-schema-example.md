---
id: TASK-75
title: Replace default initial data with a Federation v2 schema example
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 01:12'
updated_date: '2026-06-23 03:03'
labels:
  - enhancement
  - ux
  - federation
  - planned
dependencies: []
modified_files:
  - web/src/store.ts
priority: medium
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On first load (or when the editor is empty/reset), the app should pre-populate with a realistic Apollo Federation v2 example instead of whatever placeholder is currently shown.

The example must include:
- `@link` directives pulling in the Federation v2 spec (`https://specs.apollo.dev/federation/v2.x`)
- At least 2 subgraph SDL definitions (e.g. `users` and `products`)
- A shared entity (e.g. `Product` or `User`) defined in one subgraph and extended/referenced with `@key` in the other
- A supergraph-level or gateway query that stitches them together

The goal is that a new visitor immediately sees a working, non-trivial Federation v2 schema that demonstrates `@key`, `@external`, `@shareable`, or similar directives, giving them a meaningful starting point for exploration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On initial page load (no existing session data), the editor is pre-populated with a Federation v2 SDL example
- [x] #2 The example uses @link to import the federation v2 spec
- [x] #3 At least 2 subgraph schemas are present (e.g. users and products subgraphs)
- [x] #4 A shared entity is defined with @key in one subgraph and referenced/extended in another
- [x] #5 The example is valid and can be executed/validated without errors in the app
- [x] #6 Resetting the editor (if such a feature exists) restores this default Federation v2 example
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Replace the trivial single-subgraph placeholder in `web/src/store.ts` with a realistic Apollo Federation v2 example. This is a pure data change — no new components, no API changes, no Rust/WASM changes required.

## Scope

Single file: `web/src/store.ts`

The three exported constants (`DEFAULT_SUBGRAPHS`, `DEFAULT_QUERY`, `DEFAULT_QUERY_TABS`) are the only things that need to change. `resetToDefaults()` already references these constants, so AC#6 (reset restores the default) is satisfied for free.

## The Federation v2 Example to Use

Model the example on the `users`/`posts` pattern already proven in `crates/gql-core/tests/compose.rs` (the `two_subgraphs_sharing_entity_via_key` and `three_subgraphs_users_posts_and_comments` tests). These SDL forms are known to compose successfully with the pinned `apollo-federation = "=2.15.0"` crate.

### `users` subgraph SDL

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
{
  query: Query
}

type Query {
  me: User
  user(id: ID!): User
}

type User @key(fields: "id") {
  id: ID!
  name: String
  email: String
}
```

### `products` subgraph SDL

```graphql
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
{
  query: Query
}

type Query {
  topProducts: [Product]
  product(id: ID!): Product
}

type Product @key(fields: "id") {
  id: ID!
  name: String
  price: Float
  inStock: Boolean
}

extend type User @key(fields: "id") {
  id: ID! @external
  purchases: [Product]
}
```

Note: The `@link` directive must include only the directives that are actually used in each subgraph's SDL to avoid unused-import hints. The `join/v0.3` link present in the Rust tests is only needed for certain federation configurations; omit it here since composition adds it automatically.

### Default query

```graphql
query {
  topProducts {
    id
    name
    price
  }
  me {
    id
    name
    purchases {
      id
      name
    }
  }
}
```

## Implementation Steps

1. Open `web/src/store.ts`.

2. Replace `DEFAULT_SUBGRAPHS` (lines 98-103) with a two-element array:
   - Element 0: `{ name: "users", sdl: <users subgraph SDL above> }`
   - Element 1: `{ name: "products", sdl: <products subgraph SDL above> }`

3. Replace `DEFAULT_QUERY` (line 105) with the new query shown above.

4. `DEFAULT_SEED` stays at 42 — no change needed.

5. `DEFAULT_QUERY_TABS` is derived from `DEFAULT_QUERY` — it updates automatically.

6. No changes to `resetToDefaults()` are needed; it already references the same constants.

## Validation

After changing the constants, verify composition succeeds:

- Run `pnpm test run` from `web/` — unit tests in `store.test.ts` use hardcoded SDL strings (not the default constants), so they should be unaffected.
- The Rust native tests (`cargo test -p gql-core`) are fully independent of the JS defaults and need no change.
- Optionally run `pnpm dev` and confirm the editor pre-populates with the two-subgraph example and the query executes without errors.

## Acceptance Criteria Map

| AC | How it is satisfied |
|----|---------------------|
| #1 On initial load editor is pre-populated | `DEFAULT_SUBGRAPHS` initialises the Zustand store; localStorage will not exist for new visitors |
| #2 Uses @link to import federation v2 spec | Both subgraph SDLs carry `@link(url: "https://specs.apollo.dev/federation/v2.3", ...)` |
| #3 At least 2 subgraph schemas present | Two entries: `users` and `products` |
| #4 Shared entity with @key | `User` is defined with `@key(fields: "id")` in `users` and extended with `@external` in `products` |
| #5 Valid and executable without errors | SDL pattern is structurally identical to passing compose tests in the Rust test suite |
| #6 Reset restores the default | `resetToDefaults()` already writes `DEFAULT_SUBGRAPHS` / `DEFAULT_QUERY_TABS` — no extra work |

## Files Modified

- `web/src/store.ts` — update `DEFAULT_SUBGRAPHS` and `DEFAULT_QUERY` constants only
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced DEFAULT_SUBGRAPHS in web/src/store.ts with two-element array: 'users' subgraph (defines User @key(fields: "id") with id, name, email) and 'products' subgraph (defines Product @key, extends User @key with @external to add purchases field). Both subgraphs use @link to import federation v2.3 spec. Updated DEFAULT_QUERY to a multi-field query demonstrating cross-subgraph data fetching (topProducts + me.purchases). DEFAULT_QUERY_TABS and resetToDefaults() required no changes — they already reference the constants. All 271 web tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the trivial single-subgraph placeholder in web/src/store.ts with a realistic Apollo Federation v2 example featuring two subgraphs (users and products). Both subgraphs use @link to import federation/v2.3 directives, User is defined with @key in the users subgraph and extended with @external in the products subgraph to add a purchases field, demonstrating cross-subgraph entity references. The default query exercises both subgraphs (topProducts and me.purchases). All 271 existing tests continue to pass.
<!-- SECTION:FINAL_SUMMARY:END -->
