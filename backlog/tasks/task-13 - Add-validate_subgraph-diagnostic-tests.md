---
id: TASK-13
title: Add validate_subgraph() diagnostic tests
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-09 19:11'
labels: []
milestone: m-1
dependencies:
  - TASK-28
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: low
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test that validation produces correct diagnostics with accurate 1-based positions, since the editor underlines depend on them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A valid schema yields an empty diagnostics list
- [x] #2 Each invalid-schema test asserts exact 1-based line, col, and len of the first diagnostic
- [x] #3 nix develop -c cargo test -p gql-core passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+Wasm core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

Context from research brief: validate_subgraph() uses Subgraph::parse() which returns Box<dyn Error> on failure -- no public location data. All error diagnostics currently fall back to line=1, col=1, len=0. The tests must assert these exact fallback values (they are deterministic and testable). See validate.rs comment lines 13-14.

1. Open crates/gql-core/src/validate.rs. The #[cfg(test)] module already exists with tests -- you will refine existing tests rather than add entirely new ones. Keep the inline module pattern (matches project convention).

2. Fix AC #2 assertions: In the two invalid-schema tests (invalid_sdl_returns_diagnostics_with_line_and_col and diagnostic_has_all_required_fields), replace the loop that asserts `line >= 1, col >= 1` with an exact assertion on the FIRST diagnostic:
   - Assert diagnostics.len() == 1 (Subgraph::parse returns exactly one error)
   - Assert first diagnostic has line == 1, col == 1, len == 0
   - Add a comment explaining this is the known fallback since SubgraphError has no public location fields.

3. Remove the duplicate test `invalid_sdl_syntax_error_returns_diagnostics_with_line_and_col` (lines ~82-96) -- it is identical in SDL input and assertions to `invalid_sdl_returns_diagnostics_with_line_and_col` (lines ~45-60). Keep only one.

4. Remove the stale placeholder comments on lines ~68-71 that reference AC #1 and AC #2 but do not correspond to any test below them.

5. Verify AC #1 is covered: The test `valid_sdl_returns_empty_diagnostics` already asserts a valid plain SDL yields zero diagnostics. The test `valid_federation_sdl_returns_empty_diagnostics` asserts a federation SDL (with @key, @link directives) also yields zero diagnostics. Both are present; no changes needed.

6. Verify AC #2 inputs: Ensure there are at least TWO distinct invalid-schema tests:
   - Test A: The broken schema with unterminated `broken(` -- syntax error, asserts exact (line=1, col=1, len=0) as explained in step 2.
   - Test B: The empty string test `empty_string_returns_diagnostics_without_panic` -- update it to assert the diagnostic has line==1, col==1, len==0 AND that diagnostics is non-empty. This covers the no-input edge case with verifiable position (1, 1).
   Add a comment in each showing the offending token and its expected fallback position.

7. Verify AC #3: Run `nix develop -c cargo test -p gql-core` and confirm ALL tests pass. The command works correctly as of TASK-28 (getrandom flag scoping fixed).

8. Verify the full toolchain is clean:
   - Run `nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings` to confirm no warnings.
   - Run `nix develop -c cargo fmt --check` to confirm formatting (pre-commit hook enforces this).
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added and refined validate_subgraph() diagnostic tests: two valid-schema tests (plain SDL and federation SDL) confirm empty diagnostics, two invalid-schema tests assert exact fallback positions (line=1, col=1, len=0) matching SubgraphError's lack of public location data, and an empty-string edge case verifies non-panic behavior. All 21 Rust tests pass, zero clippy warnings, formatting clean, and the full JS test suite (38 tests) passes as well.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: validate_subgraph() Diagnostic Position Tests

## Summary
The existing `validate_subgraph()` in `validate.rs` uses `apollo_federation::subgraph::typestate::Subgraph::parse()` which returns a `Result<Subgraph, SubgraphError>` — but `SubgraphError` has no public location fields (noted in the code comment). This means **all error diagnostics currently fall back to line 1, col 1**. The tests must assert against this known fallback behavior. For genuinely accurate positions, consider using `apollo-compiler::Parser::parse_document()` directly, which returns `DiagnosticList` with real `LineColumn` data (1-based).

## Findings

### 1. Current implementation always returns line=1, col=1 on errors
The code in `validate.rs` explicitly documents the limitation:

```rust
// SubgraphError has no public location data (pub(crate) fields).
// Fall back to a single diagnostic at line 1, col 1 with the
// formatted error message — still better than false positives.
```

`Subgraph::parse()` signature (from `apollo-federation` v2.15.0):
```rust
impl Subgraph<Initial> {
    pub fn parse(
        name: impl Into<String>,
        url: impl Into<String>,
        schema_definition: &str,
    ) -> Result<Subgraph<Initial>, Box<dyn std::error::Error>>;
}
```

The error type is `Box<dyn Error>` — it's a boxed trait object with no public fields for location extraction. The current code calls `.to_string()` on it and wraps it in a diagnostic at (1, 1).

**Implication for tests**: Any test that asserts specific line/col values must assert against the *fallback* values of `line: 1, col: 1, len: 0`. These are deterministic and testable. The developer should document this explicitly in each test comment.

### 2. Alternative: use apollo-compiler Parser directly for real positions
`apollo-compiler` v1.32.0 provides `Parser::parse_document()` which returns `Result<Document, DiagnosticList>`:

```rust
use apollo_compiler::parser::Parser;

let input = "type Query { hello: String broken(";
let result = Parser::new().parse_document(input, "<subgraph>");
match result {
    Ok(doc) => { /* valid schema */ }
    Err(diagnostics) => {
        // Each Diagnostic has source location data via line_column_range()
        for diag in diagnostics {
            let (start, end) = diag.line_column_range(&doc.sources).unwrap();
            // start.line and start.column are 1-based usize values
            println!("Error at line {} col {}", start.line, start.column);
        }
    }
}
```

Key types:
- **`Diagnostic<'s, T>`** — contains `sources: &'s SourceMap`, `error: &'s T`. Has `.line_column_range(&sources)` returning `Option<(LineColumn, LineColumn)>`.
- **`LineColumn`** — has `pub line: usize` and `pub column: usize`, both **1-based**. Column counts Unicode Scalar Values (like `str::chars`).
- **`DiagnosticList`** — implements `IntoIterator<Item = Diagnostic>`.

The `to_graphql_error()` method on `Diagnostic` produces a JSON-serializable shape compatible with the GraphQL spec error format.

**Tradeoff**: This approach bypasses `apollo-federation`'s subgraph validation (federation-specific rules like `@key`, `@shareable`, etc.). It only validates *GraphQL syntax*. For full federation validation, the current `Subgraph::parse()` path is needed. A hybrid approach could use `Parser::parse_document()` for syntax errors and fall back to `Subgraph::parse()` for federation-level checks.

### 3. Test placement and pattern
Existing tests in this crate follow two patterns:
- **Inline unit tests** (`#[cfg(test)]` module inside the source file) — used in `validate.rs` and `lib.rs`. These are simple, fast, and co-located with the code they test.
- **Integration tests** (`tests/*.rs`) — used in `tests/compose.rs` for snapshot testing with `insta`.

For this task, an inline `#[cfg(test)]` module inside `validate.rs` is the simplest approach (matches the existing pattern). If the developer wants snapshot-based diagnostics comparison later, a separate `tests/validate.rs` would be appropriate.

### 4. Choosing test inputs with verifiable positions
Since current behavior always returns `(1, 1, 0)`, pick inputs where:
- The error is *clearly* at position (1, 1) or easily traceable
- Add a comment showing the offending token and its expected position

**Recommended invalid inputs:**

| # | Input SDL | Offending token | Expected (line, col, len) | Rationale |
|---|-----------|-----------------|--------------------------|-----------|
| A | `""` (empty string) | — | (1, 1, 0) | Trivially at position 1,1; tests the "no input" case |
| B | `"type Query { broken("` | `(` on line 1 | (1, 1, 0) fallback | Syntax error — unterminated field def |
| C | `"broken_type"` | `broken_type` at start of file | (1, 1, 0) fallback | Bare identifier at position 1 |

If the developer switches to `Parser::parse_document()`, these same inputs would yield **real** positions:

| # | Input SDL | Offending token | Real (line, col, len) via Parser |
|---|-----------|-----------------|----------------------------------|
| B | `"type Query { broken("` | `(` at end of line 1 | line=1, col=20 (approx), len depends on span |
| C | `"broken_type"` | `b` at start | line=1, col=1, len=13 (length of identifier) |

### 5. Dependencies and version constraints
- **Do NOT change pinned dependency versions** — the Cargo.toml explicitly pins `apollo-compiler = "=1.32.0"` and `apollo-federation = "=2.15.0"`. The comment says: "apollo-federation has NO semver guarantees (Apollo treats it as Router-internal), so any version may break the API."
- **`insta`** is already a dev-dependency with the `json` feature enabled, available for snapshot testing if desired.

### 6. Gotchas
1. **Column numbering**: `LineColumn.column` counts Unicode Scalar Values (chars), not bytes. This matches how editors count columns in most cases but differs from byte-offset-based tools.
2. **Empty string edge case**: `Parser::parse_document("", ...)` returns a diagnostic with location (line=1, col=1) but the source is empty — the span may have zero length. The existing test already covers this (`empty_string_returns_diagnostics_without_panic`).
3. **`apollo-compiler` vs `apollo-federation` scope**: Using `Parser::parse_document()` alone won't catch federation-specific errors (e.g., missing `@key`, invalid directive usage). If the goal is to test *federation* validation positions, the current `Subgraph::parse()` path is required — but its position data is limited.
4. **WASM target**: The crate compiles to both native (`rlib`) and WASM (`cdylib`). Tests run natively via `cargo test`, so no WASM-specific concerns here.

### 7. Recommended approach for the developer
**Option A (minimal change, matches current behavior):**
Write tests against the current `validate_subgraph()` implementation. Assert that diagnostics are returned with `line: 1, col: 1, len: 0` for invalid schemas. Document this fallback behavior explicitly in test comments. This satisfies AC #1 and AC #2 as written.

**Option B (improved positions, requires code change):**
Replace the error path in `validate_subgraph()` to use `apollo-compiler::Parser::parse_document()` for syntax-level diagnostics with real positions, while keeping `Subgraph::parse()` for federation-level validation. This requires understanding which errors come from which parser and merging diagnostics appropriately.

**Recommendation**: Start with Option A to satisfy the acceptance criteria. If the developer wants genuinely accurate positions (as the task description implies), Option B is the path forward — but it's a code change, not just tests.

## Sources
- **Kept**: [apollo-compiler Diagnostic docs](https://docs.rs/apollo-compiler/latest/apollo_compiler/diagnostic/struct.Diagnostic.html) — explains `line_column_range()`, `to_graphql_error()` JSON serialization | Key for real position data |
- **Kept**: [apollo-compiler LineColumn docs](https://docs.rs/apollo-compiler/latest/apollo_compiler/parser/struct.LineColumn.html) — confirms 1-based line/column, char-counting columns | Key for position semantics |
- **Kept**: [apollo-federation Subgraph typestate docs](https://docs.rs/apollo-federation/2.15.0/apollo_federation/subgraph/typestate/struct.Subgraph.html) — shows `Subgraph::parse()` signature and state machine | Explains error type limitation |
- **Kept**: [apollo-compiler Parser docs](https://docs.rs/apollo-compiler/latest/apollo_compiler/parser/struct.Parser.html) — `parse_document()` returns `Result<Document, DiagnosticList>` | Key for Option B |
- **Kept**: [Existing tests/compose.rs](file:///home/jeffutter/src/graphql-playground/crates/gql-core/tests/compose.rs) — pattern reference for integration tests with insta snapshots | Shows project testing conventions |
- **Dropped**: apollo-rs GitHub issue #959 (empty string parsing edge case) — interesting but not actionable for this task |
- **Dropped**: Router PR #8030 (adding location info to SubgraphError) — future improvement, not available in pinned v2.15.0 |

## Gaps
1. **Exact `Subgraph::parse()` error type**: The docs show `Box<dyn Error>` but the actual return type may be a named struct (`SubgraphError`). If it's a named struct with hidden fields, there might be a way to access location data via a method not documented on docs.rs. The developer should inspect `apollo-federation` source directly.
2. **Merging diagnostics from two parsers**: If Option B is chosen, the developer needs to know how to combine syntax-level diagnostics (from `Parser`) with federation-level diagnostics (from `Subgraph::parse()`). No clear API for this exists in the public docs — would require reading `apollo-federation` source.
3. **`len` field semantics**: The current code sets `len: 0`. If switching to `Parser`, the `len` should be computed from the diagnostic span (end.col - start.col or similar). The exact computation needs verification against `apollo-compiler` source.

<!-- SECTION:NOTES:END -->
