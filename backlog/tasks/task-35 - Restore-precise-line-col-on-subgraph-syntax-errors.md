---
id: TASK-35
title: Restore precise line/col on subgraph syntax errors
status: Done
assignee:
  - developer
created_date: '2026-06-09 19:07'
updated_date: '2026-06-11 00:42'
labels:
  - bug
  - rust
  - validation
  - editor
milestone: m-1
dependencies:
  - TASK-31
priority: medium
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After the TASK-31 fix, all syntax errors in the subgraph editor show a squiggle at line 1, col 1 (a single character wide) regardless of where the actual error is. This is because `SubgraphError`'s location fields are `pub(crate)`, so `validate_subgraph` can't read them and falls back to `(1, 1, len=0)`.

## Root Cause

`crates/gql-core/src/validate.rs` calls `Subgraph::parse(...)` from `apollo_federation`. When that returns `Err(SubgraphError)`, the struct fields `SubgraphError.errors: Vec<SingleSubgraphError>` and `SingleSubgraphError.locations: Vec<Range<LineColumn>>` are both `pub(crate)` (in `apollo-federation-2.15.0/src/subgraph/mod.rs:335-348`), so our crate cannot read them.

## Fix: Two-phase parse

Replace the single `Subgraph::parse` call with a two-phase approach:

**Phase 1 — Syntax check via `apollo_compiler`:**
Parse the SDL with `apollo_compiler` using a builder that does NOT reject unknown directives (so federation directives don't re-introduce the original false-positive). The `apollo_compiler` `Diagnostic` type exposes public location data. If there are syntax errors, emit them with real line/col and return early.

**Phase 2 — Federation semantic check via `Subgraph::parse`:**
If Phase 1 is clean, run `Subgraph::parse` for federation-aware validation. Errors here still fall back to `(1, 1)` because of the `pub(crate)` issue, but federation errors are much rarer and usually semantic (not syntax), so the fallback is acceptable.

**Key reference files:**
- `crates/gql-core/src/validate.rs` — the only file that needs changing
- `apollo-federation-2.15.0/src/subgraph/mod.rs:400-415` — shows how `from_diagnostic_list` extracts locations from `DiagnosticList`, confirming `apollo_compiler` diagnostics do carry public location data
- The original TASK-27 implementation used `Schema::parse_and_validate` which had locations — study what it extracted before TASK-31 replaced it

**Note on `apollo_compiler` builder:** Use `Schema::builder().parse(...).build()` rather than `Schema::parse_and_validate(...)`. The `build()` step may return a result or accumulate diagnostics without rejecting unknown directives. Verify against the `apollo_compiler` API; `adopt_orphan_extensions()` is used in `apollo_federation`'s own `parse_and_expand` for this purpose.

## Acceptance Criteria
<!-- AC:BEGIN -->
- Syntax errors (unclosed brace, bad token, unterminated argument list) show squiggles at the correct line and column, not at (1, 1)
- Valid plain SDL returns zero diagnostics
- Valid federation SDL with `@link`, `@key`, etc. returns zero diagnostics (TASK-31 regression guard)
- `cargo test -p gql-core` passes with no regressions
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan: Two-Phase Parse for Precise Subgraph Syntax Errors

### Scope
Exactly one source file changes: `crates/gql-core/src/validate.rs`. No new crate
dependencies, no new `use` lines — `Schema`, `LineColumn`, and `WithErrors` are
already imported. Three existing tests in that same file are updated.

### Approach: Two-Phase Parse
Replace the single `Subgraph::parse(...)` call in `validate_subgraph` with two
phases:

- **Phase 1 (syntax/structure):** Parse SDL through `apollo_compiler` with the
  same builder config `Subgraph::parse` uses internally. `apollo_compiler`
  diagnostics carry PUBLIC location data, so we recover real line/col. If Phase 1
  produces any diagnostics, emit them with real positions and return early.
- **Phase 2 (federation semantics):** Only if Phase 1 is clean, run
  `Subgraph::parse(...)` for federation-aware validation. These errors still fall
  back to `(1, 1, 0)` because `SubgraphError` location fields are `pub(crate)` —
  acceptable, since federation errors are rare and semantic, not syntactic.

### Files to Modify
- `crates/gql-core/src/validate.rs` — rewrite the body of `validate_subgraph`;
  update 3 tests.

### TDD Order (write/adjust tests first, then implement)
The behaviour-defining tests already exist; this is a behaviour-change task, so
update the failing-position assertions first, confirm they fail against current
code, then implement Phase 1 to make them pass.

1. **First — update `invalid_sdl_returns_diagnostics_with_line_and_col`**
   (~line 114). The test SDL is `type Query { hello: String  broken(`. Change the
   exact `(line=1, col=1, len=0)` assertion to assert a REAL position. Prefer the
   robust form `assert!(line > 1 || col > 1, "should report real position, not (1,1)")`.
   This is the primary AC#1 guard. Run once to observe the actual compiler-reported
   line/col; if stable, optionally tighten to the exact value.
2. **Second — update `diagnostic_has_all_required_fields`** (~line 141). Keep the
   field-presence assertions (severity, message, line, col, len all present and
   correctly typed). Remove/relax any exact-position assertion so it no longer
   pins `(1,1,0)`.
3. **Third — update `empty_string_returns_diagnostics_without_panic`** (~line 174).
   Keep the count assertion (`>= 1`) and the no-panic guarantee. The compiler may
   still report `(1,1)` for empty input — verify by running; do NOT assert a
   position that contradicts the compiler.
4. **Regression guard — do NOT touch** `valid_federation_sdl_returns_empty_diagnostics`
   (~line 409) or the valid-plain-SDL test. They must keep passing unchanged
   (AC#2, AC#3). `adopt_orphan_extensions()` is the flag that keeps federation SDL
   (`@link`, `@key`, `@shareable`, `extend schema @link(...)`) from producing
   false positives in Phase 1.
5. **Implement Phase 1 + Phase 2** in `validate_subgraph` until all tests pass.

### Exact Library API Calls (copy from research brief)

Phase 1 — build with the SAME config `Subgraph::parse` uses internally:
```rust
let build_result = Schema::builder()
    .adopt_orphan_extensions()        // accept `extend schema @link(...)` w/o base def
    .ignore_builtin_redefinitions()   // accept redefined built-in scalars
    .parse(sdl, "<subgraph>")
    .build();                          // -> Result<Schema, WithErrors<Schema>>
```

Extract diagnostics from `WithErrors` (mirrors existing `extract_executable_diagnostics`):
```rust
if let Err(with_errors) = build_result {
    let diagnostics: Vec<Value> = with_errors.errors.iter().map(|diag| {
        let lc_range = diag
            .line_column_range()  // Option<Range<LineColumn>>
            .unwrap_or(LineColumn { line: 1, column: 1 }
                ..LineColumn { line: 1, column: 1 });
        json!({
            "severity": "error",
            "message": diag.to_string(),                                   // Display, no colors
            "line": lc_range.start.line,                                   // 1-based usize
            "col": lc_range.start.column,                                  // 1-based usize
            "len": lc_range.end.column.saturating_sub(lc_range.start.column),
        })
    }).collect();
    return json!({ "diagnostics": diagnostics });
}
```

Phase 2 — federation semantic check (only reached when Phase 1 is clean):
```rust
match Subgraph::parse("<subgraph>", "", sdl) {
    Ok(_) => json!({ "diagnostics": [] }),
    Err(err) => json!({ "diagnostics": [json!({
        "severity": "error",
        "message": err.to_string().trim().to_string(),
        "line": 1, "col": 1, "len": 0,   // accepted fallback; fields are pub(crate)
    })] }),
}
```

Key API facts:
- `build()` -> `Result<Schema, WithErrors<Schema>>`; `e.errors` is a `DiagnosticList`.
- `DiagnosticList::iter()` -> `Diagnostic<'_, DiagnosticData>` (each carries its own
  `sources`, so `.line_column_range()` resolves without touching the `pub(crate)`
  `DiagnosticList.sources`).
- `diag.line_column_range()` -> `Option<Range<LineColumn>>`; `.line`/`.column` are
  1-based `usize`. Same method already used in `extract_executable_diagnostics`.
- `len` uses `saturating_sub` (NOT plain subtraction) to avoid underflow on
  zero-width spans; cross-line spans collapse to 0, acceptable for the squiggle UI.

### How Each Acceptance Criterion Is Met
- **AC#1 (real line/col, not hardcoded (1,1)):** Phase 1's `apollo_compiler`
  diagnostics expose public location via `.line_column_range()`. Syntax errors
  (unclosed brace, bad token, unterminated argument list) now report true
  positions and return early before Phase 2's lossy fallback.
- **AC#2 (valid plain SDL -> zero diagnostics):** Phase 1 `build()` succeeds and
  Phase 2 `Subgraph::parse` returns `Ok` -> `{ "diagnostics": [] }`.
- **AC#3 (valid federation SDL -> zero diagnostics, TASK-31 regression guard):**
  `adopt_orphan_extensions()` + `ignore_builtin_redefinitions()` exactly mirror
  `Subgraph::parse`'s internal builder, so `@link`/`@key`/`@shareable` and
  `extend schema @link(...)` do not re-introduce false positives. Existing
  `valid_federation_sdl_returns_empty_diagnostics` stays green.
- **AC#4 (`cargo test -p gql-core` passes):** Run `nix develop -c cargo test -p gql-core`
  after updating the 3 tests and implementing both phases.
- **AC#5 (`pnpm tsc --noEmit` and `pnpm lint` pass):** No TS surface changes, but
  run both to confirm no incidental breakage.

### Verification Commands
- `nix develop -c cargo test -p gql-core` (AC#1–#4)
- `nix develop -c cargo clippy -p gql-core` (lint hygiene on the changed Rust)
- `pnpm tsc --noEmit` and `pnpm lint` (AC#5)

### Risks / Prerequisites
- **Exact-position drift:** The compiler-reported line/col for the EOF-style test
  SDL may differ from intuition (likely around the unterminated `broken(`). Run
  the test once to capture the real value; prefer the `line > 1 || col > 1`
  assertion over a brittle exact pin unless the value is verified stable.
- **`len` underflow:** Must use `saturating_sub`, not `-`. The existing helper uses
  plain subtraction; do NOT copy that part verbatim into Phase 1.
- **Phase 2 still lossy:** Federation semantic errors keep `(1,1,0)`. This is the
  accepted scope of the task — do not attempt to read `SubgraphError`'s
  `pub(crate)` fields.
- **Empty-input position:** `empty_string_returns_diagnostics_without_panic` may
  legitimately still see `(1,1)` from the compiler; rely on the `>= 1` count and
  no-panic guarantees, not on a position assertion.
- **Prerequisite:** TASK-31 (dependency) already merged — its regression test is
  the AC#3 guard and must remain untouched.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 implemented and verified: syntax errors (unclosed brace, bad token, unterminated argument) now show squiggles at the correct line and column via two-phase parse. Phase 1 uses apollo_compiler Schema::builder().adopt_orphan_extensions().ignore_builtin_redefinitions().parse(sdl).build() which exposes public location data. All 29 gql-core tests pass, cargo fmt --check clean, cargo clippy -D warnings clean.

AC#4 verified: nix develop -c cargo test -p gql-core passes - 29 unit tests + 2 config audit + 7 integration = 38 total, 0 failures. AC#5 verified: pnpm tsc --noEmit and pnpm lint both pass cleanly (no TypeScript errors, no ESLint errors).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented two-phase subgraph validation in `crates/gql-core/src/validate.rs` to restore precise line/col on syntax errors. Phase 1 uses `Schema::builder().adopt_orphan_extensions().ignore_builtin_redefinitions().parse().build()` — the same builder config as `Subgraph::parse` internally — so `apollo_compiler` diagnostics with public location data are emitted for syntax errors before falling through to Phase 2. Phase 2 runs `Subgraph::parse` for federation semantic validation, retaining the accepted `(1,1,0)` fallback for the rare cases where `SubgraphError`'s `pub(crate)` location fields cannot be read. `len` computation uses `saturating_sub` to avoid underflow on cross-line spans. All 38 `cargo test -p gql-core` tests pass, `cargo fmt` and `cargo clippy -D warnings` are clean, all 48 web vitest tests pass, and `pnpm tsc --noEmit` and `pnpm lint` are clean. The TASK-31 regression guard (`valid_federation_sdl_returns_empty_diagnostics`) remains green. No Apollo internal types are exposed across the WASM boundary.
<!-- SECTION:FINAL_SUMMARY:END -->

- [ ] #1 Syntax errors (unclosed brace, bad token, unterminated argument list) show squiggles at the correct line and column, not at (1, 1)
- [ ] #2 Valid plain SDL returns zero diagnostics
- [ ] #3 Valid federation SDL with @link, @key, etc. returns zero diagnostics (TASK-31 regression guard)
- [ ] #4 `cargo test -p gql-core` passes with no regressions
<!-- AC:END -->

- [x] #1 Syntax errors (unclosed brace, bad token, unterminated argument) show squiggles at the correct line and column, not hardcoded (1,1)
- [x] #2 Valid plain SDL returns zero diagnostics
- [x] #3 Valid federation SDL with @link, @key, @shareable etc. returns zero diagnostics (TASK-31 regression guard)
- [x] #4 nix develop -c cargo test -p gql-core passes with no regressions
- [x] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: Two-Phase Parse for Precise Subgraph Syntax Errors

## 1. Current State of `validate_subgraph`

**File:** `crates/gql-core/src/validate.rs`

`validate_subgraph` calls `Subgraph::parse("<subgraph>", "", sdl)` from
`apollo_federation::subgraph::typestate`. On error it returns a single
diagnostic at `line=1, col=1, len=0` because `SubgraphError.errors` and
`SingleSubgraphError.locations` are both `pub(crate)` and unreadable from
outside the crate.

The existing `extract_executable_diagnostics` helper (lines 32–47 of
`validate.rs`) already demonstrates the exact pattern to copy: it iterates
`with_errors.errors`, calls `.line_column_range()` on each, and unpacks into
`start.line / start.column / (end.column - start.column)`. Phase 1 must
replicate this pattern.

---

## 2. `apollo_compiler::Schema::builder()` API (version 1.32.0)

**File:** `~/.cargo/registry/src/…/apollo-compiler-1.32.0/src/schema/from_ast.rs`

`SchemaBuilder` is a public type re-exported from `apollo_compiler::schema`.

Key builder methods (all return `Self` for chaining):

```rust
Schema::builder()                     // SchemaBuilder::new()
    .adopt_orphan_extensions()        // accept extensions without a base def
    .ignore_builtin_redefinitions()   // accept duplicate built-in type defs
    .parse(source_text, path)         // returns Self; delegates to Parser::new()
```

`SchemaBuilder::build()` signature:

```rust
pub fn build(self) -> Result<Schema, WithErrors<Schema>>
```

When `build()` returns `Err(WithErrors<Schema>)`, `e.errors` is a
`DiagnosticList` whose `.iter()` yields `Diagnostic<'_, DiagnosticData>`.

---

## 3. How `apollo_federation::Subgraph::parse` Uses the Builder

**File:** `~/.cargo/registry/src/…/apollo-federation-2.15.0/src/subgraph/typestate.rs` lines 214–238

```rust
pub fn parse(name: &str, url: &str, schema_str: &str)
    -> Result<Subgraph<Initial>, SubgraphError>
{
    let schema_builder = Schema::builder()
        .adopt_orphan_extensions()
        .ignore_builtin_redefinitions()
        .parse(schema_str, name);
    // …
    let mut schema = schema_builder
        .build()
        .map_err(|e| SubgraphError::from_diagnostic_list(name, e.errors))?;
    // …
}
```

Phase 1 should use **exactly this configuration** — it passes pure SDL including
`extend schema @link(…)` without false positives for federation directives.

---

## 4. `adopt_orphan_extensions()` Purpose

**File:** `from_ast.rs` line 76–79 doc comment + `build_inner` lines 294–308.

`adopt_orphan_extensions()` makes `build()` accept `extend type Foo` or
`extend schema …` even when no base definition of `Foo` / `schema` was
previously seen — they are treated as the implicit base. This is required for
federation SDL which uses `extend schema @link(…) { query: Query }` at the top.
Without this flag, `build()` emits `OrphanTypeExtension` / `OrphanSchemaExtension`
errors immediately.

`ignore_builtin_redefinitions()` suppresses errors when SDL re-defines built-in
scalars (common in older SDL dumps). Together these two flags mirror exactly what
`Subgraph::parse` itself uses internally.

---

## 5. `Diagnostic<'_, DiagnosticData>` Location API

**File:** `diagnostic.rs` lines 328–332

```rust
impl<T: ToCliReport> Diagnostic<'_, T> {
    pub fn line_column_range(&self) -> Option<Range<LineColumn>> {
        self.error.location()?.line_column_range(self.sources)
    }
}
```

`DiagnosticList::iter()` (**validation/mod.rs** lines 1034–1040) returns
`impl DoubleEndedIterator<Item = Diagnostic<'_, DiagnosticData>>`.

`SourceSpan::line_column_range(&self, sources: &SourceMap) -> Option<Range<LineColumn>>`
(**parser.rs** lines 630–633) looks up the source file by `file_id` and calls
`source.get_line_column_range(byte_start..byte_end)`.

`LineColumn` fields (**parser.rs** lines 82–90):

```rust
pub struct LineColumn {
    pub line: usize,   // 1-based
    pub column: usize, // 1-based, counts Unicode Scalar Values
}
```

When `line_column_range()` returns `None` (no source span), fall back to
`(1, 1, 0)` exactly as the existing fallback does.

---

## 6. `DiagnosticData` Details Enum — Which Variants Are Syntax Errors?

**File:** `validation/mod.rs` lines 249–264

```rust
pub(crate) enum Details {
    ParserLimit { message: String },
    SyntaxError { message: String },   // ← the syntax-error variant
    SchemaBuildError(SchemaBuildError),
    ExecutableBuildError(ExecutableBuildError),
    CompilerDiagnostic(diagnostics::DiagnosticData),
    RecursionLimitError,
}
```

Phase 1 should emit diagnostics for **any** diagnostic in the `DiagnosticList`
returned by `build()`. With `adopt_orphan_extensions` and
`ignore_builtin_redefinitions` enabled, `OrphanTypeExtension` and built-in
redefinition errors will not appear, so all remaining errors are genuine syntax /
structural problems.

---

## 7. `Diagnostic` Display / `to_string()`

`Diagnostic<'_, DiagnosticData>` implements `Display` (no colors) and `Debug`
(with colors). To get a plain string message for the JSON output, call
`.to_string()` — this is what the existing code already does for
`ExecutableDocument` errors. The same works for schema `DiagnosticData`.

---

## 8. `DiagnosticList.sources` Visibility

`DiagnosticList.sources` is `pub(crate)` — cannot be accessed from `gql-core`.
However, the `Diagnostic<'_, DiagnosticData>` obtained via `.iter()` carries its
own `sources` reference (`pub sources: &'s SourceMap`), so `.line_column_range()`
resolves correctly without needing to touch the list directly.

---

## 9. Exact Code Pattern for Phase 1

```rust
use apollo_compiler::Schema;
// LineColumn and WithErrors already imported

pub fn validate_subgraph(sdl: &str) -> Value {
    // Phase 1: syntax + structure check via apollo_compiler
    let build_result = Schema::builder()
        .adopt_orphan_extensions()
        .ignore_builtin_redefinitions()
        .parse(sdl, "<subgraph>")
        .build();

    if let Err(with_errors) = build_result {
        let diagnostics: Vec<Value> = with_errors.errors.iter().map(|diag| {
            let lc_range = diag
                .line_column_range()
                .unwrap_or(LineColumn { line: 1, column: 1 }
                    ..LineColumn { line: 1, column: 1 });
            json!({
                "severity": "error",
                "message": diag.to_string(),
                "line": lc_range.start.line,
                "col": lc_range.start.column,
                "len": lc_range.end.column.saturating_sub(lc_range.start.column),
            })
        }).collect();
        return json!({ "diagnostics": diagnostics });
    }

    // Phase 2: federation semantic check
    match Subgraph::parse("<subgraph>", "", sdl) {
        Ok(_) => json!({ "diagnostics": [] }),
        Err(err) => {
            let diagnostics = vec![json!({
                "severity": "error",
                "message": err.to_string().trim().to_string(),
                "line": 1,
                "col": 1,
                "len": 0,
            })];
            json!({ "diagnostics": diagnostics })
        }
    }
}
```

**Note on `len` computation:** The existing `extract_executable_diagnostics`
computes `end.column - start.column` with a plain subtraction. Use
`saturating_sub` in Phase 1 to avoid an underflow panic if both columns are equal
(zero-width span). Cross-line spans produce 0 rather than a garbage value, which
is acceptable for the squiggle UI.

---

## 10. Test Updates Required

The existing tests in `validate.rs` (lines 113–192) assert exact fallback
positions `(line=1, col=1, len=0)`. After the fix, for the test SDL
(`type Query { hello: String  broken(`) the Phase 1 compiler will emit the real
location (EOF around line 5). Three tests must be updated:

- **`invalid_sdl_returns_diagnostics_with_line_and_col`** (line 114): change
  assertions to `assert!(line > 1 || col > 1, "should have real position")` or
  assert the exact compiler-reported line/col (verify by running the test once).
- **`diagnostic_has_all_required_fields`** (line 141): keep field-presence
  assertions; remove or relax exact-position assertions.
- **`empty_string_returns_diagnostics_without_panic`** (line 174): position
  for empty SDL may still be `(1,1)` from the compiler — verify; the count
  assertion `>= 1` is fine either way.

The federation regression test **`valid_federation_sdl_returns_empty_diagnostics`**
(line 409) must continue to pass unchanged.

---

## 11. Imports Needed in `validate.rs`

No new crate dependencies needed — `apollo_compiler` is already a direct
dependency. Existing imports already cover the new code:

```rust
use apollo_compiler::parser::LineColumn;  // already present (line 5)
use apollo_compiler::Schema;              // already present (line 7)
use apollo_compiler::validation::WithErrors;  // already present (line 6)
```

No new `use` lines are required.

---

## Summary Table

| Question | Answer |
|---|---|
| Builder API | `Schema::builder().adopt_orphan_extensions().ignore_builtin_redefinitions().parse(sdl, name).build()` |
| `build()` return type | `Result<Schema, WithErrors<Schema>>`; errors in `e.errors: DiagnosticList` |
| Iterating diagnostics | `e.errors.iter()` → `Diagnostic<'_, DiagnosticData>` |
| Getting location | `.line_column_range()` → `Option<Range<LineColumn>>`; `start.line` / `start.column` are 1-based `usize` |
| `adopt_orphan_extensions` purpose | Suppresses `extend schema`/`extend type` errors when no base def exists — required for federation SDL |
| `ignore_builtin_redefinitions` | Suppresses errors for redefined built-in scalars — used by `Subgraph::parse` |
| Message string | `.to_string()` on `Diagnostic` (Display impl, no colors) |
| `len` field | `end.column.saturating_sub(start.column)`; cross-line errors → 0 |
| New imports needed | None — `Schema`, `LineColumn`, `WithErrors` already imported |
| Tests to update | 3 tests assert exact fallback `(1,1,0)`; update to assert real positions or relax assertions |

<!-- SECTION:NOTES:END -->
