---
id: TASK-106
title: Fix node_at_position off-by-one at exclusive end column
status: Done
assignee:
  - ralph
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 02:47'
labels:
  - review
  - planned
dependencies: []
priority: low
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/gql-core/src/node_at_pos.rs:34-50 — the contains() closure treats col == end_col as inside, but apollo-compiler's LineColumn end is exclusive (one past the last char), so a cursor resting one column past a node resolves to that node instead of null/the next node. Causes hover/highlight to occasionally fire on the wrong token at boundaries. Fix: use col >= end_col for the end-line bound; add a boundary unit test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a cursor at the column immediately after a node no longer matches that node
- [x] #2 interior positions are unchanged
- [x] #3 a boundary unit test is added
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

`contains()` closure at line 46 uses `col > end_col` to reject positions past the end, but
apollo-compiler's `LineColumn.end` is **exclusive** (one past the last character). So a cursor
at exactly `end_col` passes through `contains` and matches the node — it should not.

## Fix

1. **Change `col > end_col` to `col >= end_col`** in the `contains` closure (line 46 of
   `crates/gql-core/src/node_at_pos.rs`). This is the only code change needed — the type
   definition path already guards with `line < end_line`, so the bug only manifests on
   field-level ranges.

2. **Add a boundary unit test** that places the cursor at the exclusive end column of a field
   and asserts it returns `null` (not the field). Use a minimal SDL where the field name is
   a single character on its own line, making the end column unambiguous:
   ```
   type Q {
   a: String
   }
   ```
   Field `a` on line 2 starts at column 1. If its range ends at column 2 (exclusive), position
   (2, 2) should return `null`.

3. Run `cargo test -p gql-core node_at_pos` to verify all existing tests still pass plus the new one.

## Verification
- `cargo test -p gql-core node_at_pos` — all tests pass (existing + new boundary test)
- `cargo fmt --check` — clean
- `cargo clippy --all-targets -- -D warnings` — clean
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Changed col > end_col to col >= end_col in contains() closure — apollo-compiler's LineColumn.end is exclusive, so col == end_col should not match.

Added exclusive_end_column_does_not_match_field test: cursor at (2, 10) for field 'a' with range (2,1)->(2,10) correctly does not match the field.

All 13 node_at_pos tests pass. cargo fmt --check and cargo clippy --all-targets -- -D warnings clean.

Also cleaned up a debug_test module I added to lib.rs during investigation (removed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed off-by-one in node_at_position: changed `col > end_col` to `col >= end_col` in the contains() closure, since apollo-compiler's LineColumn.end is exclusive. Added a boundary test (exclusive_end_column_does_not_match_field) that places a cursor at the exact exclusive end column of a field and asserts it does not match. All 13 node_at_pos tests pass, clippy and fmt clean.
<!-- SECTION:FINAL_SUMMARY:END -->
