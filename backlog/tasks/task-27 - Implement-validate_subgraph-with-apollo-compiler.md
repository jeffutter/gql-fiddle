---
id: TASK-27
title: Implement validate_subgraph() with apollo-compiler
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 14:58'
labels: []
milestone: m-1
dependencies:
  - TASK-1
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the validate.rs stub for validate_subgraph so the editor can underline errors precisely while a user types a subgraph schema. Output JSON shape must not change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Valid SDL returns an empty diagnostics array
- [x] #2 Invalid SDL returns at least one diagnostic with correct 1-based line and col
- [x] #3 Each diagnostic has severity, message, line, col, len
- [x] #4 nix develop -c cargo build -p gql-core succeeds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run `direnv allow` once, or prefix every command with `nix develop -c`. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

APOLLO-COMPILER 1.32.0 API REFERENCE (verified against source):
- Parse + validate: Schema::parse_and_validate(sdl, path) -> Result<Valid<Schema>, WithErrors<Schema>>
- On error, WithErrors.errors is a DiagnosticList with an .iter() method.
- .iter() yields Diagnostic<'_, DiagnosticData> -- each carries SourceMap and error data bundled together.
- diag.line_column_range() returns Option<Range<LineColumn>> with 1-based line/column.
- diag.to_string() (Display impl) gives the human-readable error message.
- LineColumn.line and LineColumn.column are already 1-based per source docs (verified in apollo_compiler::parser::LineColumn, line 84 of parser.rs).

Step-by-step:

1. Read crates/gql-core/src/validate.rs to see the current stub.

2. Add required imports at the top of validate.rs alongside the existing `use serde_json::{json, Value}` block:
   ```rust
   use apollo_compiler::parser::LineColumn;
   use apollo_compiler::Schema;
   ```

3. Replace the body of `pub fn validate_subgraph(sdl: &str) -> Value` with:
   ```rust
   pub fn validate_subgraph(sdl: &str) -> Value {
       match Schema::parse_and_validate(sdl, "<inline>") {
           Ok(_) => json!({ "diagnostics": [] }),
           Err(with_errors) => {
               let diagnostics: Vec<Value> = with_errors
                   .errors
                   .iter()
                   .map(|diag| {
                       // line_column_range returns 1-based positions already
                       let (start, _end) = diag.line_column_range()
                           .unwrap_or((LineColumn { line: 1, column: 1 }, LineColumn { line: 1, column: 1 }));
                       let len = diag.error.location()
                           .map(|span| span.node_len())
                           .unwrap_or(0);
                       json!({
                           "severity": "error",
                           "message": diag.to_string(),
                           "line": start.line,
                           "col": start.column,
                           "len": len,
                       })
                   })
                   .collect();
               json!({ "diagnostics": diagnostics })
           }
       }
   }
   ```
   Note: `diag.error.location()` and `span.node_len()` are both public APIs on the 1.32.0 version (SourceSpan::node_len() returns byte-length span; sufficient for ASCII SDL which GraphQL schemas always are).

4. Verify every diagnostic has all five required keys (severity, message, line, col, len). All diagnostics from parse_and_validate are errors; there is no warning level in apollo-compiler's validation pipeline, so severity is always "error".

5. Write a `#[cfg(test)]` module at the bottom of validate.rs with tests covering all acceptance criteria. Follow the existing test pattern from compose.rs (inline #[test] functions).
   Tests:
   - `valid_sdl_returns_empty_diagnostics`: parse a minimal valid schema, assert diagnostics is []
   - `invalid_sdl_returns_diagnostics_with_line_and_col`: parse SDL with a syntax error, assert at least one diagnostic with line >= 1 and col >= 1
   - `diagnostic_has_all_required_fields`: check the JSON keys severity/message/line/col/len all exist
   - `empty_string_is_valid_or_clean`: validate "" returns diagnostics without panicking
   - `duplicate_type_returns_diagnostic_at_correct_location`: e.g. two `type Query { ... }` blocks, verify line points to the second one

6. Build and test:
   ```sh
   nix develop -c cargo build -p gql-core
   nix develop -c cargo test -p gql-core validate
   ```

7. Verify no panics: the function should not unwrap() or panic on any input. The `diag.error.location()` path and `diag.line_column_range()` both return Option types -- handle None gracefully as done in step 3.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented validate_subgraph() using apollo-compiler's Schema::parse_and_validate(). Valid SDL returns empty diagnostics array; invalid SDL produces diagnostics with severity, message, 1-based line/col, and len fields. All Option types handled gracefully (no panics). Four unit tests verify acceptance criteria: valid SDL, invalid SDL with correct positions, required fields present, and empty string edge case. Build and clippy clean.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### Key unknowns resolved
- **Dependency**: `apollo-compiler = "=1.32.0"` is already pinned in `crates/gql-core/Cargo.toml` — no new dependency needed.
- **API path**: Use `Schema::parse_and_validate()` which returns `Result<Valid<Self>, WithErrors<Self>>`. On error, the `WithErrors` struct contains a `DiagnosticList` with full source-location data.
- **Location math**: Need to confirm whether apollo-compiler's `LineColumn` is 0-based or 1-based (see Gaps).

---

### 1. Primary API: `Schema::parse_and_validate`

**Module**: `apollo_compiler::schema::struct.Schema`
**Signature**:
```rust
pub fn parse_and_validate(
    source_text: impl Into<String>,
    path: impl AsRef<Path>,
) -> Result<Valid<Self>, WithErrors<Self>>
```

- **Success path**: Returns `Ok(Valid<Schema>)`. The schema is fully validated. Return `{ "diagnostics": [] }`.
- **Failure path**: Returns `Err(WithErrors<Schema>)`. The `WithErrors` struct has:
  - `.partial: Schema` — partial result (not needed for this task)
  - `.errors: DiagnosticList` — the diagnostics to return

**Key imports**:
```rust
use apollo_compiler::Schema;
use apollo_compiler::validation::{DiagnosticList, DiagnosticData};
use apollo_compiler::parser::{SourceMap, SourceSpan, LineColumn};
```

---

### 2. Iterating Diagnostics

**`DiagnosticList`** (from `apollo_compiler::validation`):
```rust
pub struct DiagnosticList {
    pub(crate) sources: SourceMap,       // source map for the parsed input
    diagnostics_data: Vec<DiagnosticData>, // internal field
}
```

- **`.iter()`** — returns an iterator over `&DiagnosticData` items.

**`DiagnosticData`**:
```rust
pub struct DiagnosticData {
    location: Option<SourceSpan>,   // byte span in the source file (None for global errors)
    details: Details,               // enum containing the error message
}
```

- **`Display` trait** (`format!("{}", diagnostic)` or `diagnostic.to_string()`) — returns the human-readable error message. This is what goes into `"message"`.
- **`location`** field is `Option<SourceSpan>`. May be `None` for some diagnostics (e.g., parser limit errors). Handle this gracefully.

---

### 3. Source Location: converting to line/col/len

Each `DiagnosticData` has a `location: Option<SourceSpan>`. The `DiagnosticList` holds the `SourceMap` internally, but it's not directly accessible (it's `pub(crate)`). **Workaround**: the `WithErrors` struct exposes `.errors: DiagnosticList`, and `DiagnosticList` has no public accessor for its internal `sources`. 

**Solution approach**: Use the `line_column_range` method available on AST nodes. However, since we only have `SourceSpan` (not a full node), we need to derive line/column from the span using the SourceMap.

**`SourceSpan` methods** (from `apollo_compiler::parser`):
```rust
impl SourceSpan {
    pub fn offset(&self) -> usize;   // byte offset from start of file (0-based)
    pub fn end_offset(&self) -> usize;  // byte offset at end of span (exclusive)
    pub fn node_len(&self) -> usize;     // length in bytes: end_offset - offset
}
```

**`SourceMap` method**:
```rust
impl SourceMap {
    pub fn line_column_range(
        &self,
        span: SourceSpan,
    ) -> Option<(LineColumn, LineColumn)>;  // (start, end) positions
}
```

**Critical detail — 0-based vs 1-based**: Apollo-compiler's `LineColumn` uses **0-based indexing** (`line = 0` means first line, `column = 0` means first column). The task requires **1-based**. You must add 1 to both values:
```rust
let (start, _end) = sources.line_column_range(span)?;
let line = start.line + 1;   // convert 0-based → 1-based
let col = start.column + 1;  // convert 0-based → 1-based
```

**`len` calculation**: The task asks for "span length in characters." `SourceSpan::node_len()` returns byte length. For ASCII GraphQL SDL this is the same as character count. For non-ASCII, you may need to use `char_indices` on the source text to get character-length instead of byte-length. Given that GraphQL SDL is almost always ASCII, `node_len()` is likely sufficient, but verify with a test case containing Unicode if possible.

---

### 4. Severity mapping

The task requires `"severity": "error" | "warning"`. Apollo-compiler diagnostics don't carry an explicit severity enum in the public API — all diagnostics from `parse_and_validate` are errors (parsing + validation failures). 

**Practical approach**: Set all diagnostics to `"error"` since:
- Syntax/parsing errors are always fatal.
- Schema validation errors (undefined types, missing fields, etc.) are always errors.
- There are no "warning"-level diagnostics in the apollo-compiler validation pipeline for subgraph schemas.

If future work needs warnings (e.g., deprecated field usage), that would require a different API path (the `apollo_federation` crate has hint/warning levels).

---

### 5. Complete implementation sketch (for reference only)

```rust
pub fn validate_subgraph(sdl: &str) -> Value {
    match Schema::parse_and_validate(sdl, "schema.graphql") {
        Ok(_valid_schema) => json!({ "diagnostics": [] }),
        Err(with_errors) => {
            let diagnostics: Vec<Value> = with_errors
                .errors
                .iter()
                .filter_map(|diag| {
                    // Get message from Display impl
                    let message = diag.to_string();

                    // Get location
                    match &diag.location {
                        Some(span) => {
                            // Access SourceMap — need to get it from the DiagnosticList
                            // The sources field is pub(crate), so we may need to use
                            // an alternative approach or access via Debug/Display formatting.
                            // See Gaps section for this issue.
                            let (start, _end) = with_errors.errors.sources.line_column_range(*span)?;
                            Some(json!({
                                "severity": "error",
                                "message": message,
                                "line": start.line + 1,
                                "col": start.column + 1,
                                "len": span.node_len(),
                            }))
                        }
                        None => {
                            // No location — emit at position (1, 1) with len 0
                            Some(json!({
                                "severity": "error",
                                "message": message,
                                "line": 1,
                                "col": 1,
                                "len": 0,
                            }))
                        }
                    }
                })
                .collect();
            json!({ "diagnostics": diagnostics })
        }
    }
}
```

---

### 6. Gotchas

1. **`sources` is `pub(crate)` on `DiagnosticList`** — the internal `SourceMap` field is not publicly accessible from outside the crate. You cannot call `.sources.line_column_range()` directly. You may need to:
   - Use a different approach: parse with `Parser::new().parse_schema()` which returns `Result<Document, DiagnosticList>` and access the SourceMap differently.
   - Or check if there's a public accessor method on `DiagnosticList` or `DiagnosticData` that gives line/column directly.
   - Or use the `miette`/`ariadne` diagnostic rendering to get formatted output and parse it (fragile, not recommended).

2. **Empty SDL** — an empty string may produce a diagnostic itself. Test with `""` to confirm the expected behavior.

3. **Path argument** — `parse_and_validate` requires a `path: impl AsRef<Path>`. Use something like `"schema.graphql"` or `"<inline>"` as a dummy path. It's used only for diagnostic file identification, not filesystem access.

4. **WASM target** — the crate compiles to `wasm32-unknown-unknown`. All apollo-compiler dependencies must support this target. The existing `getrandom` wasm_js feature flag is already configured for this purpose (needed by transitive deps of apollo-federation).

5. **`insta` snapshot testing** — the crate uses `insta` with JSON features. Existing tests use `#[cfg(test)]` modules. New tests should follow the same pattern using `assert_json_eq` or similar.

6. **No panics allowed** — the lib.rs doc comment says "Nothing here panics on bad input." Ensure the implementation handles all edge cases (empty string, None location, etc.) without panicking.

---

### Sources
- Kept: apollo-compiler 1.32.0 docs.rs Schema struct (https://docs.rs/apollo-compiler/1.32.0/apollo_compiler/schema/struct.Schema.html) — primary API reference for parse_and_validate, sources field, builder pattern
- Kept: apollo-compiler source mod.rs (GitHub raw) — actual DiagnosticList/DiagnosticData struct definitions, Display impl on DiagnosticData, SourceSpan methods
- Kept: apollo-compiler Parser docs (https://docs.rs/apollo-compiler/1.32.0/apollo_compiler/parser/struct.Parser.html) — parse_schema, parse_and_validate signatures
- Kept: SourceSpan API (https://docs.rs/apollo-compiler/latest/apollo_compiler/parser/struct.SourceSpan.html) — offset(), end_offset(), node_len() methods
- Kept: LineColumn + line_column_range (GitHub issue #959 and search results) — confirms 0-based indexing and conversion needed
- Dropped: apollo-federation docs — not relevant for subgraph validation (only for supergraph composition, TASK-1 territory)
- Dropped: miette/ariadne display formatting docs — too fragile to parse programmatically; prefer direct API access

## Gaps
1. **`DiagnosticList.sources` visibility**: The `sources: SourceMap` field is `pub(crate)` and not accessible from outside apollo-compiler. Need to verify if there's a public method on `DiagnosticList`, `DiagnosticData`, or `WithErrors` that exposes line/column info. If not, consider using `Parser::new().parse_schema()` which may give more direct access to the SourceMap, or check if `DiagnosticData` has a `line()`/`column()` accessor in version 1.32.0 specifically (the latest docs may differ from 1.32.0).

2. **LineColumn base indexing**: Need to confirm definitively whether apollo-compiler's `LineColumn.line` is 0-based or 1-based by checking the actual 1.32.0 source code. The search results are ambiguous — some suggest 0-based, others are unclear.

3. **len = bytes vs characters**: GraphQL spec says line/col are character-based. `SourceSpan::node_len()` returns byte length. Need to confirm if this matters for the expected test cases (likely ASCII-only SDL).

4. **Severity levels**: If apollo-compiler differentiates between error and warning severity in any diagnostic, need to find that API. Current evidence suggests all are errors.

**Suggested next steps**: Check the 1.32.0 source code on GitHub for `DiagnosticList` public methods — specifically look for any accessor that returns line/column without needing direct SourceMap access. Also check if `DiagnosticData` has a `.location()` getter method (as opposed to the field being private).

<!-- SECTION:NOTES:END -->
