---
id: TASK-17
title: Add mock-execution tests (determinism + coverage)
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-11 05:28'
labels: []
milestone: m-2
dependencies:
  - TASK-16
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test the mock walker thoroughly, especially that output is deterministic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A determinism test asserts identical output across two runs with the same seed
- [x] #2 Separate tests cover nullability, list length, abstract-type selection, and @skip/@include with variables
- [x] #3 nix develop -c cargo test -p gql-core passes with committed snapshots
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Create `crates/gql-core/tests/mock.rs`. Follow the exact pattern of `tests/compose.rs`: use `use gql_core::execute_mock;` and `use insta::assert_snapshot;` at the top. The file will contain integration tests that call the public WASM-boundary function `execute_mock(supergraph_sdl, operation, variables_json, seed) -> String`. Do NOT import internal helpers (`walk_selection_set`, `hash_path`) -- they are not accessible from `tests/` since `mock` is a private module.

2. Determinism test (covers AC#1): Write a test named `determinism_same_seed_identical_output` that calls `execute_mock` twice with identical inputs and asserts the two results are equal. Use an inline API-schema SDL string (a plain schema with a Query root and scalar fields -- no federation composition needed, matching Approach B from the research brief). Parse both outputs into `serde_json::Value` via `serde_json::from_str(&output).unwrap()` and assert `assert_eq!(val_a, val_b)`. Additionally snapshot one result with `assert_snapshot!(output_a)` using insta (snapshots land in `crates/gql-core/tests/snapshots/`).

3. Separate focused tests for AC#2 -- write four independent test functions:
   a. **Nullability** (`nullability_nonnull_fields_are_never_null`): Use an inline SDL with `String!`, `ID!` non-null fields. Assert the output JSON has no `null` values for those paths (check via `.is_null()` or `.get().is_none()`).
   b. **List length** (`list_fields_have_length_three`): Use an inline SDL with a list field like `[Item]`. Query it and assert `array.len() == 3`.
   c. **Abstract types** (`abstract_types_resolve_to_valid_member`): Use an inline SDL with either a union or interface (e.g., `union SearchResult = User | Product`). Query `__typename` on the result and assert it is one of the allowed member types.
   d. **@skip/@include with variables** (`skip_include_honored_via_variables`): Use an inline SDL with multiple scalar fields. In the operation, use `@skip(if: $var)` and `@include(if: $var)`. Pass different variable JSON strings (e.g., `{"skip": true}`) in two sub-calls and assert field presence/absence accordingly.

   For all four tests above, pass the SDL as a raw string to `execute_mock` (no composition step). The `variables_json` parameter is a JSON object string -- use `{}` for empty variables or e.g. `{"skip": true, "include": false}` for directive tests.

4. Run: `nix develop -c cargo test -p gql-core`. On first run, insta will create new snapshot files under `crates/gql-core/tests/snapshots/mock__*.snap`. Review them, then accept by running `git add crates/gql-core/tests/snapshots/` (or use `cargo insta review` if available). Re-run `nix develop -c cargo test -p gql-core` to confirm all tests pass green with committed snapshots.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Mock execution tests added with comprehensive coverage: determinism (byte-identical JSON across repeated calls, different seed produces different output), nullability (non-null fields never produce null), list length (always 3), abstract types (union and interface resolution to valid members), and @skip/@include directives via variables on both fields and fragment spreads. 5 integration tests in tests/mock.rs and 12 unit tests in src/mock.rs, all passing. Insta snapshot committed for regression tracking. All quality gates (cargo test, fmt, clippy, web tests, tsc, lint) pass clean.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-17 — Mock-execution Tests (Determinism + Coverage)

## Summary
The `mock` module in `gql-core/src/mock.rs` already contains extensive unit tests covering all acceptance criteria. The key architectural finding is that the `mock` module is **private** (`mod mock;`), so integration tests in `tests/mock.rs` cannot access internal helpers like `walk_selection_set`, `resolve_field`, or `hash_path`. Tests must go through the public WASM boundary function `execute_mock(supergraph_sdl, operation, variables_json, seed) -> String`, which accepts/returns JSON strings — matching the existing pattern in `tests/compose.rs`.

## Findings

### 1. Module visibility constraint: integration tests cannot reach internal helpers
The `mock` module is declared as a private module in `lib.rs`:
```rust
mod mock;  // NOT pub mod mock
```
Only these functions are marked `pub` inside it:
- `execute_mock(supergraph_sdl: &str, operation: &str, variables: &Value, seed: u64) -> Value`
- `select_operation(doc: &ECExecDoc) -> Option<&exe::Operation>`
- `walk_fields(...)` — many args
- `resolve_field(...)` — many args
- `unwrap_type(field_type: &Type) -> (NamedType, bool, Type)`
- `is_enum_type(schema: &Schema, name: &str) -> bool`
- `hash_path(seed: u64, path: &[String]) -> u64`

None of these are accessible from `tests/mock.rs`. The **only** entry point available to integration tests is the WASM-boundary function:

```rust
#[wasm_bindgen]
pub fn execute_mock(
    supergraph_sdl: &str,       // JSON-stringified supergraph SDL
    operation: &str,            // GraphQL operation string
    variables_json: &str,       // JSON object string (e.g. "{}")
    seed: u64,                  // deterministic seed
) -> String;                   // JSON envelope string
```

**Implication:** Integration tests must construct the supergraph SDL via `compose()` first (which is public), then pass the result to `execute_mock()`. Or use pre-baked API-schema SDL strings directly (no composition needed for some test cases).

### 2. Determinism test (AC#1)
The deterministic mock walker uses `hash_path(seed, path)` with `DefaultHasher` — it hashes `(seed + all path segments)` to produce a `u64`, then derives scalar values from that hash:
- `gen_int`: `((hash % 100) - 50)` → range [-50, 49]
- `gen_float`: `hash / u64::MAX` → [0.0, 1.0]
- `gen_string`: first 8 hex chars of hash + path length
- `gen_bool`: `hash % 2 == 0`
- `gen_id`: `"id-"` + first 8 hex chars

Since the hasher and all generation functions are pure (no randomness, no time, no thread-local state), identical `(seed, schema, operation)` always produces byte-identical JSON. The existing unit test `ac4_byte_identical_json_on_repeated_calls` already proves this at the internal level. For integration tests, the same approach: call `execute_mock` twice with identical inputs, parse both results into `serde_json::Value`, and assert `assert_eq!(val_a, val_b)`.

**API signature for testing:**
```rust
// Via the WASM boundary (integration test path):
let output = gql_core::execute_mock(&supergraph_sdl, &operation, "{}", 42);
let result: serde_json::Value = serde_json::from_str(&output).unwrap();

// For determinism: call twice, assert identical
assert_eq!(result_a, result_b);
```

### 3. Snapshot testing with insta
The project uses `insta` v1 with the `json` feature enabled (see `Cargo.toml` dev-dependencies):
```toml
insta = { version = "1", features = ["json"] }
```

Pattern from `tests/compose.rs`:
```rust
use insta::assert_snapshot;

#[test]
fn some_test() {
    let result = compose(&input.to_string());
    assert_snapshot!(result);  // snapshots the raw JSON string
}
```

For mock execution tests, snapshot the output string:
```rust
let output = gql_core::execute_mock(&sdl, &operation, "{}", 42);
assert_snapshot!(output);
```

Snapshots are stored in `crates/gql-core/tests/snapshots/` with naming convention `<test_name>.snap`.

### 4. Test data: two approaches for supergraph SDL
**Approach A — Compose then execute (full pipeline):**
Call the public `compose()` function first to get a supergraph SDL, then pass that to `execute_mock()`. This tests the full pipeline end-to-end. The existing `_compose_test_supergraph()` helper in `src/mock.rs` shows a minimal federated schema with `User`, `Product`, `Review` types and list fields (`[Review]`).

**Approach B — Inline API-schema SDL (simpler, faster):**
For focused tests on nullability, abstract types, and @skip/@include, construct plain (non-federated) SDL strings directly. The existing unit tests already demonstrate this pattern — e.g., the union/interface/skip-include tests build their own `api_sdl` string rather than going through composition. This avoids the overhead of federation composition for isolated behavioral tests.

**Approach C — Pre-composed supergraph (recommended for determinism test):**
For the determinism test specifically, compose once at module level or as a helper, then reuse across multiple `execute_mock` calls with different seeds.

### 5. Focused coverage tests (AC#2)
The acceptance criteria call for four distinct test categories. Here's what each needs:

#### Nullability (nonnull fields are never null)
- Need a schema with `NonNullNamed` types (e.g., `String!`, `ID!`, `[Review]!`)
- Assert that the output JSON never has `null` for these fields
- The existing `_compose_test_supergraph()` already has `id: ID!` on User, Review, Product — sufficient

#### List length (lists have exactly 3 elements)
- Need a list field in the schema (e.g., `[Review]`)
- Assert `array.len() == 3`
- The existing supergraph has `reviews: [Review]` on Product — sufficient

#### Abstract type selection (union/interface resolve to valid member)
- Need a union or interface in the schema
- Query `__typename` and assert it's one of the expected members
- The existing unit tests build plain schemas with `union SearchResult = User | Product` and `interface Node { id: ID! }` — these can be adapted for integration tests by using inline SDL

#### @skip/@include with variables
- Need a schema with multiple fields + an operation using `@skip(if: $var)` / `@include(if: $var)`
- Assert field presence/absence based on variable values
- The existing unit test `ac3_skip_include_honored_via_variables` demonstrates this with `name @skip(if: $skip)` and `email @include(if: $include)`

### 6. File structure recommendation
Since the `mock` module is private, there are two viable approaches for creating tests in `tests/mock.rs`:

**Option A — Integration tests only (through public API):**
```
crates/gql-core/tests/mock.rs       // integration tests via gql_core::execute_mock()
crates/gql-core/tests/snapshots/    // insta snapshot files
```

**Option B — Keep tests inline with the implementation:**
Add new test functions to `src/mock.rs` in the existing `#[cfg(test)] mod tests` block. This gives access to internal helpers (`walk_selection_set`, `hash_path`) but doesn't match the task's instruction to create `tests/mock.rs`.

**Recommendation:** Option A (integration tests via public API) aligns with the task spec and follows the existing pattern in `tests/compose.rs`. For focused coverage on abstract types and @skip/@include, use inline SDL strings rather than composing — this is simpler and more readable.

### 7. Gotchas
- **Hasher portability:** `DefaultHasher` may produce different results across Rust versions/platforms. The determinism guarantee holds within a single compilation, but cross-platform snapshot comparison could fail. This is acceptable for project tests since they always run in the same Nix dev shell environment.
- **JSON key ordering:** `serde_json::Map` preserves insertion order of keys. Since the mock walker walks fields in definition order (from the schema's `obj_type.fields`), key ordering is deterministic — but this relies on `IndexMap` or similar ordered map semantics in `apollo-compiler`. The existing tests already depend on this, so it's fine.
- **Snapshot file naming:** insta uses `<test_name>.snap` by default. If the test name contains hyphens, they become underscores in the filename (e.g., `ac3_skip_include_honored_via_variables.snap`).
- **Variable JSON format:** The WASM boundary function expects `variables_json` as a JSON string (not a `Value`). For empty variables, use `"{}"` not `"null"` — though `"null"` is handled gracefully by the unwrap fallback.

### 8. API signatures the developer will call

**Public functions from `gql_core`:**
```rust
// Compose subgraphs → supergraph SDL
pub fn compose(subgraphs_json: &str) -> String;
// Input: JSON array string of [{ name, sdl }]
// Output: JSON envelope string { ok, supergraph_sdl?, errors? }

// Mock-execute an operation
pub fn execute_mock(supergraph_sdl: &str, operation: &str, variables_json: &str, seed: u64) -> String;
// Input: supergraph SDL string, GraphQL operation string, JSON variables string, u64 seed
// Output: JSON envelope string { data, errors }

// Optional: validate an operation against the API schema
pub fn validate_query(supergraph_sdl: &str, operation: &str) -> String;
```

**insta snapshot assertion:**
```rust
use insta::assert_snapshot;
assert_snapshot!(output_string);  // snapshots raw string output
```

## Sources
- `crates/gql-core/src/mock.rs` — Full mock walker implementation with internal unit tests (1029 lines of code + tests). Source of truth for `execute_mock`, `walk_selection_set`, `resolve_field`, scalar generators, and directive handling.
- `crates/gql-core/src/lib.rs` — Public API surface including WASM-boundary `execute_mock`, `compose`, `validate_query`. Confirms `mock` module is private.
- `crates/gql-core/Cargo.toml` — Dev dependencies: `insta = { version = "1", features = ["json"] }`. Confirms snapshot feature is enabled.
- `crates/gql-core/tests/compose.rs` — Pattern reference for integration tests using `insta::assert_snapshot!` with public API functions.
- `crates/gql-core/tests/wasm.rs` — Pattern reference for WASM-boundary testing style (though uses `wasm_bindgen_test`, not applicable to native tests).

## Gaps
1. **Exact snapshot file location:** The project may have a custom `insta_snapshot_dir` setting in `Cargo.toml` or a `.cargo/config.toml`. Should check for this before writing snapshots.
2. **Whether `tests/mock.rs` is the right file name:** Since `src/mock.rs` already exists, naming an integration test file `mock.rs` could cause confusion. The existing `tests/compose.rs` follows the same pattern (module name → test file name), so it's consistent but worth flagging.
3. **Pre-composed supergraph SDL reuse:** If multiple tests need the same composed supergraph, should it be computed once at module level or per-test? Module-level `lazy_static!` or `once_cell` would reduce composition overhead across ~6+ test functions.

<!-- SECTION:NOTES:END -->
