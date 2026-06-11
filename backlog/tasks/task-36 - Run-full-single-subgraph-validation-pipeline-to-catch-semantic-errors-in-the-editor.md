---
id: TASK-36
title: >-
  Run full single-subgraph validation pipeline to catch semantic errors in the
  editor
status: Done
assignee:
  - developer
created_date: '2026-06-09 19:07'
updated_date: '2026-06-11 01:44'
labels:
  - bug
  - rust
  - validation
  - editor
milestone: m-1
dependencies:
  - TASK-31
  - TASK-35
modified_files:
  - crates/gql-core/src/validate.rs
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The subgraph editor shows no errors for SDL that is syntactically valid but semantically broken — e.g. a `@key` pointing to a non-existent field, a type using an undefined type as a field type, or invalid federation directive usage. These errors only surface in the Supergraph composition error banner.

## Root Cause

`validate_subgraph` in `crates/gql-core/src/validate.rs` only calls `Subgraph::parse(...)`, which is the first step of a three-stage typestate pipeline. The next two stages — `expand_links()` and `validate()` — perform federation semantic validation on the single subgraph and are never called.

The full pipeline (`parse` → `expand_links` → `validate`) is all public API in `apollo_federation::subgraph::typestate`. Running it would catch per-subgraph semantic errors before composition.

## Fix

In `validate_subgraph`, chain through the full pipeline:

```rust
Subgraph::parse("<subgraph>", "", sdl)
    .and_then(|s| s.expand_links())
    .and_then(|s| s.validate())
```

Each step returns `Result<Subgraph<NextState>, SubgraphError>`. Map `Err` cases the same way as today: fall back to `(line: 1, col: 1, len: 0)` with the error message (the `pub(crate)` field issue from TASK-35 applies here too — TASK-35 may improve location extraction for Phase 1 syntax errors, but semantic errors from `expand_links`/`validate` will still fall back until upstream exposes those fields).

**Key files:**
- `crates/gql-core/src/validate.rs` — the only file that needs changing
- `apollo-federation-2.15.0/src/subgraph/typestate.rs:322, 599` — `expand_links()` and `validate()` signatures
- `crates/gql-core/src/compose.rs` — reference for how the composition pipeline chains these steps

## Scope limit

Cross-subgraph errors (e.g. `@shareable` conflicts between two subgraphs, conflicting field return types) require multi-subgraph composition and cannot be surfaced here. Those belong in the composition error banner and are out of scope for this ticket.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A subgraph with a @key pointing to a non-existent field shows an error marker in the editor
- [x] #2 A subgraph with a field referencing an undefined type shows an error marker in the editor
- [x] #3 Valid federation SDL with @link, @key, @shareable etc. still returns zero diagnostics (TASK-31 regression guard)
- [x] #4 Cross-subgraph errors do NOT need to appear in the editor (scope limit — needs a confirming test)
- [x] #5 nix develop -c cargo test -p gql-core passes with no regressions
- [x] #6 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan: TASK-36

### Summary
Extend Phase 2 of `validate_subgraph` to run the full single-subgraph federation pipeline (`parse → expand_links → assume_upgraded → validate`) instead of stopping at `parse`. This surfaces per-subgraph semantic errors (bad `@key` field-sets, undefined type references) as editor diagnostics. Scope is strictly single-subgraph; cross-subgraph errors remain the composition banner's job.

### Key Files
- **Modify:** `crates/gql-core/src/validate.rs` — the ONLY source file that changes. Replace the Phase 2 match expression (lines ~50-63). No new imports — `Subgraph` is already imported via `use apollo_federation::subgraph::typestate::Subgraph;`. Rust infers the intermediate `Subgraph<Expanded>` / `Subgraph<Upgraded>` types.
- **Add tests in:** `crates/gql-core/src/validate.rs` (same file, existing `#[cfg(test)]` module that already contains the TASK-31 test `valid_federation_sdl_returns_empty_diagnostics`).

### Exact Code Change (from research brief)
Replace the current Phase 2 block:
```rust
match Subgraph::parse("<subgraph>", "", sdl) {
    Ok(_) => json!({ "diagnostics": [] }),
    Err(err) => { /* (1,1,0) fallback */ }
}
```
with:
```rust
// Phase 2 — federation semantic check (only reached when Phase 1 is clean).
let result = Subgraph::parse("<subgraph>", "", sdl)
    .and_then(|s| s.expand_links())
    .map(|s| s.assume_upgraded())
    .and_then(|s| s.validate());

match result {
    Ok(_) => json!({ "diagnostics": [] }),
    Err(err) => {
        json!({ "diagnostics": [json!({
            "severity": "error",
            "message": err.to_string().trim().to_string(),
            "line": 1,
            "col": 1,
            "len": 0,
        })] })
    }
}
```
Notes:
- `.map` (not `.and_then`) for `assume_upgraded()` — it is infallible (`Subgraph<Expanded> -> Subgraph<Upgraded>`, no `Result`).
- The `Err` arm is unchanged from today: `(line: 1, col: 1, len: 0)` fallback + `err.to_string().trim().to_string()`. `SubgraphError` location fields remain `pub(crate)`, so no real location extraction is possible for semantic errors.

### API Signatures (apollo-federation 2.15.0, typestate.rs)
- `Subgraph<Initial>::expand_links(self) -> Result<Subgraph<Expanded>, SubgraphError>` (line 322) — catches both AC#1 and AC#2.
- `Subgraph<Expanded>::assume_upgraded(self) -> Subgraph<Upgraded>` (line 521) — infallible bridge.
- `Subgraph<Upgraded>::validate(self) -> Result<Subgraph<Validated>, SubgraphError>` (line 599) — post-upgrade re-validation; benign on valid SDL.

### TDD Order (write tests first, then change code)
1. **Regression guard first (AC#3):** Confirm the existing `valid_federation_sdl_returns_empty_diagnostics` test still represents the contract. This test MUST stay green after the change — it is the primary guard against the extended pipeline falsely rejecting valid Fed v2 SDL. Run it before touching code (baseline green), then after.
2. **AC#1 — bad `@key` field (new test):** Add `key_with_nonexistent_field_returns_diagnostic`. SDL:
   ```graphql
   extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) {
       query: Query
   }
   type Query { hello: String }
   type User @key(fields: "nonExistent") { id: ID! }
   ```
   Assert `diagnostics` array is non-empty and severity is `error`. Write this test, watch it FAIL against current code (proves the gap), then apply the pipeline change and watch it PASS.
3. **AC#2 — undefined type reference (new test):** Add `field_referencing_undefined_type_returns_diagnostic`. SDL with a `@link` header (to pass Phase 1) plus `someField: NonExistentType`. Assert non-empty diagnostics. Same red→green flow.
4. **AC#4 — scope-limit test (no implementation):** Add a test documenting that cross-subgraph errors are NOT surfaced here. Since a single call to `validate_subgraph` only sees one subgraph, this is a documentation/assertion test: feed a single valid Fed v2 subgraph that WOULD conflict only when composed with another (e.g. a `@shareable` field that is fine standalone) and assert it returns zero diagnostics — confirming cross-subgraph checks are intentionally out of scope. Name it `cross_subgraph_concern_not_flagged_for_single_subgraph`.

### How Each Acceptance Criterion Is Met
- **AC#1 (@key bad field):** `expand_links()` runs federation blueprint validation (`validate_subgraph_schema`), which validates `@key` field-set arguments against the type. Bad field → `SubgraphError` → diagnostic.
- **AC#2 (undefined type):** `expand_links()` runs GraphQL schema validation (`schema.validate_or_return_self()`), which rejects references to unknown types → `SubgraphError` → diagnostic.
- **AC#3 (valid SDL = 0 diagnostics):** Existing TASK-31 test; `assume_upgraded().validate()` re-runs validation but is benign on valid Fed v2.3 SDL. Test stays green.
- **AC#4 (cross-subgraph out of scope):** No implementation — a single `validate_subgraph` call only sees one subgraph, so multi-subgraph conflicts are structurally impossible to detect here. Covered by the scope-limit test in TDD step 4.
- **AC#5 (`cargo test -p gql-core`):** Run `nix develop -c cargo test -p gql-core` — all existing + 3 new tests must pass.
- **AC#6 (`tsc` + `lint`):** No TS changes, but run `pnpm tsc --noEmit` and `pnpm lint` to confirm no incidental breakage.

### Verification Commands
- `nix develop -c cargo test -p gql-core` (AC#5)
- `pnpm tsc --noEmit` and `pnpm lint` (AC#6)

### Risks / Prerequisites
- **Risk (low):** Extended pipeline could false-positive on valid SDL. Mitigated by AC#3 regression test (run before AND after the change). Brief confirms `validate()` is benign on valid Fed v2 schemas (composition path uses the same chain).
- **Test header requirement:** AC#1 and AC#2 SDL fixtures MUST include a `@link` federation header to pass Phase 1 (syntax) before reaching Phase 2 (semantic). Otherwise the test exercises the wrong phase.
- **No upstream change available:** `SubgraphError` location fields stay `pub(crate)`, so the `(1,1,0)` fallback is required and accuracy of marker position for semantic errors is intentionally coarse. This is accepted scope.
- **Prerequisites:** TASK-31 (regression-test fixture) and TASK-35 (Phase 1 syntax check) are already merged; Phase 1 stays untouched — only the Phase 2 `Ok(_)` arm expands.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended `validate_subgraph` in `crates/gql-core/src/validate.rs` to run the full single-subgraph federation pipeline (`parse → expand_links → assume_upgraded → validate`) instead of stopping at parse. This surfaces per-subgraph semantic errors — bad `@key` field-sets and undefined type references — as editor diagnostics with severity "error" and a (1,1,0) fallback position (SubgraphError location fields remain pub(crate)). Three new tests cover AC#1, AC#2, and AC#4 (scope-limit documentation); the TASK-31 regression guard (AC#3) stays green confirming valid Fed v2 SDL produces zero false positives. All 32 cargo tests pass, clippy is clean with -D warnings, formatting is correct, and pnpm tsc/lint are clean with no TypeScript changes required.
<!-- SECTION:FINAL_SUMMARY:END -->

- [ ] #1 A subgraph with a @key pointing to a non-existent field shows an error marker in the editor
- [ ] #2 A subgraph with a field referencing an undefined type shows an error marker in the editor
<!-- AC:END -->

- [ ] #1 A subgraph with a @key pointing to a non-existent field shows an error marker in the editor
- [ ] #2 A subgraph with a field referencing an undefined type shows an error marker in the editor
- [ ] #3 Valid federation SDL with @link, @key, @shareable etc. still returns zero diagnostics (TASK-31 regression guard)
- [ ] #4 Cross-subgraph errors (shareable conflicts, type mismatches across subgraphs) do NOT need to appear in the editor — only single-subgraph semantic errors are in scope
- [ ] #5 nix develop -c cargo test -p gql-core passes with no regressions
- [ ] #6 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-36 — Full Single-Subgraph Validation Pipeline

## 1. Exact Method Signatures and State Transitions

Source: `/home/jeffutter/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/apollo-federation-2.15.0/src/subgraph/typestate.rs`

The typestate pipeline has four states: `Initial → Expanded → Upgraded → Validated`.

```
Initial → expand_links() → Expanded → [upgrade path] → Upgraded → validate() → Validated
                                     ↘ assume_validated() (Fed v2 only, no upgrade needed)
```

### `expand_links()`

- Defined on `impl Subgraph<Initial>` at line 322.
- Signature: `pub fn expand_links(self) -> Result<Subgraph<Expanded>, SubgraphError>`
- Consumes `Subgraph<Initial>`, returns `Result<Subgraph<Expanded>, SubgraphError>`.
- Internally calls `expand_links_internal(true)`, which:
  1. Expands `@link` imports (adds missing directive definitions and type definitions for federation built-ins).
  2. Calls `validate_subgraph_schema()` (GraphQL + federation-blueprint validation for Fed v2 schemas).
  3. Collects subgraph metadata.
- For **Fed v2** schemas: performs full validation (all federation rules applied).
- For **Fed v1** schemas: performs partial validation (some federation rules only).
- Wraps internal `FederationError` into `SubgraphError::new_without_locations(...)`.

### `validate()`

- Defined on `impl Subgraph<Upgraded>` at line 599.
- Signature: `pub fn validate(self) -> Result<Subgraph<Validated>, SubgraphError>`
- Consumes `Subgraph<Upgraded>`, returns `Result<Subgraph<Validated>, SubgraphError>`.
- Calls `validate_subgraph_schema()` again (re-validates after the schema upgrade/normalization).
- Wraps `FederationError` into `SubgraphError::new_without_locations(...)`.

**The gap:** `expand_links()` returns `Subgraph<Expanded>`, but `validate()` requires `Subgraph<Upgraded>`. The bridge is:

```rust
expanded.assume_upgraded()   // infallible: Expanded → Upgraded (skips actual upgrade)
```

`assume_upgraded()` is defined on `impl Subgraph<Expanded>` at line 521: `pub fn assume_upgraded(self) -> Subgraph<Upgraded>`. It is infallible.

### Full pipeline for validation-only (no normalization):

```rust
let result = Subgraph::parse("<subgraph>", "", sdl)
    .and_then(|s| s.expand_links())
    .map(|s| s.assume_upgraded())
    .and_then(|s| s.validate());
```

Note: `.map` (not `.and_then`) is used for `assume_upgraded` because it is infallible.

## 2. Current State of Phase 2 in validate.rs (after TASK-35)

Source: `/home/jeffutter/src/graphql-playground/crates/gql-core/src/validate.rs` lines 50–63.

```rust
// Phase 2 — federation semantic check (only reached when Phase 1 is clean).
match Subgraph::parse("<subgraph>", "", sdl) {
    Ok(_) => json!({ "diagnostics": [] }),
    Err(err) => {
        // SubgraphError location fields are pub(crate); fall back to (1,1,0).
        json!({ "diagnostics": [json!({
            "severity": "error",
            "message": err.to_string().trim().to_string(),
            "line": 1,
            "col": 1,
            "len": 0,
        })] })
    }
}
```

This is what needs to change. The `Ok(_)` arm discards the successful parse result and returns empty diagnostics — even though semantic errors would be caught by `expand_links` or `validate`.

**Replacement:**

```rust
// Phase 2 — federation semantic check (only reached when Phase 1 is clean).
let result = Subgraph::parse("<subgraph>", "", sdl)
    .and_then(|s| s.expand_links())
    .map(|s| s.assume_upgraded())
    .and_then(|s| s.validate());

match result {
    Ok(_) => json!({ "diagnostics": [] }),
    Err(err) => {
        json!({ "diagnostics": [json!({
            "severity": "error",
            "message": err.to_string().trim().to_string(),
            "line": 1,
            "col": 1,
            "len": 0,
        })] })
    }
}
```

No additional imports are needed beyond the existing `use apollo_federation::subgraph::typestate::Subgraph;`. Rust type inference handles the intermediate `Subgraph<Expanded>` and `Subgraph<Upgraded>` types through the chain without explicit annotations.

## 3. Error Coverage for the AC Scenarios

### AC#1: `@key` pointing to a non-existent field

`@key(fields: "nonExistentField")` — Caught by **`expand_links()`**. The federation blueprint validation in `validate_subgraph_schema()` (called inside `expand_links`) validates all directive applications and their field-set arguments. An `@key` referencing a field that does not exist on the type will produce a `FederationError` wrapped into `SubgraphError`.

### AC#2: Field referencing an undefined type

`someField: UndefinedType` — Caught by **`expand_links()`** via GraphQL schema validation (`validate_subgraph_schema` → `schema.validate_or_return_self()`). GraphQL validation rejects references to unknown types (this would be an `InvalidGraphQL` error wrapping an `apollo_compiler` diagnostic).

Both AC scenarios are caught at the `expand_links()` stage. The `validate()` step adds additional post-upgrade federation-specific validation but is not required to surface these two specific errors.

## 4. SubgraphError pub(crate) Issue — (1,1,0) Fallback Still Required

Source: `/home/jeffutter/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/apollo-federation-2.15.0/src/subgraph/mod.rs` lines 334–451.

`SubgraphError` struct fields are all `pub(crate)`:

```rust
pub struct SubgraphError {
    pub(crate) subgraph: String,
    pub(crate) errors: Vec<SingleSubgraphError>,  // contains Vec<Range<LineColumn>>
}
```

External consumers (our `gql-core` crate) cannot access `.errors` or the embedded `locations: Vec<Range<LineColumn>>`.

`SubgraphError` implements `Display` via `format_errors()` which emits `"{code} [{subgraph}] {error}"` — message text only, no line/column.

**Conclusion:** The `(line: 1, col: 1, len: 0)` fallback is confirmed still required for both `expand_links` and `validate` semantic errors. There is no workaround without an upstream change to expose location data.

The only public escape hatch is `SubgraphError::format_errors() -> Vec<(String, String)>` which gives `(code_string, message_string)` pairs. We can use `err.to_string()` which concatenates those via the `Display` impl. The current `err.to_string().trim().to_string()` approach is correct.

## 5. How compose.rs Chains the Pipeline (Reference)

Source: `/home/jeffutter/src/graphql-playground/crates/gql-core/src/compose.rs`

`compose.rs` only calls `Subgraph::parse()` for each subgraph, then passes `Vec<Subgraph<Initial>>` to `fed_compose()`. The composition function internally handles the full pipeline. Our code does not expose a pattern to copy — we must build the chain directly.

The composition pipeline in `apollo-federation/src/composition/mod.rs`:

1. `expand_subgraphs(subgraphs)` — maps `|s| s.expand_links()` over each subgraph.
2. `upgrade_subgraphs_if_necessary(expanded)` — for Fed v2 schemas that need no upgrade: `s.assume_validated()` (skips `validate()`); for upgraded schemas: `s.validate()`.

This confirms two things for our task:
- The `expand_links → assume_upgraded → validate` chain is the correct single-subgraph path.
- For Fed v2 schemas that need no upgrade, `expand_links` already provides full validation. Adding `assume_upgraded().validate()` re-runs `validate_subgraph_schema` but is benign (will not produce spurious errors on valid schemas).

## 6. Summary: Scope and Risk

**File changed:** Only `crates/gql-core/src/validate.rs`.

**Risk:** Low. The only change is expanding the `Ok(_)` arm in Phase 2 to call two additional chained methods. Phase 1 (syntax check) is unchanged. The error-arm mapping is unchanged. The `(1,1,0)` fallback remains.

**Potential regression risk:** The `valid_federation_sdl_returns_empty_diagnostics` test (AC#3) will catch regressions where the extended pipeline falsely rejects valid SDL. The test uses standard Fed v2.3 SDL with `@link`, `@key`, `@shareable`, etc.

**New test cases required (AC#1 and AC#2):**

1. SDL with `@key(fields: "missingField")` on a type that doesn't have that field → must produce diagnostics.
2. SDL with `someField: NonExistentType` → must produce diagnostics.

Both tests need a `@link` header to satisfy Phase 1, e.g.:
```graphql
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) {
    query: Query
}
type Query { hello: String }
type User @key(fields: "nonExistent") { id: ID! }
```

<!-- SECTION:NOTES:END -->
