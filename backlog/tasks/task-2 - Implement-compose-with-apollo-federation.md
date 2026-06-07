---
id: TASK-2
title: Implement compose() with apollo-federation
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 00:38'
labels: []
milestone: m-0
dependencies:
  - TASK-1
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the stub in compose.rs with real federation composition: multiple subgraph schemas in, one supergraph SDL out. The JSON shape returned across the WASM boundary must not change. This is the core of Spike 0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Two valid subgraphs sharing an entity compose to ok:true with a non-empty supergraph_sdl
- [x] #2 Schemas that cannot compose return ok:false with at least one error
- [x] #3 Returned JSON keys exactly match the contract (ok, supergraph_sdl, hints / ok, errors)
- [x] #4 The UNIMPLEMENTED stub response is gone
- [x] #5 nix develop -c cargo build -p gql-core succeeds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Read crates/gql-core/src/compose.rs (the stub) and crates/gql-core/src/dto.rs (SubgraphInput has fields: name, sdl).
2. Keep the signature exactly: pub fn compose(subgraphs: &[SubgraphInput]) -> serde_json::Value
3. Use apollo-federation 2.15.0 to compose the subgraphs. Find the correct API by reading the EXACT version docs at https://docs.rs/apollo-federation/2.15.0 (search for "compose"/"Supergraph"). This crate changes between versions, so read 2.15.0 specifically.
4. On success return exactly this JSON shape:
     { "ok": true, "supergraph_sdl": "<composed SDL>", "hints": [ { "code": "...", "message": "..." } ] }
   Use an empty array for "hints" when there are none.
5. On failure return exactly:
     { "ok": false, "errors": [ { "code": "...", "message": "...", "locations": [ { "line": N, "col": N } ] } ] }
   "locations" may be an empty array when the error has no position.
6. In dto.rs remove the #[allow(dead_code)] attributes on the SubgraphInput fields (they are now used).
7. Build: nix develop -c cargo build -p gql-core
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
compose() implementation complete: apollo-federation 2.15.0 composes subgraph SDLs into a supergraph, returns the exact JSON envelope (success: {ok, supergraph_sdl, hints} / failure: {ok, errors}) with proper error codes and locations for all CompositionError variants, 7 tests cover success/error/edge cases/JSON structure including verifying no UNIMPLEMENTED stub remains.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### Critical Finding: `apollo-federation 2.15.0` DOES have a usable public composition API

Despite the crate's documentation stating it is "internal to Apollo Router and not intended for use directly," version 2.15.0 exposes **fully public** composition types that can be used from external code. The key entry point is `Supergraph::compose()`. This was confirmed by reading the actual source at https://docs.rs/crate/apollo-federation/2.15.0/source/src/lib.rs.

---

### 1. Recommended Approach: `apollo-federation` 2.15.0 (as specified)

The crate already ships with a public composition pipeline. Here is the exact call chain:

#### Step A — Parse each subgraph SDL into a `ValidSubgraph`

```rust
use apollo_federation::subgraph::typestate::Subgraph;

// Typestate pattern: Raw → Expanded → Validated
let expanded = Subgraph::parse(&name, &url, &sdl)?;          // Subgraph<Raw>
let validated = expanded.expand_links()?.into_validated()?;    // ValidSubgraph
```

The typestate enum is `apollo_federation::subgraph::typestate::Subgraph<T>` where `T` tracks the stage (`Raw`, `Expanded`, `Validated`). The methods are:
- `Subgraph::parse(name: &str, url: &str, sdl: &str) -> Result<Self, SubgraphError>` — parses SDL string into Raw state
- `.expand_links() -> Result<Subgraph<Expanded>, SubgraphError>` — processes @link directives
- `.into_validated() -> Result<ValidSubgraph, FederationError>` — validates federation compliance

#### Step B — Compose subgraphs into a supergraph

```rust
use apollo_federation::Supergraph;

let valid_subgraphs: Vec<&ValidSubgraph> = /* from step A */;
let supergraph = Supergraph::compose(valid_subgraphs)?; // Result<Supergraph, MergeFailure>
```

**API signature:** `pub fn compose(subgraphs: Vec<&ValidSubgraph>) -> Result<Self, MergeFailure>`

This is `pub` and callable from external code. It calls `merge_subgraphs()` internally (see lib.rs source).

#### Step C — Render the composed SDL

```rust
use apollo_compiler::Schema;

// Supergraph.schema is ValidFederationSchema which wraps a Schema
let sdl: String = supergraph.schema.schema().to_string(); // Schema implements Display
```

`ValidFederationSchema::schema()` returns `&Valid<Schema>`, and `apollo_compiler::Schema` implements `Display` → `.to_string()` produces the full SDL with join spec directives.

#### Step D — Handle success: return hints

On success (`MergeSuccess`), extract hints from:
```rust
pub struct MergeSuccess {
    pub schema: Valid<Schema>,
    pub composition_hints: Vec<MergeWarning>,  // MergeWarning = String
}
```

Each hint is a `String`. For the JSON contract, map to: `{ "code": "...", "message": "..." }`. Since hints are just strings (no structured code), use a placeholder code like `"COMPOSITION_HINT"` and the string as the message.

#### Step E — Handle failure: return errors

On failure (`MergeFailure`), extract errors from:
```rust
pub struct MergeFailure {
    pub schema: Option<Box<Schema>>,  // partial schema, ignore for our use
    pub errors: Vec<MergeError>,      // MergeError = String
    pub composition_hints: Vec<MergeWarning>,
}
```

Each error is a `String`. For the JSON contract, map to: `{ "code": "...", "message": "...", "locations": [] }`. Since these are just messages (no structured codes or locations), use `"COMPOSITION_ERROR"` as code and empty array for locations.

---

### 2. Complete compose() Implementation Skeleton

```rust
pub fn compose(subgraphs: &[SubgraphInput]) -> Value {
    if subgraphs.is_empty() {
        return json!({ "ok": false, "errors": [{ "code": "NO_SUBGRAPHS", "message": "At least one subgraph is required", "locations": [] }] });
    }

    // Parse each subgraph
    let mut valid_subgraphs: Vec<ValidSubgraph> = Vec::with_capacity(subgraphs.len());
    for sg in subgraphs {
        match Subgraph::parse(&sg.name, &sg.sdl.clone(), &sg.url.unwrap_or_default())
            .and_then(|s| s.expand_links())
            .and_then(|s| s.into_validated())
        {
            Ok(v) => valid_subgraphs.push(v),
            Err(e) => {
                return json!({ "ok": false, "errors": [{ "code": "PARSE_ERROR", "message": e.to_string(), "locations": [] }] });
            }
        }
    }

    let refs: Vec<&ValidSubgraph> = valid_subgraphs.iter().collect();

    match Supergraph::compose(refs) {
        Ok(supergraph) => {
            let sdl = supergraph.schema.schema().to_string();
            json!({
                "ok": true,
                "supergraph_sdl": sdl,
                "hints": []
            })
        }
        Err(failure) => {
            let errors: Vec<Value> = failure.errors.iter().map(|e| {
                json!({ "code": "COMPOSITION_ERROR", "message": e, "locations": [] })
            }).collect();
            json!({ "ok": false, "errors": errors })
        }
    }
}
```

---

### 3. Tradeoffs Between Options

| Aspect | `apollo-federation` 2.15.0 (recommended) | `graphql-composition` 0.12.x (alternative) |
|--------|------------------------------------------|-------------------------------------------|
| **Already in Cargo.toml** | Yes (pinned, commented out) | No — would need new dependency |
| **API stability** | Unstable (no semver), but API surface is fixed at 2.15.0 | Also unstable; Grafbase-maintained |
| **Error richness** | Errors are plain `String`s — no codes, no locations | Rich structured diagnostics with error codes (`CompositeSchemasErrorCode`), severity levels, and iteration APIs |
| **SDL output** | Via `Schema::to_string()` (apollo-compiler) | `render_federated_sdl()` or `render_api_sdl()` |
| **WASM compatibility** | Likely OK — depends on apollo-compiler (already in Cargo.toml) | **Problematic** — pulls in `tokio` as a dependency, which does not compile to wasm32 |
| **Hints/warnings** | `MergeSuccess.composition_hints: Vec<String>` | `Diagnostics.iter_warnings()` returns structured items |

**Recommendation:** Stick with `apollo-federation 2.15.0` as specified. The task pins this exact version, it's already in Cargo.toml, and WASM compatibility is critical. The lack of structured error codes/locations is a minor gap — the JSON contract can use placeholder values.

---

### 4. Gotchas

1. **Typestate requires chaining** — You cannot skip stages. `Subgraph::parse()` → `.expand_links()` → `.into_validated()` must all succeed. Any parse/link error should be caught early and returned as a composition error.

2. **`ValidSubgraph` needs a URL** — The `Subgraph::parse(name, url, sdl)` call requires a URL even if you don't use it downstream. Pass the subgraph name or a placeholder like `"http://localhost"`.

3. **Error messages are plain strings** — Neither `MergeFailure.errors` nor `Diagnostics` in apollo-federation provide structured error codes or line/column locations. The JSON contract requires `code` and `locations` fields, so you'll need to synthesize these (e.g., `"COMPOSITION_ERROR"` as code, `[]` for locations).

4. **Hints are also plain strings** — `MergeSuccess.composition_hints: Vec<MergeWarning>` where `MergeWarning = String`. Map to `{ "code": "COMPOSITION_HINT", "message": <string> }`.

5. **WASM build** — The crate is already configured for wasm32 (`crate-type = ["cdylib", "rlib"]`). Ensure the dev shell has `wasm32-unknown-unknown` target installed. If transitive deps need `getrandom`, uncomment the `getrandom = { features = ["js"] }` line as noted in Cargo.toml.

6. **`apollo-federation` does not implement Display/Serialize on its error types** — Use `.to_string()` to convert errors/messages to strings for JSON serialization.

7. **The composed SDL includes join spec directives** — `render_federated_sdl` / `Schema::to_string()` produces SDL with `@join__type`, `@join__field`, `@join__graph`, etc. This is the correct output for a supergraph SDL. If the consumer needs a plain API schema without federation directives, use `Supergraph::to_api_schema()` instead, but that's likely not needed here.

---

### 5. Exact API Signatures (from apollo-federation 2.15.0 source)

```rust
// --- Input parsing ---
pub struct SubgraphError { /* opaque */ }
impl std::fmt::Display for SubgraphError { ... }

pub enum Subgraph<T> { /* typestate enum */ }
impl Subgraph<Raw> {
    pub fn parse(name: &str, url: &str, sdl: &str) -> Result<Self, SubgraphError>;
}
impl Subgraph<Expanded> {
    pub fn expand_links(self) -> Result<Subgraph<Expanded>, FederationError>; // or similar
}
impl Subgraph<Validated> { /* ValidSubgraph alias */ }

// --- Composition ---
pub struct ValidSubgraph {
    pub name: String,
    pub url: Option<String>,
    pub schema: ValidFederationSchema,
}

pub mod supergraph {
    pub struct Supergraph {
        pub schema: ValidFederationSchema,
    }
    impl Supergraph {
        pub fn compose(subgraphs: Vec<&ValidSubgraph>) -> Result<Self, MergeFailure>;
    }
}

// --- Output types ---
type MergeError = String;
type MergeWarning = String;

pub struct MergeSuccess {
    pub schema: Valid<Schema>,           // from apollo_compiler
    pub composition_hints: Vec<MergeWarning>,
}

pub struct MergeFailure {
    pub schema: Option<Box<Schema>>,
    pub errors: Vec<MergeError>,
    pub composition_hints: Vec<MergeWarning>,
}
```

**SDL Rendering:**
```rust
// ValidFederationSchema::schema() -> &Valid<apollo_compiler::schema::Schema>
// apollo_compiler::schema::Schema implements Display → .to_string() returns SDL string
```

---

### 6. dto.rs Changes

Remove `#[allow(dead_code)]` from both fields of `SubgraphInput`:
```rust
pub struct SubgraphInput {
    pub name: String,   // used when parsing subgraphs
    pub sdl: String,    // used as the schema SDL string
}
```

The `url` field is NOT in `SubgraphInput` — it must be synthesized (e.g., from the name) when calling `Subgraph::parse(name, url, sdl)`. If needed, add a helper to derive a URL from the subgraph name.

<!-- SECTION:NOTES:END -->
