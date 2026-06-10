---
id: TASK-38
title: >-
  Fix: compose golden test 'invalid_federation_directive_on_query_root' captures
  an Apollo internal-error, not a real composition error
status: To Do
assignee: []
created_date: '2026-06-10 02:37'
updated_date: '2026-06-10 02:38'
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
- [ ] #1 The error-case test that was named invalid_federation_directive_on_query_root exercises a genuine invalid federation directive usage where both subgraphs are otherwise valid (each has a type Query), so composition reaches and reports the directive error
- [ ] #2 The regenerated snapshot's error message does NOT contain the substring 'report this bug to Apollo', and its error code is a real composition error code (e.g. a KEY_*/OVERRIDE_*/FIELD_* code), not SUBGRAPH_ERROR internal-error text
- [ ] #3 The test function name and snapshot filename accurately describe the error being exercised
- [ ] #4 There are still at least 4 error-case golden tests total
- [ ] #5 nix develop -c cargo test -p gql-core passes with the committed snapshot
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/tests/compose.rs. Locate the test `fn invalid_federation_directive_on_query_root()` (around lines 388-447). The bug is that the second subgraph (`pricing`) has no `type Query`, so composition aborts with an internal Apollo error before validating the directive.

2. Rewrite this test so it triggers a genuine, stable composition error from an invalid federation directive, with BOTH subgraphs otherwise valid. Recommended approach — an invalid @key fields selection (stable code, no internal error):
   - Subgraph `inventory` (valid): keep a `type Query { productBySku(sku: String!): Product }` and `type Product @key(fields: "sku") { sku: String! name: String! }`.
   - Subgraph `pricing` (the invalid one): give it its OWN `type Query` so it is structurally valid, e.g. `type Query { productPrice(sku: String!): Price }` and `type Price { amount: Float! }`, then reference a NON-EXISTENT field in a key: `type Product @key(fields: "doesNotExist") { sku: String! @external price: Float }`. A key selecting a field that no subgraph defines is a stable composition error (a KEY_* family code), not an internal panic.
   - Keep both subgraphs' `extend schema @link(...federation/v2.3 import: [...])` and `@link(...join/v0.3...)` headers exactly as the other tests in this file use them. Import whatever directives the bodies use (@key, @external).
   - If, on the pinned apollo-federation, that particular construct still yields a SUBGRAPH_ERROR/internal message, switch to another genuine directive error that produces a stable code — e.g. `@requires(fields: "missingField")` on a field, or `@provides` referencing a missing field. The acceptance test below (step 5) is the gate.

3. Rename the test function and the snapshot to match the actual behaviour. Pick a precise name, e.g. `fn invalid_key_fields_selection()`. The snapshot file is named after the test, so:
   - Delete the stale snapshot: rm crates/gql-core/tests/snapshots/compose__invalid_federation_directive_on_query_root.snap
   - The new snapshot will be written as crates/gql-core/tests/snapshots/compose__invalid_key_fields_selection.snap when you accept it in step 5.

4. Keep the existing per-test assertions already present in the other error cases (assert !ok, errors non-empty, each error has code+message) and ADD an explicit guard that the message is not the internal sentinel:
       assert!(
           !result.contains("report this bug to Apollo"),
           "composition error must be a real, stable error, not an Apollo internal error: {result}"
       );
   (Place this after you have the `result` String and before assert_snapshot!.)

5. Regenerate and accept the snapshot, then verify:
   - nix develop -c cargo test -p gql-core   (produces a .snap.new for the renamed test)
   - Review the .snap.new: confirm ok:false, a real error code (NOT SUBGRAPH_ERROR internal text), and no "report this bug to Apollo".
   - Accept it: nix develop -c cargo insta accept   (if cargo-insta is unavailable, rename the *.snap.new to *.snap by hand).
   - Re-run nix develop -c cargo test -p gql-core and confirm all snapshots match.
   - Confirm there are still at least 4 error-case tests in the file (entity_key_field_type_mismatch, duplicate_query_field_without_shareable, reference_to_missing_type, and the renamed one).

6. Commit the renamed test, the new snapshot, and the deletion of the old snapshot together.
<!-- SECTION:PLAN:END -->
