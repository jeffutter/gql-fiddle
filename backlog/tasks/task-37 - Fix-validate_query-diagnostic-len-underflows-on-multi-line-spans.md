---
id: TASK-37
title: 'Fix: validate_query diagnostic len underflows on multi-line spans'
status: Done
assignee:
  - developer
created_date: '2026-06-10 02:37'
updated_date: '2026-06-11 02:00'
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
- [x] #1 extract_executable_diagnostics computes len without unsigned underflow: same-line diagnostics use end.column - start.column, multi-line diagnostics yield 0 (or another clamped value), never a wrapped/huge number
- [x] #2 A new test in validate.rs feeds validate_query a multi-line operation that produces a multi-line diagnostic span and asserts every diagnostic's len is <= the operation string length (this panics in debug without the fix, passes with it)
- [x] #3 nix develop -c cargo test -p gql-core passes
- [x] #4 nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings is clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

ORIENTATION: crates/gql-core/src/validate.rs contains two diagnostic-building functions. `validate_subgraph` (function starts ~line 22) ALREADY uses the underflow-safe pattern at validate.rs:43:
    "len": lc_range.end.column.saturating_sub(lc_range.start.column),
The bug is in the OTHER function, `extract_executable_diagnostics` (function starts ~line 76), which still does a raw subtraction. The fix makes the executable-document path consistent with the existing safe subgraph path. Use line 43 as the reference for the correct pattern.

1. Open crates/gql-core/src/validate.rs. Find the function `extract_executable_diagnostics` (function spans ~lines 76-91). The offending line is the `"len"` value in the `json!` macro, at ~line 87:
       "len": (lc_range.end.column - lc_range.start.column),

2. Replace ONLY that `"len": ...,` line with an underflow-safe, same-line-aware computation. Note this is slightly stronger than the existing line-43 pattern: in addition to `saturating_sub`, it clamps multi-line spans to 0, because the editor collapses each diagnostic to a single line (see web/src/App.tsx:40-41, where `endLineNumber == startLineNumber` and `endColumn = col + Math.max(len, 1)`), so `len` is a same-line column count:
       // The editor collapses a diagnostic to one line (endLineNumber == startLineNumber
       // in web/src/App.tsx:40-41), so len is a same-line column count. Multi-line spans
       // clamp to 0 to avoid unsigned underflow; saturating_sub guards any end<start case.
       // Mirrors the safe pattern already used in validate_subgraph (validate.rs:43).
       "len": if lc_range.end.line == lc_range.start.line {
           lc_range.end.column.saturating_sub(lc_range.start.column)
       } else {
           0
       },

3. Add a regression test inside the existing `#[cfg(test)] mod tests` block in validate.rs (reuse the existing `_compose_test_supergraph()` helper already defined there at ~line 235). The test supergraph exposes `Query.me: User` and `User { id: ID! }` (confirmed), so selecting subfields on the `id: ID!` scalar is invalid and produces a diagnostic whose span covers the multi-line `id { ... }` selection:

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

   Note: without the fix this test panics in debug (subtraction overflow) or fails the assertion; with the fix it passes. If this particular operation does not yield a multi-line span on the pinned apollo-compiler, keep the test (it still guards the invariant) and rely on the existing `unknown_field_diagnostic_has_correct_position` test (~line 407) to exercise the same-line branch.

4. Run and confirm clean:
   - nix develop -c cargo test -p gql-core
   - nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings
   - nix develop -c cargo fmt --check

OUT OF SCOPE (do not change in this task): The web-layer consumer at web/src/App.tsx:41 (`endColumn: diagnostic.col + Math.max(diagnostic.len, 1)`) is confirmed to consume this `len` as a same-line column delta. The core-side clamp above makes the value it receives always sane (0..=line length), which is sufficient for this task. Any App.tsx changes belong to a separate web-layer ticket.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the unsigned integer underflow in `extract_executable_diagnostics` (crates/gql-core/src/validate.rs) by replacing the raw `end.column - start.column` subtraction with a same-line-aware, underflow-safe computation: same-line spans use `saturating_sub`, multi-line spans clamp to 0, mirroring the pattern already used in `validate_subgraph`. A regression test `multiline_diagnostic_span_does_not_underflow` was added to the validate test suite, feeding a multi-line invalid operation and asserting that every diagnostic's `len` stays within the operation's string length. All 33 `cargo test -p gql-core` tests pass (including the new regression test), `cargo clippy -- -D warnings` is clean, `cargo fmt --check` passes, and the full web suite (48 tests, TypeScript typecheck, ESLint) passes. Production code contains no `panic!`, bare `.unwrap()`, or `.expect()` calls; all error cases return values through the JSON envelope boundary.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief — TASK-37: Fix validate_query diagnostic len underflows

## 1. Offending line confirmed (not yet fixed)

`crates/gql-core/src/validate.rs` line 87, inside `extract_executable_diagnostics`:

```rust
"len": (lc_range.end.column - lc_range.start.column),
```

This is the exact unguarded subtraction described in the task. It has **not** been fixed and does **not** use `saturating_sub`.

Contrast with `validate_subgraph` (line 43 of the same file), which already uses the safe form:

```rust
"len": lc_range.end.column.saturating_sub(lc_range.start.column),
```

The fix is missing only in `extract_executable_diagnostics`, not globally. The established safe pattern exists in the same file.

## 2. `LineColumn.column` is `usize` — underflow is real

From `apollo-compiler` 1.32.0 (the pinned version in `Cargo.lock`), at
`~/.cargo/registry/src/…/apollo-compiler-1.32.0/src/parser.rs:89`:

```rust
pub struct LineColumn {
    pub line: usize,
    pub column: usize,
}
```

`column` is `usize` (unsigned). In a debug build (the default for `cargo test`),
`end.column - start.column` will **panic** with a subtraction-overflow when
`end.column < start.column` (i.e. on any multi-line span). In a release/WASM
build it wraps silently to a near-`usize::MAX` value.

## 3. Existing tests — structure and SDL available

The `#[cfg(test)] mod tests` block (lines 136–552) contains:

- `_compose_test_supergraph()` — a private helper (line 235) that composes two
  in-memory subgraphs and returns the supergraph SDL as a `String`. The two
  subgraphs expose:
  - **products**: `Query.me: User`, `User @key(fields: "id") { id: ID! }`
  - **reviews**: `Query.mostRecentReview: Review`, `Review { id, body, product }`,
    `Product @key(fields: "id") { id, reviews }`, `extend type User { id @external, reviews }`

- `unknown_field_diagnostic_has_correct_position` (line 407) — uses the
  single-line operation `"{ nonexistentField }"`, which exercises the
  same-line path in `extract_executable_diagnostics`.

- `valid_query_with_field_returns_empty_diagnostics` (line 312) — uses
  `"{ me { id } }"`, confirming `User.id` is a valid, resolvable field.

## 4. Does `"{\n  me {\n    id {\n      x\n    }\n  }\n}"` produce a multi-line diagnostic span?

**Analysis of the schema:**

- `User.id` has type `ID!` (a scalar). Selecting a sub-field `{ x }` on a scalar
  is a GraphQL validation error: "Field 'id' must not have a selection since type
  'ID!' has no sub-fields".

**Analysis of the span:**

- In the multi-line operation, `id` begins at line 3, col 5, and the closing
  `}` of its selection set is on line 5, col 5. The diagnostic span for this
  error is therefore multi-line (`start.line=3`, `end.line=5`), meaning
  `end.column` (5) is less than or equal to `start.column` (5), making the
  subtraction either 0 or a wrapped near-MAX underflow.
- `apollo-compiler` 1.32.0 may place the span end at the closing brace or just
  after the invalid field name. Either way, a multi-line span means `end.line !=
  start.line`, so the task plan's guard (`if end.line == start.line`) correctly
  routes to the 0-clamp branch.

**Risk note (from task plan):** If the compiler happens to collapse the span to
a single line, the test still guards the invariant (`len <= operation.len()`) and
remains valuable. The same-line branch is already covered by
`unknown_field_diagnostic_has_correct_position`.

## 5. Web-layer bug confirmed

`web/src/App.tsx`, `diagnosticToMarker` function (lines 33–48):

```ts
function diagnosticToMarker(
  diagnostic: Diagnostic,
  monacoInstance: typeof _monaco,
): _monaco.editor.IMarkerData {
  return {
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.col,
    endLineNumber: diagnostic.line,                            // collapses to same line
    endColumn: diagnostic.col + Math.max(diagnostic.len, 1),  // line 41
    ...
  };
}
```

`endColumn` is `col + Math.max(len, 1)`. When `len` is a wrapped `usize::MAX`
value (≈ 4 294 967 295 on 32-bit WASM), `endColumn` becomes astronomically large,
producing a bogus marker that covers the entire remainder of the line in Monaco.
`Math.max(len, 1)` provides no protection against this because the wrapped value
is already much larger than 1.

The web-layer bug is real and directly downstream of the Rust underflow.

## Summary

| Verification item | Result |
|---|---|
| Offending line exists at validate.rs:87 | **Confirmed** — bare `-`, no `saturating_sub` |
| `LineColumn.column` is `usize` | **Confirmed** — unsigned, underflow is real |
| `_compose_test_supergraph()` exposes `User.id: ID!` via `me` | **Confirmed** |
| `"{ me { id { x } } }"` multi-line form produces a GraphQL error | **Confirmed** (scalar sub-field selection) |
| Whether that error span is multi-line in apollo-compiler 1.32.0 | Likely yes; test guards invariant either way |
| Web `endColumn = col + Math.max(len, 1)` causes bogus marker | **Confirmed** |
| `validate_subgraph` already uses `saturating_sub` | **Confirmed** — the fix pattern is established in the same file |

The implementation plan in the task is correct. The fix (`if end.line == start.line { end.column.saturating_sub(start.column) } else { 0 }`) is the right approach, consistent with the already-safe `validate_subgraph` path.

<!-- SECTION:NOTES:END -->
