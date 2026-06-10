---
id: TASK-15
title: Implement validate_query() against the API schema
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-10 02:08'
labels: []
milestone: m-2
dependencies:
  - TASK-14
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the validate.rs stub for validate_query so the query editor can flag invalid operations. Validate against the API schema (not the raw supergraph).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A valid operation returns an empty diagnostics list
- [x] #2 An operation with an unknown field returns a diagnostic with correct 1-based position
- [x] #3 Output shape matches validate_subgraph exactly
- [x] #4 nix develop -c cargo build and cargo test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Keep the signature in `crates/gql-core/src/validate.rs`: `pub fn validate_query(supergraph_sdl: &str, operation: &str) -> serde_json::Value`

2. Derive the API schema from the supergraph SDL:
   - Call `crate::api_schema::derive_api_schema(supergraph_sdl)` which returns `Result<String, FederationError>`.
   - On `Err(e)`, return `{ "diagnostics": [{ "severity": "error", "message": e.to_string(), "line": 1, "col": 1, "len": 0 }] }` — composition failed, treat it as a single diagnostic at the default fallback position.

3. Parse the API schema SDL into an apollo-compiler `Schema`:
   ```rust
   use apollo_compiler::Schema;
   let valid_schema = Schema::parse_and_validate(&api_sdl, "<api-schema>")?;
   ```
   - `parse_and_validate` returns `Result<Valid<Schema>, WithErrors<Schema>>`. If this errors (should not happen since the SDL came from composition), return the diagnostics from those errors using the same extraction logic below.

4. Parse and validate the operation against the schema:
   ```rust
   use apollo_compiler::ExecutableDocument;
   match ExecutableDocument::parse_and_validate(&valid_schema, operation, "<operation>") {
       Ok(_) => json!({ "diagnostics": [] }),
       Err(with_errors) => extract_diagnostics(&with_errors),
   }
   ```
   - `Ok(_)` means zero validation errors — returns empty diagnostics list (acceptance criterion #1).
   - `Err(with_errors)` contains a `WithErrors<ExecutableDocument>` with all validation diagnostics.

5. Write a helper to extract diagnostics from `WithErrors`:
   ```rust
   use apollo_compiler::validation::WithErrors;
   fn extract_diagnostics(with_errors: &WithErrors<ExecutableDocument>) -> serde_json::Value {
       let sources = &with_errors.document.sources;
       let mut diagnostics = Vec::new();
       for diag in with_errors.errors.iter() {
           let span = diag.span.unwrap_or_default();
           let lc = span.line_column(sources).unwrap_or(apollo_compiler::parser::LineColumn { line: 1, column: 1 });
           diagnostics.push(json!({
               "severity": "error",
               "message": diag.to_string(),
               "line": lc.line,
               "col": lc.column,
               "len": span.len(),
           }));
       }
       json!({ "diagnostics": diagnostics })
   }
   ```
   - `diag.span` is `Option<SourceSpan>` — use `unwrap_or_default()` when `None` (meta-errors).
   - `span.line_column(sources)` returns 1-based `LineColumn { line, column }` already — no offset conversion needed.
   - `span.len()` gives UTF-8 byte length of the span.
   - All severities are `"error"` for consistency with `validate_subgraph` (acceptance criterion #3).

6. Wire it all together in `validate_query()`:
   ```rust
   pub fn validate_query(supergraph_sdl: &str, operation: &str) -> Value {
       // Step 2: derive API schema
       let api_sdl = match crate::api_schema::derive_api_schema(supergraph_sdl) {
           Ok(sdl) => sdl,
           Err(e) => {
               return json!({ "diagnostics": [{
                   "severity": "error",
                   "message": e.to_string(),
                   "line": 1, "col": 1, "len": 0
               }] });
           }
       };
       // Step 3: parse schema
       let valid_schema = match Schema::parse_and_validate(&api_sdl, "<api-schema>") {
           Ok(s) => s,
           Err(we) => return extract_diagnostics(&we),
       };
       // Step 4: validate operation
       match ExecutableDocument::parse_and_validate(&valid_schema, operation, "<operation>") {
           Ok(_) => json!({ "diagnostics": [] }),
           Err(we) => extract_diagnostics(&we),
       }
   }
   ```

7. Add `#[cfg(test)]` tests in the existing `mod tests` block inside `validate.rs`:
   - **Test: valid operation returns empty diagnostics** (AC#1)
     ```rust
     #[test]
     fn valid_query_returns_empty_diagnostics() {
         // Use a minimal supergraph SDL with a Query type.
         let supergraph_sdl = /* compose two subgraphs or use raw supergraph */;
         let result = validate_query(supergraph_sdl, "{ __typename }");
         assert!(result["diagnostics"].as_array().unwrap().is_empty());
     }
     ```
   - **Test: unknown field returns diagnostic with 1-based position** (AC#2)
     ```rust
     #[test]
     fn unknown_field_returns_diagnostic_with_position() {
         let result = validate_query(supergraph_sdl, "{ nonexistentField }");
         let diags = result["diagnostics"].as_array().unwrap();
         assert!(!diags.is_empty());
         // Verify line/col are 1-based and point to the unknown field.
         assert!(diags[0]["line"].as_u64() >= Some(1));
         assert!(diags[0]["col"].as_u64() >= Some(1));
     }
     ```
   - **Test: output shape matches validate_subgraph** (AC#3)
     Verify every diagnostic has exactly the fields `severity`, `message`, `line`, `col`, `len` — same shape as `validate_subgraph` diagnostics.
   - **Test: empty operation returns a diagnostic, not an error**
     Empty string input should produce at least one diagnostic (GraphQL spec requires at least one operation).

8. Build and verify:
   ```sh
   nix develop -c cargo build -p gql-core
   nix develop -c cargo test -p gql-core validate
   ```
   Confirm zero compiler warnings, all tests pass including the existing `validate_subgraph` tests and the new `validate_query` tests.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented validate_query() in crates/gql-core/src/validate.rs: derives the API schema from the supergraph SDL via derive_api_schema(), parses it into an apollo-compiler Schema, validates operations using ExecutableDocument::parse_and_validate(), and returns diagnostics with 1-based line/col/len positions matching the validate_subgraph output shape. Six tests added covering valid queries, unknown fields, empty input, diagnostic field completeness, output shape parity, and federation SDL support. All quality gates pass (27 Rust tests, 38 web tests, fmt, clippy, tsc, eslint clean).
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research: Implement validate_query() against the API schema

## Summary
The implementation parses the API-schema SDL (derived from the supergraph via TASK-14's `derive_api_schema()`) into an `apollo_compiler::Schema`, then calls `ExecutableDocument::parse_and_validate()` to check the operation. Validation diagnostics with 1-based line/col/len are extracted from the `DiagnosticList` using each diagnostic's `SourceSpan.line_column()` and byte-length helpers, then mapped to the existing `{ severity, message, line, col, len }` JSON shape.

## Findings

### 1. Two-step parse → validate pipeline (the core API)
**Approach:** Parse the API-schema SDL into an apollo-compiler `Schema`, then parse+validate the operation against it in one call.

```rust
use apollo_compiler::{Schema, ExecutableDocument};

// Step 1: parse the API schema SDL (from derive_api_schema())
let schema = Schema::parse_and_validate(&api_sdl, "schema.graphql")?;

// Step 2: parse + validate the operation against that schema
match ExecutableDocument::parse_and_validate(&schema, &operation, "query.graphql") {
    Ok(_valid_doc) => json!({ "diagnostics": [] }),
    Err(with_errors) => extract_diagnostics(&with_errors),
}
```

**Rationale:** `parse_and_validate()` does both syntax parsing and full GraphQL spec validation (unknown fields, type mismatches, missing required arguments, etc.) in one pass. The `Ok` branch means zero diagnostics — matching acceptance criterion #1. The `Err` branch yields a partial document plus all validation errors.

**Sources:**
- [apollo-compiler docs: ExecutableDocument::parse_and_validate](https://docs.rs/apollo-compiler/latest/apollo_compiler/executable/struct.ExecutableDocument.html)
- [apollo-compiler docs: Schema::parse_and_validate](https://docs.rs/apollo-compiler/latest/apollo_compiler/schema/struct.Schema.html)

### 2. Extracting diagnostics with positions from `WithErrors`
When validation fails, the return type is `Err(WithErrors<ExecutableDocument>)`. The `WithErrors` wrapper gives access to:
- `.document` — the partial executable document (for reference)
- `.errors` — a `&DiagnosticList` containing all diagnostics

**API for iterating diagnostics:**

```rust
use apollo_compiler::validation::WithErrors;
use apollo_compiler::parser::{SourceSpan, LineColumn};

fn extract_diagnostics(with_errors: &WithErrors<ExecutableDocument>) -> serde_json::Value {
    let sources = &with_errors.document.sources;
    let mut diagnostics = Vec::new();
    
    for diag in with_errors.errors.iter() {
        // Each diagnostic has a `span` field (SourceSpan)
        let span: SourceSpan = diag.span.unwrap_or_default();
        
        // Convert byte-offset span to 1-based line/col
        let lc = span.line_column(sources).unwrap_or(LineColumn { line: 1, column: 1 });
        let line_1based = lc.line;
        let col_1based = lc.column;
        
        // Byte length from the span
        let len = span.len();
        
        // Message comes from the diagnostic's error description
        let message = diag.to_string(); // or diag.error.to_string()
        
        diagnostics.push(json!({
            "severity": "error",
            "message": message,
            "line": line_1based,
            "col": col_1based,
            "len": len,
        }));
    }
    
    json!({ "diagnostics": diagnostics })
}
```

**Key API details:**
- `diag.span` returns `Option<SourceSpan>` — may be `None` for certain meta-errors. Fall back to `span.unwrap_or_default()` (zero-length span at start of file).
- `SourceSpan.line_column(&sources)` returns `Option<LineColumn>` — converts byte offsets to 1-based line/column. Returns `None` if the span is out-of-bounds (edge case for empty input).
- `SourceSpan.len()` returns byte length in UTF-8 bytes (not characters). This matches what editors like Monaco expect for selection ranges.
- `diag.to_string()` or accessing `diag.error` gives the human-readable message.

**Sources:**
- [apollo-compiler docs: Diagnostic struct](https://docs.rs/apollo-compiler/latest/apollo_compiler/diagnostic/struct.Diagnostic.html)
- [apollo-compiler docs: SourceSpan](https://docs.rs/apollo-compiler/latest/apollo_compiler/parser/struct.SourceSpan.html)
- [SourceSpan.line_column() — converts to 1-indexed LineColumn](https://docs.rs/apollo-compiler/latest/apollo_compiler/parser/struct.SourceSpan.html#method.line_column)

### 3. `DiagnosticList` iteration API
The `DiagnosticList` implements `IntoIterator`, yielding references to `Diagnostic` structs:

```rust
for diag in with_errors.errors.iter() {
    // diag: &Diagnostic<T>
}
```

`DiagnosticList` also has `is_empty()` for quick checks and `len()`.

**Sources:**
- [apollo-compiler docs: DiagnosticList](https://docs.rs/apollo-compiler/latest/apollo_compiler/validation/struct.DiagnosticList.html)

### 4. API schema as a parseable SDL string
TASK-14's `derive_api_schema()` returns an SDL string via `api_schema.schema().to_string()`. This is a standard GraphQL SDL that `apollo_compiler::Schema::parse_and_validate()` can consume directly — no special handling needed. The schema contains only user-defined types and fields (federation internals like `@join__*`, `_entities`, `_Service` are stripped).

**Important:** The api_schema.rs uses `api_schema.schema().to_string()`, not `.print()`. Both produce SDL, but the current code path is confirmed working by the TASK-14 test. Use the same approach — pass the returned string directly to `Schema::parse_and_validate()`.

### 5. Severity mapping: use `"error"` (consistent with validate_subgraph)
The existing `validate_subgraph` always returns `"severity": "error"` for parse failures. Since GraphQL validation errors are all fatal (there's no "warning" level in the spec), map everything to `"error"` for consistency with criterion #3 ("Output shape matches validate_subgraph exactly").

### 6. Edge cases and gotchas
- **Empty operation string:** `ExecutableDocument::parse_and_validate()` will return a diagnostic for an empty document (per GraphQL spec, a document must contain at least one operation). The span may be out-of-bounds; fall back to line=1, col=1, len=0.
- **Operation without a name:** If the operation string contains an unnamed operation (`{ field }`), `parse_and_validate()` accepts it fine. No issue.
- **Multiple operations in one string:** `parse_and_validate()` validates all operations. Diagnostics will include errors from all of them. This is correct behavior — the editor sends one query at a time, but the parser handles multi-op documents.
- **`apollo-compiler` on wasm32:** The apollo-compiler crate compiles to wasm32 (proved in Spike 0). No additional feature flags needed beyond what's already in Cargo.toml.
- **1-based vs 0-based:** `LineColumn.line` and `LineColumn.column` are **1-indexed** per the GraphQL spec convention, matching the requirement for "correct 1-based position" (criterion #2).

## Tradeoffs considered

| Option | Pros | Cons |
|--------|------|------|
| `parse_and_validate()` (single call) | Simplest code path; one error envelope; built-in full spec validation | None identified |
| `parse()` then `validate()` separately | More control over each phase | Unnecessarily complex for this use case; same end result |

**Recommendation:** Use `parse_and_validate()` — it's the idiomatic apollo-compiler API and directly maps to the task requirements.

## Exact API signatures for external libraries

All from `apollo-compiler = "=1.32.0"`:

```rust
// Schema parsing (returns Result<Valid<Schema>, WithErrors<Schema>>)
pub fn parse_and_validate(
    source_text: impl Into<String>,
    path: impl AsRef<Path>,
) -> Result<Valid<Schema>, WithErrors<Schema>>

// Executable document parsing + validation (returns Result<Valid<ExecutableDocument>, WithErrors<ExecutableDocument>>)
pub fn parse_and_validate(
    schema: &Valid<Schema>,
    source_text: impl Into<String>,
    path: impl AsRef<Path>,
) -> Result<Valid<ExecutableDocument>, WithErrors<ExecutableDocument>>

// DiagnosticList iteration
impl DiagnosticList {
    pub fn iter(&self) -> impl Iterator<Item = &Diagnostic<'_, T>>
    pub fn is_empty(&self) -> bool
}

// SourceSpan → line/col conversion
pub struct SourceSpan {
    pub fn line_column(&self, sources: &SourceMap) -> Option<LineColumn>
    pub fn len(&self) -> usize
}

pub struct LineColumn {
    pub line: u32,   // 1-indexed
    pub column: u32, // 1-indexed (byte offset within the line)
}

// Diagnostic access
pub struct Diagnostic<'s, T> {
    pub sources: &'s SourceMap,
    pub error: &'s T,
    pub span: Option<SourceSpan>,
}
```

## Sources
- **Kept:** apollo-compiler 1.32.0 docs — ExecutableDocument API (https://docs.rs/apollo-compiler/latest/apollo_compiler/executable/struct.ExecutableDocument.html) — primary source for parse_and_validate() signature and return types
- **Kept:** apollo-compiler 1.32.0 docs — Schema API (https://docs.rs/apollo-compiler/latest/apollo_compiler/schema/struct.Schema.html) — primary source for schema parsing
- **Kept:** apollo-compiler 1.32.0 docs — Diagnostic struct (https://docs.rs/apollo-compiler/latest/apollo_compiler/diagnostic/struct.Diagnostic.html) — diagnostic field structure and span access
- **Kept:** apollo-compiler 1.32.0 docs — SourceSpan (https://docs.rs/apollo-compiler/latest/apollo_compiler/parser/struct.SourceSpan.html) — line_column() conversion API, len(), byte-based offsets
- **Kept:** apollo-compiler 1.32.0 docs — DiagnosticList (https://docs.rs/apollo-compiler/latest/apollo_compiler/validation/struct.DiagnosticList.html) — iteration API for collecting all errors
- **Kept:** Project's api_schema.rs (TASK-14 implementation) — confirms derive_api_schema() returns SDL string via `.to_string()`
- **Kept:** Project's validate.rs — confirms existing diagnostic shape `{ severity, message, line, col, len }` with 1-based positions

## Gaps
- **Severity enum values:** The GraphQL spec doesn't define severity levels. The project uses `"error"` consistently in `validate_subgraph`. Confirmed acceptable for criterion #3.
- **Exact `DiagnosticList` iterator type:** The exact return type of `.iter()` varies slightly between apollo-compiler versions but always yields references to `Diagnostic`. The `for diag in with_errors.errors.iter()` pattern is confirmed idiomatic.
- **Column semantics (byte vs character):** `LineColumn.column` is a byte offset within the line, not a character count. Monaco editor expects 0-based character offsets for decorations, so the web layer will need to convert from the 1-based byte column to 0-based char offset on the JS side. This is outside the Rust implementation scope but worth noting.
- **`diag.to_string()` vs `diag.error.to_string()`:** Both should produce the validation error message. The exact format depends on the internal `DiagnosticData` enum variant (e.g., "Field 'nonexistent' doesn't exist on type 'Query'" for unknown-field errors). The developer should verify the exact output matches editor expectations.

<!-- SECTION:NOTES:END -->
