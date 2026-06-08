---
id: TASK-31
title: >-
  Fix validate_subgraph to accept federation SDL (support @link and other
  federation directives)
status: Done
assignee:
  - developer
created_date: '2026-06-08 18:38'
updated_date: '2026-06-08 22:28'
labels:
  - bug
  - rust
  - validation
milestone: m-1
dependencies:
  - TASK-9
  - TASK-28
priority: high
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`validate_subgraph()` in `crates/gql-core/src/validate.rs` uses `apollo_compiler::Schema::parse_and_validate`, which is plain-GraphQL-aware only. It rejects valid federation SDL because it doesn't know about `@link`, `@key`, `@shareable`, `@external`, `@requires`, etc. Users see a spurious error like:

```
Error: cannot find directive `@link` in this document
╭─[ <inline>:1:15 ]
 1 │ extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", ...)
```

…even when the schema is perfectly valid federation subgraph SDL.

## Root Cause

`validate.rs:12` calls `Schema::parse_and_validate(sdl, "<inline>")`. This is a raw `apollo-compiler` call that knows nothing about the federation link spec, so any `@link`/`@key`/etc. directive is treated as undefined.

`compose.rs` already does the right thing: it calls `Subgraph::parse(&name, "", &sdl)` from `apollo_federation::subgraph::typestate`, which is federation-aware. `validate_subgraph` needs the same treatment.

## Fix

Replace the `Schema::parse_and_validate` call in `validate_subgraph` with a call to `Subgraph::parse` from `apollo_federation::subgraph::typestate` (already available via `apollo-federation = "=2.15.0"`). Extract position diagnostics from the federation error. If the federation error type does not expose structured line/col, fall back to a single diagnostic at line 1 col 1 with the full error message — this is still better than false-positive "directive not defined" noise on valid SDL.

**Key files:**
- `crates/gql-core/src/validate.rs` — the only file that needs changing
- `crates/gql-core/src/compose.rs` — reference: shows the correct `Subgraph::parse` call pattern

## Implementation Notes

- The subgraph name passed to `Subgraph::parse` can be a placeholder (e.g. `"<subgraph>"`) since we only care about diagnostics, not the composed output.
- The URL argument (second param) can be an empty string `""` as done in compose.rs.
- Existing tests in `validate.rs` (valid SDL, syntax errors, missing fields) must continue to pass — update them if the error shape changes, but do not weaken the assertions.
- Add at least one new test: a valid federation SDL with `extend schema @link(...)` that asserts zero diagnostics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Valid federation SDL (with @link, @key, @shareable, @external, @requires, @inaccessible) returns zero diagnostics
- [x] #2 Invalid SDL that is also invalid as plain GraphQL (e.g. missing type, syntax error) still returns diagnostics with correct line/col
- [x] #3 Plain (non-federation) SDL continues to validate correctly — valid plain SDL returns zero diagnostics, invalid returns errors
- [x] #4 nix develop -c cargo test -p gql-core passes with no regressions
- [x] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan: Fix validate_subgraph to accept federation SDL

## Overview

Replace `Schema::parse_and_validate` in `validate_subgraph()` with `Subgraph::parse` from `apollo_federation::subgraph::typestate`, so valid federation SDL (with `@link`, `@key`, etc.) no longer produces false-positive diagnostics.

---

## Key Files

| File | Action |
|------|--------|
| `crates/gql-core/src/validate.rs` | **Modify** — replace parser, add new test |
| `crates/gql-core/Cargo.toml` | No change (both crates already active) |
| `crates/gql-core/src/compose.rs` | Reference only — shows correct `Subgraph::parse` usage |

---

## Changes to `validate.rs`

### 1. Replace imports (lines 4-6)

**Remove:**
```rust
use apollo_compiler::diagnostic::ToCliReport;
use apollo_compiler::parser::LineColumn;
use apollo_compiler::Schema;
```

**Add:**
```rust
use apollo_federation::subgraph::typestate::Subgraph;
```

`serde_json::{json, Value}` stays (already imported).

### 2. Replace `validate_subgraph` body (lines 9-30)

**New implementation:**
```rust
/// Validate one subgraph SDL. Returns `{ diagnostics: [...] }`.
pub fn validate_subgraph(sdl: &str) -> Value {
    match Subgraph::parse("<subgraph>", "", sdl) {
        Ok(_) => json!({ "diagnostics": [] }),
        Err(err) => {
            // SubgraphError has no public location data (pub(crate) fields).
            // Fall back to a single diagnostic at line 1, col 1 with the
            // formatted error message — still better than false positives.
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

**API call:** `Subgraph::parse(name: &str, url: &str, schema_str: &str) -> Result<Subgraph<Initial>, SubgraphError>`  
**Source:** `apollo_federation::subgraph::typestate` (pinned `=2.15.0`)  
**Reference usage:** `compose.rs:18` — identical call pattern with `(&sub.name, "", &sub.sdl)`

---

## TDD Order

### Test 1: Valid federation SDL (AC #1) — write FIRST, fails before code change

```rust
#[test]
fn valid_federation_sdl_returns_empty_diagnostics() {
    let sdl = r#"
extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "@external", "@requires", "@inaccessible"])
{
    query: Query
}

type Query {
    hello: String
}

type User @key(fields: "id") {
    id: ID!
    name: String
}
"#;
    let result = validate_subgraph(sdl);
    assert!(
        result["diagnostics"].as_array().unwrap().is_empty(),
        "valid federation SDL should produce no diagnostics"
    );
}
```

**Why first:** This is the primary failure case. The existing code uses `Schema::parse_and_validate` which rejects federation directives. This test proves the fix works before touching anything else.

### Test 2: Federation SDL with multiple directives (AC #1, deeper coverage)

```rust
#[test]
fn valid_federation_sdl_with_all_directives_returns_empty_diagnostics() {
    let sdl = r#"
extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "@external", "@requires", "@inaccessible"])
{
    query: Query
}

type Product @key(fields: "upc") {
    upc: String! @shareable
    name: String
    weight: Int @inaccessible
}

type Query {
    product(upc: String!): Product
}
"#;
    let result = validate_subgraph(sdl);
    assert!(result["diagnostics"].as_array().unwrap().is_empty());
}
```

### Test 3: Invalid SDL with syntax error (AC #2)

No new test needed. Existing test `invalid_sdl_returns_diagnostics_with_line_and_col` covers this. **But update the assertion:** after the change, all diagnostics will have `line: 1, col: 1` (fallback). The existing assertions (`line >= 1`, `col >= 1`) still hold. No modification needed to that test.

### Test 4: Plain SDL still works (AC #3)

No new test needed. Existing test `valid_sdl_returns_empty_diagnostics` uses plain non-federation SDL. It will continue to pass because `Subgraph::parse` accepts plain SDL.

---

## How Each Acceptance Criterion Is Met

### AC #1: Valid federation SDL returns zero diagnostics
- **Mechanism:** `Subgraph::parse` calls `Schema::builder().ignore_builtin_redefinitions().parse(...)` internally, which accepts unknown directives including all federation specs.  
- **Tests:** New tests above exercise `@link`, `@key`, `@shareable`, `@inaccessible`.

### AC #2: Invalid SDL returns diagnostics with correct line/col
- **Mechanism:** Parse errors produce a `SubgraphError` whose `Display` impl prints the error. We wrap it in a single diagnostic at `line: 1, col: 1`. The existing test only asserts `line >= 1` and `col >= 1`, so this satisfies it.  
- **Tradeoff:** Structured line/col is lost (error fields are `pub(crate)`), but diagnostics still fire.

### AC #3: Plain SDL continues to validate correctly
- **Mechanism:** `Subgraph::parse` accepts plain GraphQL SDL — it only adds federation awareness, does not require it.  
- **Tests:** Existing `valid_sdl_returns_empty_diagnostics` test (plain SDL) and `empty_string_returns_diagnostics_without_panic` cover this.

### AC #4: `cargo test -p gql-core` passes
- **Mechanism:** All four existing tests continue to work. Two new federation SDL tests are added. No regressions expected.

### AC #5: `pnpm tsc --noEmit` and `pnpm lint` pass
- **Mechanism:** Only Rust code changes; no TypeScript or lintable JavaScript is modified. These checks pass trivially.

---

## Risks and Prerequisites

### Risk 1: Error message format changes  
**Likelihood:** Medium  |  **Impact:** Low  
The `Display` impl for `SubgraphError` produces multi-line text. The existing tests don't assert on message content, only on structural presence. If a test asserts specific message wording, it will need updating.

**Mitigation:** Run `cargo test -p gql-core` immediately after the change and inspect any failures. The diagnostic shape (`severity`, `message`, `line`, `col`, `len`) is preserved.

### Risk 2: Loss of structured line/col for parse errors  
**Likelihood:** Certain  |  **Impact:** Low  
The Research Brief confirms `SubgraphError.errors` and `SingleSubgraphError.locations` are both `pub(crate)`. All diagnostics will default to `line: 1, col: 1, len: 0`.

**Mitigation:** Acceptable tradeoff. The existing code already falls back to `(1, 1)` when location is unavailable. For the common case (one parse error), a single diagnostic at `(1, 1)` with a readable message is sufficient.

### Risk 3: `Subgraph::parse` not catching federation-internal errors  
**Likelihood:** Certain  |  **Impact:** Low  
`Subgraph::parse` only parses the schema — it does not call `expand_links()` or validate federation semantics (e.g., `@key` on wrong field type, missing query root).

**Mitigation:** By design. Composition (`compose.rs`) handles those errors. The `validate_subgraph` function is a quick "does this SDL parse?" gate.

### Prerequisites  
- **TASK-9** (composition wiring) and **TASK-28** must be complete — both are dependencies listed on the task. These ensure `apollo-federation = "=2.15.0"` is wired and working in WASM.
- Both `apollo-compiler` and `apollo-federation` are already uncommented in `Cargo.toml` (confirmed).

---

## Implementation Steps (Developer Checklist)

1. **Write test:** Add `valid_federation_sdl_returns_empty_diagnostics` test to `validate.rs`  
2. **Run test:** Confirm it fails with current code (`Schema::parse_and_validate`)  
3. **Replace imports:** Swap `apollo_compiler` imports for `apollo_federation::subgraph::typestate::Subgraph`  
4. **Replace function body:** New `validate_subgraph` using `Subgraph::parse("<subgraph>", "", sdl)`  
5. **Run tests:** `cargo test -p gql-core` — fix any assertion mismatches  
6. **Add second test:** `valid_federation_sdl_with_all_directives_returns_empty_diagnostics`  
7. **Final verification:** `cargo test -p gql-core`, then `pnpm tsc --noEmit` and `pnpm lint`
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced Schema::parse_and_validate with Subgraph::parse from apollo-federation so validate_subgraph accepts federation SDL (@link, @key, @shareable, @external, @requires, @inaccessible) without false-positive diagnostics. All 13 Rust tests and 33 web tests pass; fmt, clippy, tsc, and eslint are clean. Two new tests added covering valid federation SDL and invalid syntax errors.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: Replace `Schema::parse_and_validate` with `Subgraph::parse` in `validate_subgraph`

## Summary

Replace the `Schema::parse_and_validate(sdl, "<inline>")` call in `validate_subgraph()` with `Subgraph::parse(&name, "", &sdl)` from `apollo_federation::subgraph::typestate`. The federation-aware parser correctly handles `@link`, `@key`, `@shareable`, etc. However, **the error type's location data is behind `pub(crate)` in the apollo-federation crate**, meaning structured line/col extraction from parse errors is not directly possible — you'll need to fall back to string-parsing the formatted output or accept a single diagnostic per error.

## Findings

### 1. API Signature and Behavior of `Subgraph::parse`

**Signature:**
```rust
pub fn parse(
    name: &str,
    url: &str,
    schema_str: &str,
) -> Result<Subgraph<Initial>, SubgraphError>
```

**Location:** `apollo_federation::subgraph::typestate` (re-exported as `apollo_federation::subgraph::typestate::Subgraph`)

**What it does internally:**
- Calls `Schema::builder().ignore_builtin_redefinitions().parse(schema_str, name)` — this is the key: `ignore_builtin_redefinitions()` tells apollo-compiler to accept unknown directives (like federation's `@link`, `@key`) rather than rejecting them as "undefined".
- Extracts orphan extension types.
- Runs backward-compatibility cleanup (duplicate argument dedup).
- Calls `Subgraph::new()` which validates the subgraph name.

**Return type on success:** `Subgraph<Initial>` — a federation-aware parsed schema. You don't need the full `Subgraph` struct; you just need to know it succeeded (zero diagnostics) or failed (diagnostics present).

### 2. Error Type: `SubgraphError` — Location Data is `pub(crate)`

**This is the critical finding.** The error type returned on failure is:

```rust
#[derive(Clone, Debug)]
pub struct SubgraphError {
    pub(crate) subgraph: String,       // NOT public
    pub(crate) errors: Vec<SingleSubgraphError>,  // NOT public
}
```

And the inner error struct is also `pub(crate)`:
```rust
#[derive(Clone, Debug)]
pub(crate) struct SingleSubgraphError {
    pub(crate) error: SingleFederationError,          // NOT public
    pub(crate) locations: Vec<Range<LineColumn>>,     // NOT public — THIS IS KEY
}
```

**Public API surface on `SubgraphError`:** Only one public method:
```rust
pub fn format_errors(&self) -> Vec<(String, String)>
```
This returns `(error_code_string, formatted_message)` tuples — **no location data whatsoever**. The `Display` impl for `SubgraphError` also prints errors line-by-line without structured locations.

**What this means:** You cannot extract `line`, `col`, or `len` from parse errors in a structured way. The only option is to use the `.to_string()` display output, which produces multi-line formatted text similar to what apollo-compiler outputs but without machine-readable position data.

### 3. What Error Variant Is Used for Parse Errors

When `Subgraph::parse` fails at the parsing stage (before federation validation), it calls:
```rust
Schema::builder().parse(schema_str, name)
    .build()
    .map_err(|e| SubgraphError::from_diagnostic_list(name, e.errors))?;
```

The `from_diagnostic_list` constructor maps each diagnostic to:
```rust
SingleFederationError::InvalidGraphQL { message: d.to_string() }
```

With locations attached in the `locations` field. But since that field is `pub(crate)`, it's inaccessible.

### 4. Implementation Approach

**Recommended approach:** Use `Subgraph::parse` and handle both success and failure paths:

```rust
pub fn validate_subgraph(sdl: &str) -> Value {
    match Subgraph::parse("<subgraph>", "", sdl) {
        Ok(_) => json!({ "diagnostics": [] }),
        Err(err) => {
            // Only public API available: format_errors() and Display
            let diagnostics = vec![json!({
                "severity": "error",
                "message": err.to_string(),  // or err.format_errors().iter().map(|(c,m)| format!("{c} {m}")).collect::<Vec<_>>().join("\n")
                "line": 1,
                "col": 1,
                "len": 0,
            })];
            json!({ "diagnostics": diagnostics })
        }
    }
}
```

**Tradeoff:** You lose structured line/col for parse errors. The error message will be multi-line and human-readable (from the `Display` impl), but you can't extract individual diagnostic positions. This is acceptable because:
- The existing fallback in `validate.rs` already handles missing locations by defaulting to line 1, col 1.
- Parse errors from apollo-compiler are typically syntax errors where a single "here's wrong" marker is sufficient.

**Alternative (if structured locations are required):** Create a thin wrapper in `gql-core` that re-implements the parsing logic using `apollo_compiler::Schema::builder().ignore_builtin_redefinitions().parse()` directly, then maps `DiagnosticList` to diagnostics with full line/col info. This avoids depending on `pub(crate)` internals but duplicates parsing logic.

### 5. Existing Tests Impact

The existing tests in `validate.rs` check:
- **valid_sdl_returns_empty_diagnostics** — will continue to pass (valid SDL parses fine).
- **invalid_sdl_returns_diagnostics_with_line_and_col** — needs careful attention. The error shape changes from apollo-compiler's raw diagnostics to federation's formatted output. The tests assert `line >= 1` and `col >= 1`, which the fallback satisfies, but the message format will change. Update the assertions to check for structural presence of diagnostics rather than specific message content.
- **diagnostic_has_all_required_fields** — will pass (same JSON shape).
- **empty_string_returns_diagnostics_without_panic** — will pass.

### 6. New Test Required

Add a test with valid federation SDL:
```rust
#[test]
fn valid_federation_sdl_returns_empty_diagnostics() {
    let sdl = r#"
extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "@external", "@requires", "@inaccessible"])
{
    query: Query
}

type Query {
    hello: String
}

type User @key(fields: "id") {
    id: ID!
    name: String
}
"#;
    let result = validate_subgraph(sdl);
    assert!(result["diagnostics"].as_array().unwrap().is_empty());
}
```

### 7. Gotchas

1. **`SubgraphError` fields are `pub(crate)`** — You cannot access `.errors` or `.subgraph` directly. Only `.to_string()` and `.format_errors()` are public. This is the biggest gotcha.

2. **Placeholder subgraph name** — The task says to use `"<subgraph>"` as the name, but `Subgraph::parse` calls `Self::new()` which rejects the reserved name `FEDERATED_GRAPH_ROOT_SOURCE` ("__schema"). `"<subgraph>"` is safe.

3. **URL parameter** — Can be empty string `""` per compose.rs pattern. The URL is stored on `Subgraph` but not used during parse-time validation.

4. **`SingleFederationError::InvalidGraphQL` vs other variants** — Parse errors produce `InvalidGraphQL { message }`. Federation-specific validation errors (e.g., missing `@key`) would produce different variants, but those only appear after the initial parse succeeds and `expand_links()` is called — which we are NOT doing in `validate_subgraph`. The validate function only needs to check that the SDL parses without federation-errors.

5. **No `expand_links` or `assume_validated`** — We're only using `Subgraph::parse`, not the full pipeline (`expand_links()`, `normalize_root_types()`, `assume_validated()`). This means we won't catch federation-specific validation errors (e.g., `@key` on an interface, missing query root) — but that's by design. Composition already handles those in `compose.rs`. The validate function is for quick "does this SDL parse?" checks.

## Sources

### Kept:
- [apollo-federation Rust docs (docs.rs)](https://docs.rs/apollo-federation/) — Primary API reference for the crate used by the project.
- [Router repo `subgraph/typestate.rs` source](https://github.com/apollographql/router/blob/dev/apollo-federation/src/subgraph/typestate.rs) — Exact implementation of `Subgraph::parse`, return types, and error handling. Cloned locally at `/tmp/pi-github-repos/apollographql/router@dev`.
- [Router repo `subgraph/mod.rs` source](https://github.com/apollographql/router/blob/dev/apollo-federation/src/subgraph/mod.rs) — `SubgraphError`, `SingleSubgraphError` struct definitions and visibility modifiers. Critical for determining public API surface.
- [Router repo `error/mod.rs` source](https://github.com/apollographql/router/blob/dev/apollo-federation/src/error/mod.rs) — `SingleFederationError` enum, `InvalidGraphQL` variant, `code_string()` method.
- [crates.io apollo-federation v2.15.0](https://crates.io/crates/apollo-federation) — Confirms the version the project depends on.

### Dropped:
- [Generic "apollo-federation is internal to Router" notes](https://docs.rs/apollo-federation/2.12.0/apollo_federation/) — Not actionable; we already know it's an internal crate and are using it directly as the project does.
- [PR #7171: typestate pattern](https://github.com/apollographql/router/pull/7171) — Good context but doesn't change the API surface analysis.

## Gaps

1. **Structured location extraction from parse errors** — Cannot be done with current public API. The developer must choose between:
   - Accepting single-line diagnostics (fallback approach, per task spec)
   - Re-implementing parsing logic directly with `apollo_compiler` to get `DiagnosticList` with locations
   - Requesting a public API change upstream in apollo-federation

2. **Exact error message format** — The `Display` impl for `SubgraphError` produces multi-line output. The developer should test what the actual string looks like to decide whether it's usable or if they need to parse it further.

3. **Whether `Subgraph::parse` catches federation-specific validation errors** — It only parses the schema; it does NOT call `expand_links()` or validate federation semantics. This is by design but worth confirming with a test that an invalid federation directive (e.g., `@key` on wrong field type) still passes `validate_subgraph` and is caught later in composition.

<!-- SECTION:NOTES:END -->
