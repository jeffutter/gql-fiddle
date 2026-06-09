---
id: TASK-14
title: Derive the API schema from the supergraph
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-09 22:52'
labels: []
milestone: m-2
dependencies:
  - TASK-2
  - TASK-28
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Queries run against the client-facing "API schema" (the supergraph with federation internals removed). Add an internal helper that returns it, because validate_query, execute_mock, and plan all need it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A pub(crate) helper returns the API schema for a composed supergraph
- [x] #2 A test confirms the API schema excludes @join__, _entities, _Service and includes a user-defined type
- [x] #3 nix develop -c cargo build and cargo test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run `direnv allow` once, or prefix every command with `nix develop -c`. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Create a new file `crates/gql-core/src/api_schema.rs`. Add it to the module list in `lib.rs` (add `mod api_schema;`). At the top of `api_schema.rs`, import the required types: `use apollo_federation::{ApiSchemaOptions, Supergraph};`

2. Write a function with this exact signature:
   ```rust
   /// Derive the client-facing API schema from a composed supergraph SDL.
   ///
   /// Returns an SDL string -- matches the existing WASM boundary (all consumer
   /// modules accept `&str` SDL) and avoids round-tripping through compiler types.
   pub(crate) fn derive_api_schema(supergraph_sdl: &str) -> Result<String, apollo_federation::error::FederationError> {
       let supergraph = Supergraph::new(supergraph_sdl)?;
       let api_schema = supergraph.to_api_schema(ApiSchemaOptions::default())?;
       Ok(api_schema.schema().print())
   }
   ```
   Notes:
   - `Supergraph::new()` parses and validates the SDL as a supergraph (expects join spec v0.3 directives).
   - `.to_api_schema(ApiSchemaOptions::default())` strips federation internals: `@join__*` directives, `_Entity`, `_Service`, `_Any`, `join__Graph`, inaccessible types, and defer/stream directive definitions.
   - `.schema().print()` renders the result back as an SDL string.
   - `FederationError` is a distinct type from composition's `CompositionFailure` -- do not conflate them.

3. Verify `pub(crate)` visibility (it is on the function above). This is sufficient for `validate.rs`, `mock.rs`, and `plan.rs` to call it via `crate::api_schema::derive_api_schema(...)` in their follow-up tasks.

4. Add a unit test inside `#[cfg(test)] mod tests` in `api_schema.rs`. Use the same two subgraphs from `compose.rs` tests (the "products" + "reviews" pair that shares a `User` entity). The test steps:
   a. Call `compose(&[products, reviews])` to get a supergraph SDL string.
   b. Pass that SDL to `derive_api_schema()` and assert it `Ok`s.
   c. On the returned SDL string, assert with `!contains` that it does NOT contain `"@join__"`, `"_entities"`, or `"_Service"`.
   d. Assert with `contains` that it DOES contain `"User"` (a user-defined type from the subgraphs).
   Example assertion structure:
   ```rust
   #[test]
   fn api_schema_excludes_federation_internals_and_keeps_user_types() {
       // ... compose, derive, get sdl ...
       assert!(!sdl.contains("@join__"), "should not contain @join__ directives");
       assert!(!sdl.contains("_entities"), "should not contain _entities");
       assert!(!sdl.contains("_Service"), "should not contain _Service");
       assert!(sdl.contains("User"), "should contain user-defined type User");
   }
   ```

5. Build and test: `nix develop -c cargo test -p gql-core`
   Expected outcome: all existing compose.rs tests pass plus the new api_schema test passes.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added api_schema.rs with derive_api_schema(supergraph_sdl) that parses a supergraph SDL, strips federation internals (@join__ directives, _entities, _Service, inaccessible types), and returns the clean client-facing API schema as an SDL string. Uses apollo-federation's Supergraph::new() + to_api_schema() pipeline. Single integration test composes products+reviews subgraphs and verifies federation artifacts are removed while user-defined types (User) are retained. All quality gates pass: 22 Rust tests, fmt, clippy, 38 web tests, tsc, eslint.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: Derive the API schema from a composed supergraph

## Summary
The `apollo-federation` crate 2.15.0 exposes a public `Supergraph::to_api_schema()` method that strips federation internals (`@join__`, `_entities`, `_Service`, inaccessible types) from a supergraph and returns an `ValidFederationSchema`. The recommended approach is to take the supergraph SDL string from the existing `compose()` result, parse it into a `Supergraph` via `Supergraph::new()`, call `.to_api_schema(ApiSchemaOptions::default())`, then render the result as SDL using `schema.print()`.

## Findings

### 1. Two composition paths exist; pick the one that gives you a `Supergraph`
The current `compose.rs` uses `apollo_federation::composition::compose()` which returns `Result<ValidFederationSchema, CompositionFailure>` — a `ValidFederationSchema`, not a `Supergraph`. There are two ways to get an API schema:

**Approach A (recommended): Parse SDL into `Supergraph`, then call `.to_api_schema()`**
- Take the supergraph SDL string from the existing composition result.
- Parse it: `Supergraph::new(&sdl)` → `Result<Supergraph, FederationError>`.
- Derive API schema: `supergraph.to_api_schema(ApiSchemaOptions::default())` → `Result<ValidFederationSchema, FederationError>`.

**Approach B (alternative): Use composition's `ValidFederationSchema` directly**
- The `fed_compose()` result already gives you a `ValidFederationSchema`. However, the `api_schema` module is **private** (`mod api_schema;` without `pub`), so there is no public function to convert a bare `ValidFederationSchema` into an API schema. Approach B would require re-parsing through `Supergraph::new()` anyway.

[Source: apollo-federation v2.15.0 lib.rs source](https://github.com/apollographql/router/blob/v2.15.0/apollo-federation/src/lib.rs)

### 2. Exact API signatures (from docs + source)

**`Supergraph::new` — parse supergraph SDL into a typed supergraph**
```rust
pub fn new(schema_str: &str) -> Result<Self, FederationError>
```
Parses and validates the schema string as a supergraph (checks for required join spec directives).

[Source: apollo-federation v2.15.0 lib.rs](https://github.com/apollographql/router/blob/v2.15.0/apollo-federation/src/lib.rs)

**`Supergraph::to_api_schema` — strip federation internals**
```rust
pub fn to_api_schema(
    &self,
    options: ApiSchemaOptions,
) -> Result<ValidFederationSchema, FederationError>
```
Generates the API schema that represents the combined user-facing API, stripping join spec machinery, inaccessible elements, and core feature types (`@join__*`, `_Entity`, `_Service`, `join__Graph`, etc.).

[Source: apollo-federation v2.15.0 lib.rs](https://github.com/apollographql/router/blob/v2.15.0/apollo-federation/src/lib.rs)

**`ApiSchemaOptions` — configuration for API schema generation**
```rust
pub struct ApiSchemaOptions {
    pub include_defer: bool,
    pub include_stream: bool,
}
```
Default (`ApiSchemaOptions::default()`) sets both to `false`. For this task, default is fine.

[Source: apollo-federation v2.15.0 api_schema.rs](https://github.com/apollographql/router/blob/2a1492f244ce3d6eba0f34e0584925d1f6e8385b/apollo-federation/src/api_schema.rs)

**`ValidFederationSchema::schema().print()` — render as SDL string**
```rust
// ValidFederationSchema has:
pub fn schema(&self) -> &Valid<Schema>

// apollo_compiler::schema::Valid<Schema>:
pub fn print(&self) -> String
```
The `print()` method renders the entire schema as an SDL string. This is the simplest way to get a string representation for assertions and WASM boundary communication.

[Source: apollo-compiler docs](https://docs.rs/apollo-compiler/latest/apollo_compiler/schema/struct.Valid.html)

### 3. What gets stripped (the "federation internals")
The `to_api_schema()` function performs these steps internally ([source](https://github.com/apollographql/router/blob/2a1492f244ce3d6eba0f34e0584925d1f6e8385b/apollo-federation/src/api_schema.rs)):

1. Removes explicit `@defer` and `@stream` directive definitions (they're merged artifacts from subgraphs).
2. Validates and removes `@inaccessible` elements (types, fields, values marked inaccessible).
3. Removes "core feature elements" — all types and directives imported via `@link` (this includes `join__Graph`, `join__type`, `join__field`, `join__implements`, `join__graph`, `link__Purpose`, `_Entity`, `_Service`, `_Any`, etc.).

The result is a clean schema containing only user-defined types and standard GraphQL built-ins.

### 4. Return type recommendation: `String` (SDL)
Return the API schema as an **SDL string** (`String`). Rationale:
- The existing WASM boundary already works with SDL strings for supergraph input/output.
- Other modules (`validate_query`, `execute_mock`, `plan`) all accept `supergraph_sdl: &str`.
- An `apollo_compiler::Schema` or `ValidFederationSchema` return type would force callers to parse it again, adding unnecessary complexity and WASM serialization overhead.
- A single-line comment can document the choice.

### 5. Test strategy for AC #2
The unit test should:
1. Compose two subgraphs (reuse the existing "products" + "reviews" subgraph pair from `compose.rs` tests).
2. Take the resulting supergraph SDL string.
3. Call `Supergraph::new(&sdl)` then `.to_api_schema(ApiSchemaOptions::default())`.
4. Render with `.schema().print()`.
5. Assert:
   - Output does **NOT** contain `"@join__"` or `"_entities"` or `"_Service"`.
   - Output **DOES** contain a user-defined type like `"User"` (from the subgraphs).

## Tradeoffs

| Aspect | SDL string return | `ValidFederationSchema` return |
|--------|-------------------|-------------------------------|
| Caller convenience | Zero — already have SDL | Callers must parse again |
| WASM serialization | Simple string pass-through | Requires serde impl on compiler types (not available) |
| Testability | String contains/excludes checks are trivial | Need to iterate types for assertions |
| Future-proofing | Tied to SDL format, but stable | Tied to apollo-compiler API surface |

**Verdict**: SDL string is the pragmatic choice.

## Gotchas

1. **`api_schema` module is private** — there is no `use apollo_federation::api_schema::to_api_schema(...)`. You must go through `Supergraph::to_api_schema()`.

2. **`FederationError` vs `CompositionFailure`** — the composition step returns `CompositionFailure`, while `to_api_schema()` returns `FederationError`. These are different error types; handle them separately in your wrapper function.

3. **Thread-safety** — `Supergraph` asserts `Send + Sync` in its source (`assert_thread_safe::<Supergraph>();`), so it's safe to hold across await points if needed.

4. **`ApiSchemaOptions::default()`** includes both `include_defer: false` and `include_stream: false`. If the playground later needs defer/stream support, set them to `true`.

5. **Federation 2 join spec v0.3** — the test subgraphs use `@link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)`. This is compatible with apollo-federation 2.15.0.

## Recommended implementation outline

```rust
// api_schema.rs in gql-core/src/
use apollo_federation::schema::ValidFederationSchema;
use apollo_federation::{ApiSchemaOptions, Supergraph};
use apollo_federation::error::FederationError;

/// Derive the client-facing API schema from a composed supergraph SDL.
/// Returns SDL string — chosen because it matches the existing WASM boundary
/// (all other modules accept `&str` SDL) and avoids re-parsing overhead.
pub fn derive_api_schema(supergraph_sdl: &str) -> Result<String, FederationError> {
    let supergraph = Supergraph::new(supergraph_sdl)?;
    let api_schema = supergraph.to_api_schema(ApiSchemaOptions::default())?;
    Ok(api_schema.schema().print())
}
```

Then in `lib.rs`, register the module: `mod api_schema;` and export it as needed.

## Sources

**Kept:**
- [apollo-federation v2.15.0 lib.rs source (Supergraph struct + to_api_schema)](https://github.com/apollographql/router/blob/v2.15.0/apollo-federation/src/lib.rs) — Primary source for exact API signatures on `Supergraph::new()` and `Supergraph::to_api_schema()`.
- [apollo-federation v2.15.0 api_schema.rs (internal implementation)](https://github.com/apollographql/router/blob/2a1492f244ce3d6eba0f34e0584925d1f6e8385b/apollo-federation/src/api_schema.rs) — Documents exactly what `to_api_schema()` strips (inaccessible, core features, defer/stream).
- [apollo-compiler Schema docs](https://docs.rs/apollo-compiler/latest/apollo_compiler/schema/struct.Valid.html) — Confirms `print()` method for SDL rendering.
- [Federated Schemas: API schema vs supergraph schema (Apollo docs)](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/schema-types) — Conceptual reference for what an API schema is.

**Dropped:**
- [graphql-federated-graph crate](https://docs.rs/graphql-federated-graph/latest/graphql_federated_graph/) — Has `render_api_sdl()` but requires a `FederatedGraph` type; not relevant since the project uses `apollo-federation` directly and composition already produces a `ValidFederationSchema`.
- [Apollo Router PR #4931 (Rust-based API schema generation)](https://github.com/apollographql/router/pull/4931) — Historical context only; the feature is now GA in 2.15.0.

## Gaps

1. **`ValidFederationSchema::schema()` return type** — The docs.rs pages for `apollo-federation` 2.15.0 didn't fully render, so I couldn't confirm whether `schema()` returns `&Valid<Schema>` or `Valid<Schema>`. The source code strongly suggests a reference (`&self`), but the developer should verify.

2. **Exact error type from `Supergraph::new()`** — It returns `FederationError`, which is an enum with many variants. The test may need to handle specific error cases (e.g., invalid supergraph format). This is low-risk since the test subgraphs are known-good.

3. **SDL output ordering** — The `print()` method's output order isn't guaranteed to be deterministic across apollo-compiler versions. For assertions, use `contains`/`!contains` checks rather than exact string equality.

Suggested next steps: Verify that `api_schema::to_api_schema()` is indeed private (not re-exported) in the pinned 2.15.0 version, and confirm `ValidFederationSchema::schema().print()` compiles against the apollo-compiler version pinned in Cargo.toml (=1.32.0).

<!-- SECTION:NOTES:END -->
