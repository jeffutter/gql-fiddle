---
id: TASK-105
title: >-
  Use apollo-federation error code/location accessors instead of hand-rolled
  matches
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 14:31'
labels:
  - review
dependencies: []
priority: medium
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/gql-core/src/compose.rs:644-766 hand-rolls error_code and error_locations (~110 LOC of per-variant matches) that apollo-federation already provides via CompositionError::code() and ::locations(). The hand-rolled version is also less accurate — it maps SubgraphError/MergeError to generic codes where Apollo delegates to the inner error's real code (INVALID_GRAPHQL, SATISFIABILITY_ERROR, etc). Fix: use err.locations() directly and err.code() for codes. The code strings are a JS-side contract, so run the compose golden tests and reconcile any string differences (or keep a documented compatibility map).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 error_locations and error_code delegate to the apollo-federation accessors
- [x] #2 compose golden tests pass or are updated with justification
- [x] #3 ~100 LOC of hand-rolled matching removed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Single-file refactor in `crates/gql-core/src/compose.rs`. Replace the two hand-rolled functions with thin delegations to `apollo-federation` 2.15.1's own accessors (verified present in the vendored crate at `~/.cargo/registry/.../apollo-federation-2.15.1/src/error/mod.rs`):

- `CompositionError::code(&self) -> ErrorCode` (line ~295) — for `SubgraphError`/`MergeError`/`MergeValidationError` it delegates to the wrapped `SingleFederationError::code()`, giving the real inner code (e.g. `INVALID_GRAPHQL`, `SATISFIABILITY_ERROR`) instead of the generic `SUBGRAPH_ERROR`/`MERGE_ERROR` buckets we hand-roll today.
- `ErrorCode::definition(&self) -> &ErrorCodeDefinition` (line ~2688) and `ErrorCodeDefinition::code(&self) -> &str` (line ~1484) — gives the SCREAMING_SNAKE_CASE string. Confirmed the string constants (`INVALID_GRAPHQL`, `INTERFACE_FIELD_NO_IMPLEM`, etc.) match our existing hand-rolled strings 1:1 for every variant that isn't `SubgraphError`/`MergeError`.
- `CompositionError::locations(&self) -> &[SubgraphLocation]` (line ~528) — already returns the same `SubgraphLocation` type we import and pass to `locations_to_json`. Its variant coverage is a superset of our hand-rolled `error_locations` match (it also covers `InterfaceFieldNoImplem`, which we were silently dropping to `[]`).

## Steps

1. In `crates/gql-core/src/compose.rs`, replace `fn error_code(err: &CompositionError) -> String` (lines 644-728, the ~85-line match) with:
   ```rust
   fn error_code(err: &CompositionError) -> String {
       err.code().definition().code().to_string()
   }
   ```
2. Replace `fn error_locations(err: &CompositionError) -> Value` (lines 741-766, the ~25-line match) with:
   ```rust
   fn error_locations(err: &CompositionError) -> Value {
       locations_to_json(err.locations())
   }
   ```
   Leave `locations_to_json` and `format_error_message` untouched — this ticket is scoped to code/location accessors only, not message formatting.
3. Remove the now-unused `SubgraphLocation` match arms are gone implicitly; double check no other code still needs the old per-variant matches (`format_error_message` has its own separate match on `SubgraphError` for the `[subgraph] message` prefix — keep that one, it's not covered by AC).
4. Run `nix develop -c cargo build -p gql-core` to confirm it compiles (verify `apollo_federation::error::ErrorCode`/`ErrorCodeDefinition` don't need an explicit import — `err.code()` returns `ErrorCode` but since we only call `.definition().code()` inline without naming the type, no new `use` should be required; add one if the compiler asks).
5. Run `nix develop -c cargo test -p gql-core` (compose golden tests live in `crates/gql-core/tests/compose.rs` with snapshots in `crates/gql-core/tests/snapshots/compose__*.snap`).
6. **Expected snapshot diff:** `compose__reference_to_missing_type.snap` currently asserts `"code":"SUBGRAPH_ERROR"` for a `[users] Error: cannot find type ... AddressType` parse failure. Under `err.code()` this becomes `SubgraphError { error: SingleFederationError::InvalidSubgraph, .. }` → `ErrorCode::InvalidGraphQL` → `"INVALID_GRAPHQL"`, which is objectively more accurate per the ticket description (it's a real "invalid GraphQL reference" error, not a generic subgraph bucket). Other golden snapshots (`FIELD_TYPE_MISMATCH`, `INVALID_FIELD_SHARING`) are for variants whose codes are already identical between the hand-rolled match and `ErrorCode`'s definition, so they should not change.
7. Review the diff with `nix develop -c cargo insta review` (or manually edit the `.snap` file) and accept only the `SUBGRAPH_ERROR` → `INVALID_GRAPHQL` change for `compose__reference_to_missing_type.snap`. If any other snapshot changes unexpectedly, stop and reconcile — that would indicate a code-string mismatch between our old hand-rolled map and Apollo's, and needs a documented compatibility shim rather than a silent accept.
8. Check whether the web app (TypeScript side) pattern-matches on the literal string `"SUBGRAPH_ERROR"` anywhere (`rg -n '"SUBGRAPH_ERROR"|SUBGRAPH_ERROR' web/`). If found, update that consumer to handle `INVALID_GRAPHQL` (or whatever the new code is) instead, since this is a JS-side contract per the ticket description.
9. Run full check suite: `nix develop -c cargo test -p gql-core`, `nix develop -c cargo clippy -p gql-core -- -D warnings`, `nix develop -c cargo fmt -- --check` (or repo's standard precommit invocation — see AGENTS.md).
10. Confirm the diff removes ~100 LOC net (AC #3) — the two matches shrink from ~110 combined lines to ~6.

## Acceptance criteria mapping

- AC #1 (delegate to apollo-federation accessors): steps 1-2.
- AC #2 (compose golden tests pass or updated with justification): steps 5-7, with the `SUBGRAPH_ERROR`→`INVALID_GRAPHQL` change documented in the commit message / PR description as an accuracy improvement, not a regression.
- AC #3 (~100 LOC removed): step 10.

## Risk / scope notes

- This is a single cohesive, tightly-scoped change confined to one file plus its golden snapshots and (possibly) one TS consumer string check — not split into sub-tickets.
- No dependency on other tickets; nothing else in the backlog touches `compose.rs`'s error mapping.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced the ~110-line hand-rolled error_code/error_locations matches in crates/gql-core/src/compose.rs with thin delegations to apollo-federation 2.15.1's own CompositionError::code()/locations() accessors:
- error_code(err) -> err.code().definition().code().to_string()
- error_locations(err) -> locations_to_json(err.locations())

Net diff: -107 LOC in compose.rs (109 lines touched, 2 insertions, 107 deletions).

Ran the compose golden test suite (cargo test -p gql-core --test compose). One snapshot changed as anticipated by the plan: compose__reference_to_missing_type.snap's error code went from the generic SUBGRAPH_ERROR to INVALID_GRAPHQL, because apollo-federation's CompositionError::code() delegates SubgraphError to the wrapped SingleFederationError's real code (SingleFederationError::InvalidSubgraph -> ErrorCode::InvalidGraphQL) instead of the generic bucket we hand-rolled. This is a more accurate code for that failure (an actual invalid GraphQL type reference), not a regression. Manually edited the .snap file to accept just that change (cargo-insta CLI isn't installed in this environment) and removed the resulting .snap.new. All other snapshots (FIELD_TYPE_MISMATCH, INVALID_FIELD_SHARING, etc.) were unchanged, confirming the hand-rolled codes matched apollo-federation's for every other variant exercised by the golden tests.

Checked web/ for any TS-side pattern match on the literal string "SUBGRAPH_ERROR" (rg -n 'SUBGRAPH_ERROR' web/) — no matches, so no consumer update was needed.

Verification: cargo build -p gql-core, cargo test -p gql-core (full suite, 82+7+4+3 tests pass), cargo clippy -p gql-core -- -D warnings (clean), cargo fmt -- --check (clean).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted the hand-rolled ~110-line error_code/error_locations match statements in crates/gql-core/src/compose.rs and replaced them with direct delegation to apollo-federation's CompositionError::code() and ::locations() accessors, removing 107 net LOC. One golden snapshot (compose__reference_to_missing_type) intentionally changed from SUBGRAPH_ERROR to the more accurate INVALID_GRAPHQL, matching the accuracy improvement the ticket called for; all other compose golden tests, the full gql-core test suite, clippy, and fmt pass unchanged. No web/ consumers referenced the old SUBGRAPH_ERROR string literal.
<!-- SECTION:FINAL_SUMMARY:END -->
