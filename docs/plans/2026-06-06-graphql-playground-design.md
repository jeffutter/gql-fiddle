# GraphQL Playground — Design

**Date:** 2026-06-06
**Status:** Approved design, pre-implementation

## Summary

A browser-based GraphQL playground with **no backend**. Users author multiple
federated subgraph schemas, compose them into a supergraph, inspect the query
plan, and run queries against **mocked** (synthetic) data — all client-side.

The GraphQL brain is Rust compiled to WebAssembly (Apollo's `apollo-compiler`
and `apollo-federation`); the UI is a TypeScript/React shell wrapping it.

## Key decisions

- **Execution model: mock execution in WASM.** No real data, no network. The
  best teaching/design tool, fully offline, no CORS.
- **No federated *execution*.** Because everything is mocked, there is no value
  in executing the query plan across mocked subgraphs. We compose to a
  supergraph, derive the client-facing API schema, and mock-execute the query
  against that single schema. The query plan is computed and *displayed* for
  educational value but is fully decoupled from execution.
- **UI architecture: JS/TS shell + Rust/WASM core.** Mature GraphQL editor
  tooling (`monaco-graphql`) lives in JS; Rust owns all GraphQL semantics.
- **MVP scope: federation from day one.** The riskiest dependency
  (`apollo-federation` in WASM) is therefore a milestone-0 spike.
- **Toolchain pinned with Nix (flake + `rust-overlay`), enforced with Lefthook,
  verified in CI.**

## Critical dependency note

- `apollo-compiler` — pure Rust parse/validate/semantic analysis. Compiles to
  `wasm32` cleanly.
- `apollo-federation` — native Rust composition + query planning
  ([Apollo Federation Goes Full Rust](https://www.apollographql.com/blog/apollo-federation-goes-full-rust)).
  This is what makes browser-side composition possible. **Caveat:** Apollo
  labels it internal to the Router, *not intended for direct use*, with **no
  semver guarantees**. We pin an exact version and treat upgrades as deliberate,
  tested events.
- `harmonizer` — runs JS `@apollo/composition` inside embedded V8 via
  `deno_core`. **Cannot run in the browser.** Native `apollo-federation` is the
  only WASM path for composition.

---

## 1. High-level architecture

Three layers with a hard JS/Rust boundary:

```
JS/TS shell  (React + Vite)
  - Subgraph tabs (N Monaco editors, each = one subgraph)
  - Supergraph SDL viewer (read-only)
  - Query editor + variables + results panel
  - Query-plan visualizer (tree view)
  - Persistence: localStorage / shareable URL
        |  wasm-bindgen boundary (JSON in / JSON out)
Rust WASM core  (one crate, cdylib)
  - validate_subgraph(sdl)      -> diagnostics
  - compose(subgraphs[])        -> supergraph SDL | errors
  - validate_query(super, op)   -> diagnostics
  - plan(super, op, vars)       -> query plan (JSON, view-only)
  - execute_mock(super, op, ..) -> {data, errors}
        |  depends on
apollo-compiler (parse/validate)
apollo-federation (compose + query plan)
+ our mock-execution engine
```

**Principles:**

- The WASM boundary speaks **JSON strings**, not rich types — keeps
  `wasm-bindgen` simple and the API stable even as `apollo-federation`'s
  internal types churn.
- Rust owns *all* GraphQL semantics. JS only parses GraphQL for editor
  highlighting (`monaco-graphql`).
- Everything is **pure and synchronous** — no async, no network. Deterministic
  and offline.

## 2. The WASM core API

A single `cdylib` crate. All inputs/outputs are JSON strings.

```rust
#[wasm_bindgen]
pub fn validate_subgraph(sdl: &str) -> String;
//   -> { diagnostics: [{severity, message, line, col, len}] }

#[wasm_bindgen]
pub fn compose(subgraphs_json: &str) -> String;
//   in:  [{ name, sdl }, ...]
//   -> { ok: true, supergraph_sdl, hints: [...] }
//   -> { ok: false, errors: [{code, message, locations}] }

#[wasm_bindgen]
pub fn validate_query(supergraph_sdl: &str, operation: &str) -> String;
//   -> { diagnostics: [...] }   // against the API schema

#[wasm_bindgen]
pub fn plan(supergraph_sdl: &str, operation: &str, op_name: Option<String>) -> String;
//   -> { ok: true, query_plan: <slim QueryPlan DTO> } | { ok: false, errors }

#[wasm_bindgen]
pub fn execute_mock(supergraph_sdl: &str, operation: &str,
                    variables_json: &str, seed: u64) -> String;
//   -> { data, errors }
```

**Decisions:**

- **Stateless calls, recomputed on demand.** Composition of a few subgraphs is
  cheap. Add an opaque compiled-schema handle later only if profiling demands
  it (YAGNI now).
- **Errors are values, not panics.** Every function returns a result envelope;
  `console_error_panic_hook` is a last-resort net only. A malformed schema is a
  *normal* outcome.
- **`seed` makes mock execution deterministic** — same schema + query + seed =
  same data. Enables shareable URLs and golden-file tests.
- **`plan` is exposed separately from `execute_mock`** — the visualizer wants
  the plan without running anything, and showing the plan is half the value.
- **Slim `QueryPlan` DTO owned by us.** `apollo-federation`'s `QueryPlan` has no
  stable serialization; we map into our own stable shape so the JS visualizer
  doesn't depend on Apollo internals.

## 3. The mock-execution engine

Because execution is decoupled from federation, this is a **plain single-schema
GraphQL mock executor**, not a plan interpreter.

Flow:

1. `compose(subgraphs)` -> supergraph SDL (the only place federation runs).
2. Derive the **API schema** from the supergraph (strip `@join__*`,
   `_entities`, `_Service`, etc. — `apollo-federation` provides this).
3. `execute_mock` walks the query AST against the API schema and generates
   deterministic values per field.

Mock value strategy:

- Scalars/enums -> deterministic hash of `(seed, path, fieldName)`.
- Objects/interfaces/unions -> recurse; pick a concrete type for abstract types
  via hash.
- Lists -> fixed small length (e.g. 3).
- Nullability respected; `@skip`/`@include` and variables honored.
- `@key`/required fields always present.

**Deferred escape hatch:** per-type example-data JSON to override generated
values. Powerful but YAGNI for milestone 1.

## 4. UI/UX layout & data flow

Three-pane resizable workspace:

```
SUBGRAPHS              | SUPERGRAPH
[products][users][+]   | [ Supergraph SDL | Query Plan ]
  (Monaco editors,     |   (read-only)      (tree, per query)
   live validation)    | Composition: 0 errors, 2 hints
-----------------------------------------------------------
QUERY        | VARIABLES |  RESULTS
query {...}  | { }       |  { "data": {...} }
 Run  seed:42|           |
```

**Data flow (synchronous, debounced):**

1. Edit a subgraph -> debounce ~300ms -> `validate_subgraph` -> underline
   diagnostics in that editor.
2. Any subgraph changes -> `compose(all)` -> update supergraph SDL pane + feed
   API schema to `monaco-graphql` (query autocomplete/validation for free), or
   show composition errors in a banner.
3. Edit query -> `monaco-graphql` validates against the API schema (instant);
   on Run -> `plan()` updates the plan view and `execute_mock()` fills results.

**State:** one store (Zustand) holding
`{ subgraphs[], supergraphSdl, apiSchema, query, variables, seed }`. Composition
output is *derived* state, never hand-edited.

**Persistence & sharing:** serialize workspace -> gzip -> base64 in the URL
hash. Seed-deterministic mock data means a shared URL reproduces identical
results. localStorage autosaves the session. No accounts, no backend.

**UX decision — composition failure:** keep the last successful supergraph
active (grayed, "stale" badge) so the user isn't locked out mid-edit, rather
than hard-disabling the query pane.

## 5. Project structure & build tooling

```
graphql-playground/
  crates/
    gql-core/                # WASM crate (cdylib)
      src/
        lib.rs               # #[wasm_bindgen] entry points (thin)
        compose.rs           # apollo-federation wrapper
        validate.rs          # apollo-compiler wrapper
        plan.rs              # query plan -> slim DTO
        mock.rs              # deterministic field-walker
        dto.rs               # serde types = the JSON boundary
      Cargo.toml             # pin EXACT apollo-federation version
  web/                       # Vite + React + TS
    src/
      core/                  # typed wrapper around the wasm module
      editors/               # Monaco + monaco-graphql wiring
      panes/                 # subgraph / supergraph / plan / query
      store.ts               # Zustand state
      share.ts               # URL gzip/base64 serialization
  docs/plans/
  flake.nix
  lefthook.yml
  .envrc
```

**Build toolchain:**

- `wasm-pack build --target web` (or `wasm-bindgen` + `vite-plugin-wasm`)
  produces an ES module + `.d.ts` so the TS side is fully typed across the
  boundary.
- Pin **exact** `apollo-federation` version (`=x.y.z`).
- `wasm-opt` in release for size; lazy-load the `.wasm`.

### 5a. Nix flake (toolchain)

`flake.nix` provides a `devShell` using `rust-overlay`. Nix specifically solves
the **`wasm-bindgen-cli` must version-match the `wasm-bindgen` crate** footgun
by pinning both from one source.

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, rust-overlay, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };
        rust = pkgs.rust-bin.stable.latest.default.override {
          targets = [ "wasm32-unknown-unknown" ];
        };
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            rust
            pkgs.wasm-pack
            pkgs.wasm-bindgen-cli   # pin to match the crate version
            pkgs.binaryen           # wasm-opt
            pkgs.nodejs_22
            pkgs.nodePackages.pnpm
            pkgs.lefthook
          ];
        };
      });
}
```

Decisions:

- **Toolchain source:** `rust-overlay` — Rust version + `wasm32` target pinned
  in-flake, not via `rustup`.
- **Version-match trap:** `wasm-bindgen-cli` (nixpkgs) and `wasm-bindgen`
  (`Cargo.toml`) must agree. If nixpkgs lags, override the package version.
- **`.envrc` with `use flake`** for `direnv` auto-activation; also runs
  `lefthook install` after `use flake` so hooks wire up automatically.
- **Reproducible build outputs (deferred):** add `crane` for CI later. The
  devShell alone is enough to start.
- Node deps stay in the `pnpm` lockfile — Nix pins the *tools*, not every npm
  package.

### 5b. Git hooks (Lefthook)

`pre-commit` is fast (staged files only); `pre-push` runs full test suites.

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    rust-fmt:
      glob: "*.rs"
      run: cargo fmt --check
    rust-clippy:
      glob: "*.rs"
      run: cargo clippy --all-targets -- -D warnings
    web-format:
      glob: "web/**/*.{ts,tsx,css,json}"
      run: pnpm -C web prettier --check {staged_files}
    web-lint:
      glob: "web/**/*.{ts,tsx}"
      run: pnpm -C web eslint {staged_files}
    web-typecheck:
      glob: "web/**/*.{ts,tsx}"
      run: pnpm -C web tsc --noEmit

pre-push:
  parallel: true
  commands:
    rust-test:
      run: cargo test
    web-test:
      run: pnpm -C web test run
```

Decisions:

- **`pre-commit`** = formatting + linting + typecheck (seconds).
  **`pre-push`** = tests.
- **WASM integration tests (headless Chrome) run in CI only** — too slow / need
  a browser.
- **Lefthook installed via the flake**, wired up from `.envrc`.
- **Same tool versions as CI** because both run inside the flake — a hook that
  passes locally cannot fail in CI on a version difference.

Toolchain trio: **Nix pins it, Lefthook enforces it, CI verifies it.**

## 6. Milestones (risk front-loaded)

| # | Milestone | Proves |
|---|-----------|--------|
| 0 | **Spike:** `apollo-federation` compiles to `wasm32` and composes two hardcoded subgraphs in a browser console. | The make-or-break unknown. |
| 1 | Two subgraph editors -> live compose -> supergraph SDL pane + composition errors. | Core loop. |
| 2 | Query editor with `monaco-graphql` autocomplete from API schema + mock execution -> results. | The "query it" payoff. |
| 3 | Query-plan visualizer tab. | Federation teaching value. |
| 4 | Persistence + shareable URLs. | Shipping polish. |
| 5 | Deferred: per-type example data, custom scalars, schema import/export, examples gallery. | Nice-to-haves. |

**Spike 0 is non-negotiable and goes first.** If `apollo-federation` won't
compile to WASM (usual culprit: a transitive dep using threads, time, or
`getrandom` without the JS feature), the approach must pivot — and we want to
know in week one. Common fix: enable `getrandom`'s `wasm_js` feature; audit with
`cargo tree`.

## 7. Testing strategy

Determinism (the `seed`) is what makes the hard parts testable.

**Rust core (native `cargo test`, fast):**

- **`compose` golden tests** — fixture subgraph SDLs -> snapshot supergraph SDL
  (`insta`). Cover happy path *and* known composition errors (key mismatches,
  type conflicts, missing `@shareable`) -> assert error codes/messages. This is
  the regression net when bumping `apollo-federation`.
- **`validate` tests** — assert diagnostic positions (line/col); editor
  underlines depend on accurate spans.
- **Mock-executor tests** — same `(schema, query, seed)` -> byte-identical JSON.
  Snapshot. Cover nullability, lists, abstract-type selection, `@skip`/
  `@include`, variables, required fields.
- **DTO round-trip tests** — serialize/deserialize every boundary type.

**WASM boundary (`wasm-bindgen-test`, headless Chrome):**

- Small suite calling each export once with a real fixture, asserting envelope
  shape. Catches WASM-only failures (the `getrandom`/threads/time class).
- **Spike 0's permanent home** — it graduates into the first WASM integration
  test.

**JS shell (Vitest + Testing Library, light):**

- Store reducer tests; URL share/restore round-trip (serialize -> URL ->
  restore -> deep-equal).
- One Playwright smoke test: load -> type two subgraphs -> see composed SDL ->
  run query -> see results.

**Not tested:** Monaco internals, `apollo-federation`'s own correctness (we test
*our wrapping and error mapping*), exhaustive data-shape generation (snapshots
cover it).

**CI:** `nix develop -c` runs all three suites in one flake-pinned environment.
