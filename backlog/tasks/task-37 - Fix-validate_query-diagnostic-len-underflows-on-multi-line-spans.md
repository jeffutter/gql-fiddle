---
id: TASK-37
title: 'Fix: validate_query diagnostic len underflows on multi-line spans'
status: To Do
assignee: []
created_date: '2026-06-10 02:37'
updated_date: '2026-06-10 02:37'
labels:
  - review-followup
milestone: m-2
dependencies:
  - TASK-15
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-15 (crates/gql-core/src/validate.rs:43, in extract_executable_diagnostics). The diagnostic `len` is computed as `lc_range.end.column - lc_range.start.column`. `LineColumn.column` is an unsigned integer, so when a validation diagnostic spans multiple lines (the end column can be smaller than the start column) this subtraction underflows.

Axis: Resilient / Correct. The crate's own module doc (lib.rs:5) states "Nothing here panics on bad input." This underflow violates that: in a debug build (how `cargo test` runs) the subtraction panics; in the WASM release build it wraps to a near-u32::MAX value, which the web layer feeds into `endColumn = col + Math.max(len, 1)` (web/src/App.tsx:34), producing a bogus marker range. validate_query is wired at the WASM boundary (lib.rs:58) and consumed by the upcoming query editor (TASK-18/19), so multi-line invalid operations are a realistic, reachable trigger.

The correct semantics for `len` here is a same-line column span (the marker collapses endLineNumber to the start line), so multi-line spans should clamp rather than subtract across lines.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 extract_executable_diagnostics computes len without unsigned underflow: same-line diagnostics use end.column - start.column, multi-line diagnostics yield 0 (or another clamped value), never a wrapped/huge number
- [ ] #2 A new test in validate.rs feeds validate_query a multi-line operation that produces a multi-line diagnostic span and asserts every diagnostic's len is <= the operation string length (this panics in debug without the fix, passes with it)
- [ ] #3 nix develop -c cargo test -p gql-core passes
- [ ] #4 nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings is clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/src/validate.rs. Find the function `extract_executable_diagnostics` (around lines 32-47). The offending line is the `"len"` value in the `json!` macro:
       "len": (lc_range.end.column - lc_range.start.column),

2. Replace ONLY that `"len": ...,` line with an underflow-safe, same-line-aware computation:
       // The editor collapses a diagnostic to one line (endLineNumber == startLineNumber
       // in web/src/App.tsx), so len is a same-line column count. Multi-line spans clamp
       // to 0 to avoid unsigned underflow; saturating_sub guards any end<start case.
       "len": if lc_range.end.line == lc_range.start.line {
           lc_range.end.column.saturating_sub(lc_range.start.column)
       } else {
           0
       },

3. Add a regression test inside the existing `#[cfg(test)] mod tests` block in validate.rs (reuse the existing `_compose_test_supergraph()` helper already defined there). The User entity exposes `id: ID!`, so selecting subfields on that scalar is invalid and produces a diagnostic whose span covers the multi-line `id { ... }` selection:

       #[test]
       fn multiline_diagnostic_span_does_not_underflow() {
           let supergraph_sdl = _compose_test_supergraph();
           let operation = "{\n  me {\n    id {\n      x\n    }\n  }\n}";
           let result = validate_query(&supergraph_sdl, operation);
           let diags = result["diagnostics"]
               .as_array()
               .expect("diagnostics should be an array");
           assert!(!diags.is_empty(), "invalid selection should produce diagnostics");
           for d in diags {
               let len = d["len"].as_u64().expect("len should be a number");
               assert!(
                   len <= operation.len() as u64,
                   "len {len} must not exceed operation length {} (underflow/wrap regression)",
                   operation.len()
               );
           }
       }

   Note: without the fix this test panics in debug (subtraction overflow) or fails the assertion; with the fix it passes. If this particular operation does not yield a multi-line span on the pinned apollo-compiler, keep the test (it still guards the invariant) and additionally confirm the same-line branch is exercised by the existing unknown_field_diagnostic_has_correct_position test.

4. Run and confirm clean:
   - nix develop -c cargo test -p gql-core
   - nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings
   - nix develop -c cargo fmt --check
<!-- SECTION:PLAN:END -->
