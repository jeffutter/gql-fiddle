---
id: TASK-38
title: >-
  Fix: compose golden test 'invalid_federation_directive_on_query_root' captures
  an Apollo internal-error, not a real composition error
status: Done
assignee:
  - developer
created_date: '2026-06-10 02:37'
updated_date: '2026-06-12 11:02'
labels:
  - review-followup
milestone: m-1
dependencies:
  - TASK-12
priority: high
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-12 (crates/gql-core/tests/compose.rs:388-447 and its snapshot tests/snapshots/compose__invalid_federation_directive_on_query_root.snap).

Axis: Correct. The golden test claims to exercise an "invalid federation directive" (an @override pointing at a non-existent subgraph), but its second subgraph (`pricing`) defines no `type Query` at all. Composition therefore fails before the @override is ever validated, and the captured snapshot is an Apollo INTERNAL error sentinel:
  {"ok":false,"errors":[{"code":"SUBGRAPH_ERROR","message":"[pricing] An internal error has occurred, please report this bug to Apollo.\n\nDetails: Schema has no type `Query`","locations":[]}]}

This is a false-confidence golden test: it asserts ok:false (so AC#2 passes mechanically) but locks in an internal-bug message ("please report this bug to Apollo") that is explicitly NOT a stable, user-facing composition error, and it never tests the @override directive the test name promises. The whole point of the golden suite (TASK-12) is to lock in MEANINGFUL, stable composition behavior so an apollo-federation upgrade can't silently change it — an internal-error path defeats that.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The error-case test that was named invalid_federation_directive_on_query_root exercises a genuine invalid federation directive usage where both subgraphs are otherwise valid (each has a type Query), so composition reaches and reports the directive error
- [x] #2 The regenerated snapshot's error message does NOT contain the substring 'report this bug to Apollo', and its error code is a real composition error code (e.g. a KEY_*/OVERRIDE_*/FIELD_* code), not SUBGRAPH_ERROR internal-error text
- [x] #3 The test function name and snapshot filename accurately describe the error being exercised
- [x] #4 There are still at least 4 error-case golden tests total
- [x] #5 nix develop -c cargo test -p gql-core passes with the committed snapshot
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/tests/compose.rs. Locate the test `fn invalid_federation_directive_on_query_root()` (currently near the end of the file, after `reference_to_missing_type`). The bug: the second subgraph (`pricing`) has no `type Query`, so composition aborts with an internal Apollo error before validating the @override directive. Confirm by checking the snapshot at crates/gql-core/tests/snapshots/compose__invalid_federation_directive_on_query_root.snap — it contains `SUBGRAPH_ERROR` with message "please report this bug to Apollo".

2. Rewrite this test so it triggers a genuine, stable composition error from an invalid federation directive, with BOTH subgraphs otherwise valid (each has a `type Query`). Recommended approach — an @override pointing to a non-existent subgraph name:
   - Subgraph `inventory` (valid): keep a `type Query { productBySku(sku: String!): Product }` and `type Product @key(fields: "sku") { sku: String! name: String! price: Float }`.
   - Subgraph `pricing` (the invalid one): give it its OWN `type Query` so it is structurally valid, e.g. `type Query { productPrice(sku: String!): Price }`, then override a field using a subgraph name that doesn't exist: `type Product @key(fields: "sku") { sku: String! @external price: Float @override(from: "nonexistent_subgraph") }`.
   - Keep both subgraphs' `extend schema @link(...federation/v2.3 import: [...])` and `@link(...join/v0.3...)` headers exactly as the other tests in this file use them. Import whatever directives the bodies use (@key, @override).
   - If that produces a SUBGRAPH_ERROR/internal message on the pinned version, switch to another genuine directive error — e.g. `type Product @key(fields: "doesNotExist") { sku: String! @external price: Float }` where the key selects a field not defined on Product.

3. Rename the test function and snapshot to match the actual behaviour. Pick a precise name, e.g. `fn invalid_override_subgraph_name()`. The snapshot file is named after the test, so:
   - Delete the stale snapshot: rm crates/gql-core/tests/snapshots/compose__invalid_federation_directive_on_query_root.snap
   - The new snapshot will be written as crates/gql-core/tests/snapshots/compose__invalid_override_subgraph_name.snap when you accept it in step 5.

4. Keep the existing per-test assertions already present in the other error cases (assert !ok, errors non-empty, each error has code+message) and ADD an explicit guard that no error message is the internal sentinel. Use the `val` already parsed above:
       for err in val["errors"].as_array().expect("errors must be an array") {
           let msg = err["message"].as_str().unwrap();
           assert!(
               !msg.contains("report this bug to Apollo"),
               "composition error must be a real, stable error, not an Apollo internal sentinel: {result}"
           );
       }
   (Place these after the existing `for err in errors` loop and before `assert_snapshot!.`)

5. Regenerate and accept the snapshot, then verify:
   - nix develop -c cargo test -p gql-core invalid_override  (runs just the renamed test; produces a .snap.new)
   - Review the .snap.new file: confirm it shows ok:false with at least one error having a real composition code (e.g. FIELD_*, INVALID_*, OVERRIDE_*, KEY_*) and the message does NOT contain "report this bug to Apollo".
   - Accept it by renaming: mv crates/gql-core/tests/snapshots/compose__invalid_override_subgraph_name.snap.new crates/gql-core/tests/snapshots/compose__invalid_override_subgraph_name.snap
     Note: `cargo insta accept` is not available in the dev shell; manual rename is the correct approach.
   - Re-run nix develop -c cargo test -p gql-core and confirm ALL tests pass (all snapshots match).
   - Confirm there are still at least 4 error-case tests in the file (entity_key_field_type_mismatch, duplicate_query_field_without_shareable, reference_to_missing_type, and the renamed one).

6. Commit the renamed test, the new snapshot, and the deletion of the old snapshot together.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the compose golden test by replacing it with a genuine INVALID_FIELD_SHARING error case: both subgraphs now define type Query, and an @override(from: "nonexistent_subgraph") causes composition to report a stable error code (INVALID_FIELD_SHARING) with clear diagnostic locations. Renamed test to field_sharing_violation_with_invalid_override, regenerated snapshot, added internal-sentinel guard assertion, and confirmed all 4 error-case golden tests pass with no Apollo internal-error messages.
<!-- SECTION:FINAL_SUMMARY:END -->
