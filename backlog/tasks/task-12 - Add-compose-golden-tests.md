---
id: TASK-12
title: Add compose() golden tests
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-09 17:36'
labels: []
milestone: m-1
dependencies:
  - TASK-2
  - TASK-28
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lock in composition behavior with snapshot (golden) tests so future upgrades of the unstable apollo-federation crate cannot silently change output. Cover success and known error cases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 At least 3 success snapshots and 4 error-case snapshots exist and are committed
- [x] #2 Error-case snapshots assert composition fails (ok:false) with stable code/message
- [x] #3 nix develop -c cargo test -p gql-core passes with committed snapshots
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Create crates/gql-core/tests/compose.rs. The file imports from the crate root (use gql_core::compose;) and from insta (use insta::assert_snapshot;). Insta is already a dev-dependency in Cargo.toml with the json feature enabled for JSON-aware diffing.

2. Each test calls gql_core::compose(json_string) where json_string is a raw string literal containing a JSON array of subgraph definitions with name and sdl keys (matching the WASM boundary contract exactly - this exercises parse -> compose -> serialize end-to-end). Snapshot the returned JSON string using assert_snapshot! with a descriptive label. The snapshot files will be written to crates/gql-core/tests/compose/snapshots/ by insta.

3. Cover at least:

   (a) THREE valid multi-subgraph compositions:

   - Two subgraphs, independent (users + posts): Each defines its own Query root and entity types with no overlap. Use Federation 2.3 @link directives in each schema (same pattern as existing tests in src/compose.rs).

   - Three subgraphs (users + posts + comments): Add a Comment entity that references both User and Post to exercise multi-hop composition.

   - Two subgraphs sharing an entity via @key: An inventory subgraph defines Product @key(fields: "sku") with sku String. A pricing subgraph extends it with extend type Product @key(fields: "sku") { sku String @external, currency String }. This verifies the @key + @external extension pattern.

   (b) FOUR invalid cases that must fail composition:

   - Entity @key field type mismatch (exercises FIELD_TYPE_MISMATCH): Subgraph A defines User with id ID. Subgraph B extends User with id String. Note the type difference: ID vs String.

   - Two subgraphs define same Query field without @shareable (exercises INVALID_FIELD_SHARING or TYPE_KIND_MISMATCH): Both define Query { hello: String } on the same type with no @shareable directive.

   - Reference to a missing type (exercises FIELD_TYPE_MISMATCH or similar): A subgraph has User { homeAddress: AddressType } where no subgraph defines a type AddressType.

   - Invalid federation directive usage (exercises DIRECTIVE_COMPOSITION_ERROR or similar): Use @key on the Query root type, which Federation reserves for entities only. E.g.: Query @key(fields: "__typename") { me: User } and User @key(fields: "id") { id: ID! }.

4. Generate snapshots: nix develop -c cargo test -p gql-core. Review the produced .snap.new files; accept them (if 'cargo insta accept' is unavailable, rename each *.snap.new to *.snap). Commit the .snap files alongside the test file in the same commit.

5. Re-run nix develop -c cargo test -p gql-core to confirm all snapshots match and no regressions.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added 7 golden (snapshot) tests in crates/gql-core/tests/compose.rs: 3 success cases (independent subgraphs, three-subgraph multi-hop composition, entity sharing via @key with String field) and 4 error cases (field type mismatch, duplicate query fields without @shareable, missing type reference, invalid federation directive). Each error test asserts ok:false with non-empty errors carrying stable code/message DTOs. All 22 Rust tests pass, all web tests pass (38), formatting/linting/Clippy/type-checking clean. Snapshots committed alongside test file.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-12 — Add compose() golden tests

## Summary

Golden (snapshot) tests for `gql_core::compose()` should use the `insta` crate's `assert_snapshot!` macro with file snapshots stored in a `tests/compose/snapshots/` directory. The pure-Rust composition path uses `apollo_federation::composition` internally — specifically `expand_subgraphs`, `pre_merge_validations`, `merge_subgraphs`, and `post_merge_validations` — which returns either `Supergraph<Merged>` (success) or `CompositionFailure` (error). Four well-known Federation 2 error codes map cleanly to the required test cases: `KEY_FIELDS_MISSING_ON_BASE`, `DUPLICATE_FIELD_DEFINITION`, `FIELD_TYPE_MISMATCH`-related errors, and invalid directive usage.

## Findings

### 1. Insta snapshot testing — API signatures and file structure

**File snapshots** (recommended for this task):

- **Macro:** `insta::assert_snapshot!(snapshot_name, value)` — stores in a separate `.snap` file.
- **Location:** By default, next to the test file under `tests/<module>/snapshots/`. For `tests/compose.rs`, insta writes to `tests/compose/snapshots/`.
- **Naming convention:** `<test_module>__<snapshot_name>.snap`. The module name is derived from the source file (e.g., `compose`).
- **Unnamed snapshots** auto-increment (`something`, `something-2`). Named snapshots are explicit: `assert_snapshot!("my_name", value)`.

```rust
use insta::assert_snapshot;

#[test]
fn test_valid_two_subgraphs() {
    let result = gql_core::compose(json!([
        { "name": "users", "sdl": "..." },
        { "name": "posts",  "sdl": "..." }
    ]));
    // Snapshot the entire JSON envelope string:
    assert_snapshot!("valid_two_subgraphs", result);
}
```

- **`.snap.new` files:** Generated when a snapshot doesn't exist or differs. The task plan says: if `cargo insta accept` is unavailable, rename `*.snap.new` → `*.snap`. This is safe and correct — the `.snap.new` file contains the exact output to commit.
- **`cargo-insta` CLI** (dev-dependency): `cargo insta review` (interactive), `cargo insta accept` (non-interactive accept all), `cargo insta reject` (reject all). Install via `cargo install cargo-insta` or add as dev-dep.

**Inline snapshots** (alternative, not recommended here):
`assert_snapshot!(value, @"expected string")` — embeds in source. Avoid for large JSON output from composition.

**Key gotcha:** Insta serializes via `Display` (`format!("{}", value)`) by default for `assert_snapshot!`. Since the compose function returns a JSON string (per the WASM API contract), this is ideal — no extra serialization needed. If you pass a struct, insta uses `Debug` formatting; use `serde_json::to_string_pretty()` to get readable JSON in snapshots.

### 2. Apollo Federation composition API — pure Rust path

The `apollo-federation` crate (v2.15.0) is internal to Apollo Router and has **no stable public API**. However, the composition entry points are accessible from `apollo_federation::composition`:

**Key types:**

| Type | Module | Purpose |
|------|--------|---------|
| `Subgraph<Initial>` | `apollo_federation::subgraph::typestate` | Parsed subgraph (raw SDL → typestate) |
| `Subgraph<Validated>` | Same | Post-validation subgraph |
| `Supergraph<Merged>` | `apollo_federation::composition` | Merged supergraph schema |
| `CompositionFailure` | Same | Error container on merge failure |
| `MergeResult` | `apollo_federation_types::composition` | `{ supergraph: String, hints: Vec<Issue> }` |

**Pure-Rust composition (no JS needed for tests):**

```rust
use apollo_federation::subgraph::typestate::{Initial, Subgraph};
use apollo_federation::composition::{
    expand_subgraphs, pre_merge_validations, merge_subgraphs, post_merge_validations, CompositionFailure,
};
```

**Step-by-step composition pipeline:**

1. **Parse:** `Subgraph::<Initial>::parse(name: &str, url: &str, sdl: &str)` → `Result<Subgraph<Initial>, SubgraphError>`
2. **Expand:** `expand_subgraphs(Vec<Subgraph<Initial>>)` → `Result<Vec<Subgraph<Validated>>, CompositionFailure>` — adds federation directives
3. **Pre-merge validation:** `pre_merge_validations(&[Subgraph<Validated>])` → `Result<(), CompositionFailure>` — checks for @key conflicts, duplicate fields, etc.
4. **Merge:** `merge_subgraphs(Vec<Subgraph<Validated>>, options)` → `Result<Supergraph<Merged>, CompositionFailure>`
5. **Post-merge validation:** `post_merge_validations(&Supergraph<Merged>)` → `Result<(), CompositionFailure>`

**On success:** `supergraph.schema().schema().to_string()` gives the supergraph SDL string.

**On failure:** `CompositionFailure` has `.errors: Vec<CompositionError>` and `.hints: Vec<CompositionHint>`. Each `CompositionError` has a `.code` (String) and `.message` (String), plus location info.

**For test fixtures**, the input format matches the WASM API contract:
```rust
// Input to gql_core::compose():
serde_json::Value = json!([
    { "name": "subgraph_name", "sdl": "type Query { ... }" },
    ...
])
```

The compose function (already implemented in Spike 0) wraps the above pipeline and returns:
```rust
// Success:
serde_json::json!({ "ok": true, "supergraph_sdl": "...", "hints": [...] })
// Failure:
serde_json::json!({ "ok": false, "errors": [{"code":"...","message":"..."}] })
```

**Critical API note:** The `apollo_federation_types::javascript::SubgraphDefinition` struct (`{ name, url, sdl }`) is used by the hybrid composition path. For pure Rust tests, you only need `{ name, sdl }` — pass empty string for `url`.

### 3. Apollo Federation 2 — error codes relevant to test cases

The four required error cases map to specific Federation 2 error codes:

| Test case | Error code(s) | How to trigger |
|-----------|---------------|----------------|
| **(a) Entity @key field type mismatch** | `FIELD_TYPE_MISMATCH` or `KEY_FIELDS_MISSING_ON_BASE` | Subgraph A defines entity `User` with `@key(fields: "id: ID")`. Subgraph B extends `User` with `@key(fields: "id: String")` — type mismatch between subgraphs. |
| **(b) Two subgraphs define same field without @shareable** | `DUPLICATE_FIELD_DEFINITION` | Both subgraphs define `type Query { hello: String }` on the same type, neither marked `@shareable`. |
| **(c) Reference to missing type** | `UNKNOWN_TYPE` or `FIELD_UNRESOLVABLE_ON_TYPE` | A field references a type that no subgraph defines (e.g., `field: NonExistentType`). |
| **(d) Invalid federation directive usage** | `INVALID_DIRECTIVE_SYNTAX` or `DIRECTIVE_USAGE_INVALID` | Use `@key` on a scalar, or `@shareable` on an enum, or any directive used in a context Federation doesn't support. |

**Source of truth:** [Apollo Federation error reference](https://github.com/apollographql/federation/blob/main/docs/source/schema-design/federated-schemas/reference/errors.mdx) — the Rust implementation mirrors these codes. Error codes are stable strings (e.g., `"KEY_FIELDS_MISSING_ON_BASE"`) that survive version upgrades, making them ideal for golden test assertions.

### 4. Recommended fixture schemas

**Success case 1 — Two subgraphs (users + posts):**
```graphql
# users subgraph
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])
type Query { user(id: ID!): User }
type User @key(fields: "id") { id: ID!, name: String }

# posts subgraph  
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])
type Query { post(id: ID!): Post }
type Post @key(fields: "id") { id: ID!, title: String, authorId: ID! }
```

**Success case 2 — Three subgraphs (users + posts + comments):**
Add a `Comment` entity that references both `User` and `Post`.

**Success case 3 — Entity shared via @key across two subgraphs:**
```graphql
# inventory subgraph
type Product @key(fields: "sku") { sku: String!, price: Int }

# pricing subgraph (extends Product)
extend type Product @key(fields: "sku") { sku: String! @external, currency: String }
```

**Error case 1 — Entity @key field type mismatch:**
`users` defines `User @key(fields: "id: ID")`, `posts` extends with `id: String`.

**Error case 2 — Duplicate field without @shareable:**
Both subgraphs define `type Query { hello: String }`.

**Error case 3 — Missing type reference:**
A field typed as `NonExistentType` that no subgraph defines.

**Error case 4 — Invalid directive usage:**
`@key(fields: "id")` on a scalar or non-entity type, or `@shareable` on an enum.

### 5. Gotchas and tradeoffs

- **Snapshot stability across apollo-federation upgrades:** The supergraph SDL output is the golden value. If apollo-federation v2.16 changes formatting (e.g., directive placement), snapshots will differ — this is the *intended* behavior. Review `.snap.new` files manually before accepting to distinguish legitimate formatting changes from behavioral regressions.
- **Error message stability:** Federation 2 error messages may change between patch versions. Snapshot the entire JSON envelope including error codes (stable) and messages (may drift). If message drift is a concern, snapshot only `errors[].code` as a secondary assertion.
- **`cargo insta` availability:** The task plan mentions renaming `.snap.new` → `.snap` as fallback. `cargo-insta` is not in the workspace Cargo.toml dev-deps yet — add `insta = { version = "...", features = ["json"] }` and optionally `cargo-insta` for review workflow. The `"json"` feature enables JSON-aware diffing in snapshots.
- **WASM vs native:** These tests run in native Rust (`cargo test -p gql-core`), not WASM. The composition logic is the same; only the WASM boundary layer (wasm-bindgen exports) is skipped. This means no `getrandom` / JS feature concerns for these tests.
- **Test module location:** Per insta conventions, place snapshots in `tests/compose/snapshots/` alongside `tests/compose.rs`. The directory is auto-created on first test run if it doesn't exist.

## Sources

- Kept: [insta — Snapshot Testing for Rust](https://insta.rs/) — primary docs for assert_snapshot!, file vs inline snapshots, .snap format, cargo-insta CLI
- Kept: [apollo-composition lib.rs source](https://github.com/apollographql/federation-rs/blob/main/apollo-composition/src/lib.rs) — actual Rust composition pipeline code showing expand_subgraphs, merge_subgraphs, pre/post merge validations
- Kept: [apollo_federation_types::javascript::SubgraphDefinition](https://docs.rs/apollo-federation-types/latest/apollo_federation_types/javascript/struct.SubgraphDefinition.html) — struct definition (name, url, sdl)
- Kept: [Apollo Federation error reference](https://github.com/apollographql/federation/blob/main/docs/source/schema-design/federated-schemas/reference/errors.mdx) — complete list of Federation 2 error codes with descriptions
- Kept: [GraphQL Playground Implementation Plan (doc-2)](backlog/tasks/doc-2 - GraphQL-Playground-Implementation-Plan.md) — project context, WASM API contract, pinned versions

## Gaps

1. **Exact apollo-federation v2.15 composition API surface:** The docs.rs page for 2.12.0 was available but not 2.15.0 (may not be published yet). The developer should verify the exact module paths in the pinned version by reading `apollo_federation/src/composition/mod.rs` in the vendored dependency.
2. **Whether `cargo-insta` is already a dev-dependency:** The task says "insta is already a dev-dependency" but doesn't mention `cargo-insta`. Confirm whether `cargo insta accept` will work or if manual rename is required.
3. **Exact error code strings in apollo-federation v2.15:** Error codes are internal to the Rust crate and may differ slightly from the JavaScript gateway error codes documented online. The developer should grep the source for known code strings (e.g., `KEY_FIELDS_MISSING_ON_BASE`) to confirm exact spelling.
4. **Supergraph SDL formatting stability:** No benchmark exists on how often apollo-federation changes supergraph SDL output between minor versions. This affects how aggressively snapshots should be reviewed on upgrades.

<!-- SECTION:NOTES:END -->
