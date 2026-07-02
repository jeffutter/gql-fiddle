---
id: TASK-102
title: Fix interface/union fragment fields silently dropped in mock execution
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 00:20'
labels:
  - review
  - planned
dependencies: []
priority: high
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/gql-core/src/mock.rs:294-297 tests inline-fragment applicability with exact type-name equality (object_type == **tc), so a fragment whose type condition is a supertype (e.g. '... on Node { id }' evaluated on a concrete User) is dropped even though it applies — verified empirically. This produces mock output missing fields for any interface/union fragment query, a common federation pattern, undermining the tool's core 'show the query's shape' purpose. Fix: test type-condition satisfaction — true if tc == object_type, or object_type is a member of union tc, or implements interface tc (via schema union / implementers_map); gate the fragment-spread branch with the same helper.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 query '{ node { __typename ... on Node { id } ... on User { name } } }' on a User includes both id and name
- [x] #2 union-member inline fragments resolve correctly
- [x] #3 a regression test covers supertype fragment conditions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause
`walk_fields` in crates/gql-core/src/mock.rs gated inline-fragment application with exact type-name equality (`*object_type == **tc`) and did not gate named fragment spreads on their type condition at all. A fragment whose type condition is a supertype of the concrete resolved type (an interface like `Node`, or a union like `SearchResult`) was silently dropped for inline fragments, undermining the tool's "show the query's shape" purpose for any federation-style interface/union query.

## Fix — prototyped and verified during planning; NOT yet committed to the working tree (planning phase reverted the edit so the dedicated execute phase applies and commits it cleanly). Apply exactly this:
- Add `type_condition_applies(schema: &Schema, type_condition: &NamedType, object_type: &NamedType) -> bool` in crates/gql-core/src/mock.rs (near `unwrap_type`), reusing the same `schema.get_union` / `schema.get_interface` + `implementers_map()` pattern already used elsewhere in the file (e.g. `resolve_field`, `apply_override`). Returns true when:
  1. `type_condition.as_str() == object_type.as_str()` (exact match, existing behavior), or
  2. `object_type` is a member of `type_condition` when it names a union (`schema.get_union(type_condition)`, check `union_type.members.iter().any(|m| m.as_str() == object_type.as_str())`), or
  3. `object_type` implements `type_condition` when it names an interface (`schema.get_interface(type_condition).is_some()`, then `schema.implementers_map().get(type_condition)` and check membership).
- `InlineFragment` branch in `walk_fields` (~line 294-297): replace the exact-match check
  `inline_frag.type_condition.as_ref().is_none_or(|tc| *object_type == **tc)`
  with
  `inline_frag.type_condition.as_ref().is_none_or(|tc| type_condition_applies(schema, tc, object_type))`.
- `FragmentSpread` branch (~line 267): previously applied unconditionally with no type-condition check at all — this is also a bug (a fragment spread whose type condition doesn't match/overlap the concrete type should not apply). Gate it with
  `if type_condition_applies(schema, &fragment.selection_set.ty, object_type) { ... merge fragment fields ... }`.
  `Fragment.selection_set.ty` is apollo-compiler's stored type condition for named fragment definitions (`fragment F on Type { .. }`) — confirmed by reading apollo-compiler's `executable/from_ast.rs` (`SelectionSet::new(ast.type_condition.clone())`).

## Regression coverage
Add a test (prototyped as `task_102_supertype_fragment_conditions_are_not_dropped`) in the `mock::tests` module: schema with `union SearchResult = User | Product` and `interface Node` implemented by both members; query nests a named fragment `NodeFields` (on interface `Node`) and inline `... on User`/`... on Product` fragments, all inside an outer `... on SearchResult` (union) inline fragment, executed via `search: SearchResult`. Assert `id` (from the interface fragment spread) is always present, and the resolved member's type-specific field (`name`/`title`) is present too — this exercises AC#1 (interface supertype), AC#2 (union member), and AC#3 (regression test) simultaneously, and covers both the inline-fragment and fragment-spread code paths in one test.

Confirmed during planning: this test fails (missing `id`) against the old exact-match logic, and passes with the fix above. Existing `ac2_interface_resolves_to_one_concrete_type` and `ac2_union_resolves_to_one_concrete_type` tests (exact-match cases) are unaffected and continue to pass.

## Verification (run these after applying)
- `cargo build -p gql-core`
- `cargo test -p gql-core` (expect all passing, including the new regression test)
- `cargo fmt -p gql-core`
- `cargo clippy -p gql-core --all-targets` (expect no new warnings)

## Scope note
Single, self-contained ~20-30 line change plus one test in one file — no sub-tickets needed. Direct implementation work belongs on this ticket.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added type_condition_applies(schema, type_condition, object_type) helper in crates/gql-core/src/mock.rs, near unwrap_type. It returns true for exact type match, union membership (schema.get_union + members), or interface implementation (schema.get_interface + implementers_map). Updated walk_fields: the InlineFragment branch now calls this helper instead of exact-match (*object_type == **tc); the FragmentSpread branch, which previously merged fragment fields unconditionally with no type-condition check, is now gated by the same helper using fragment.selection_set.ty as the type condition. Added regression test task_102_supertype_fragment_conditions_are_not_dropped covering a union field (SearchResult) whose selection nests a named fragment on an interface (Node) and per-member inline fragments inside an outer union-typed inline fragment -- verifies id (via interface fragment spread) and the member-specific field (name/title) are both present. Verified: cargo build -p gql-core, cargo test -p gql-core (93 passed, 1 ignored), cargo fmt -p gql-core (only this file reformatted), cargo clippy -p gql-core --all-targets (no issues).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed silent field-dropping for interface/union fragments in mock execution: inline fragments and named fragment spreads now match on type-condition satisfaction (exact match, union membership, or interface implementation) via a new type_condition_applies helper, instead of exact type-name equality. Added a regression test covering interface fragment spreads and union-member inline fragments nested together. All gql-core tests, fmt, and clippy pass.
<!-- SECTION:FINAL_SUMMARY:END -->
