---
id: doc-2
title: GraphQL Playground Implementation Plan
type: specification
created_date: '2026-06-06 20:07'
---


# GraphQL Playground — Implementation Plan

**Date:** 2026-06-06
**Companion to:** [the design doc](2026-06-06-graphql-playground-design.md)
**Status:** Scaffold complete; Spike 0 is the next action.

This plan turns the approved design into an ordered, executable sequence with
acceptance criteria. It assumes the scaffold already committed (flake, hooks,
crate skeleton, web skeleton).

---

## 1. What's already scaffolded

```
flake.nix                      Pinned toolchain (rust-overlay + wasm chain + node + lefthook)
.envrc                         use flake; auto-installs lefthook hooks
lefthook.yml                   pre-commit: fmt/lint/typecheck; pre-push: tests
.github/workflows/ci.yml       Runs all suites inside the flake
Cargo.toml                     Workspace + size-optimized release profile
crates/gql-core/
  Cargo.toml                   wasm-bindgen/serde; Apollo crates pinned-but-commented
  src/lib.rs                   #[wasm_bindgen] exports (thin wrappers, JSON boundary)
  src/dto.rs                   Boundary types
  src/{compose,validate,plan,mock}.rs   Stub modules returning UNIMPLEMENTED envelopes
  tests/wasm.rs                wasm-bindgen-test (Spike 0's home)
web/
  package.json, tsconfig, vite.config.ts, eslint.config.js, .prettierrc.json
  src/core/{types,index}.ts    Typed GqlCore interface + stub loader
  src/store.ts                 Zustand workspace store
  src/App.tsx, main.tsx        Placeholder three-pane shell
  src/store.test.ts            Vitest store tests
```

The scaffold compiles and tests green **without** the Apollo crates, so the
baseline is trustworthy. Spike 0 introduces the real risk in isolation.

## 2. Prerequisites & first run

```sh
direnv allow                       # or: nix develop
cargo test                         # native stub tests pass
cd web && pnpm install && pnpm test run && pnpm dev
```

The web app renders the three panes and shows the stub `UNIMPLEMENTED`
composition envelope — proving the JS↔core contract end-to-end before any
GraphQL logic exists.

## 3. The WASM API contract (the boundary)

JSON in, JSON out. This contract is stable; module internals are free to change.

| Export | Input | Output envelope |
|--------|-------|-----------------|
| `validate_subgraph(sdl)` | SDL string | `{ diagnostics: [{severity,message,line,col,len}] }` |
| `compose(subgraphs_json)` | `[{name,sdl}]` | `{ ok:true, supergraph_sdl, hints }` \| `{ ok:false, errors }` |
| `validate_query(super, op)` | strings | `{ diagnostics: [...] }` |
| `plan(super, op, op_name?)` | strings | `{ ok:true, query_plan }` \| `{ ok:false, errors }` |
| `execute_mock(super, op, vars, seed)` | strings + u64 | `{ data, errors? }` |

Rules:

- No function panics on bad input. Parse failures become error envelopes.
- The `query_plan` shape is **our** slim DTO, not Apollo's internal type.
- `execute_mock` is deterministic in `seed`.

---

## 4. Spike 0 — prove `apollo-federation` runs in the browser

**This is the make-or-break step and goes first.** Everything downstream
assumes composition works in WASM.

### Tasks

1. Uncomment `apollo-compiler = "=1.32.0"` and `apollo-federation = "=2.15.0"`
   in `crates/gql-core/Cargo.toml`.
2. Implement the real `compose::compose`: build subgraph definitions from
   `{name, sdl}`, call apollo-federation's composition entry point, and map the
   result into the `{ ok, supergraph_sdl, hints }` / `{ ok:false, errors }`
   envelope. (Consult the apollo-federation 2.15 docs/source for the current
   composition API — it has no stable public surface, so read the version you
   pinned.)
3. `cargo build` (native) — confirm it compiles at all.
4. `wasm-pack build crates/gql-core --target web` — **the real test.**
5. `wasm-pack test --headless --chrome crates/gql-core` — confirm `compose`
   runs in a browser with two hardcoded subgraphs.

### Likely failure modes & fixes

- **`getrandom` build error on wasm32** → add
  `getrandom = { version = "0.2", features = ["js"] }` (already noted in
  Cargo.toml). Audit with `cargo tree -i getrandom`.
- **A transitive dep uses threads / `std::time` / mmap** → check `cargo tree`;
  may need a feature flag or, worst case, a patched dependency.
- **`wasm-bindgen` CLI/crate version mismatch** → align the nixpkgs
  `wasm-bindgen-cli` with the crate version in `Cargo.toml`.

### Acceptance criteria

- [ ] `wasm-pack build` produces a `.wasm` artifact.
- [ ] The headless browser test composes two subgraphs and returns
      `ok:true` with a non-empty `supergraph_sdl`.
- [ ] `tests/wasm.rs` is upgraded from the smoke assertion to a real
      composition assertion.

### If Spike 0 fails

Composition can't run in the browser via native Rust. Pivot options, in order
of preference: (a) pin an older `apollo-federation` that does compile; (b) run
composition in a Web Worker with a WASM build of the JS `@apollo/composition`
(loses the "all Rust" goal); (c) reconsider a thin backend for composition only.
Decide before writing UI.

---

## 5. Milestone 1 — author & compose (the core loop)

Goal: edit real subgraphs, see live composition.

### Tasks

- **Core:** implement `validate::validate_subgraph` with apollo-compiler; map
  diagnostics to `{severity,message,line,col,len}` (verify line/col are
  1-based and match editor expectations).
- **Build:** add a `pnpm` script / Makefile target that runs
  `wasm-pack build crates/gql-core --target web --out-dir web/src/wasm`, and
  swap `web/src/core/index.ts` from the stub to the generated module.
- **Web:** replace the subgraph `<textarea>` with **Monaco** editors (one per
  subgraph tab); wire `validate_subgraph` on debounced change to show
  diagnostic underlines.
- **Web:** debounce subgraph changes → `compose(all)` → render supergraph SDL
  pane or composition-error banner.
- **Web:** "stale supergraph" behavior — on composition failure keep the last
  good supergraph, grayed with a badge (don't lock the user out).

### Acceptance criteria

- [ ] Editing a subgraph shows validation errors inline within ~300ms.
- [ ] Two valid subgraphs compose and the supergraph SDL renders.
- [ ] A composition error (e.g. key mismatch) shows a readable banner; the last
      good supergraph stays visible.
- [ ] `compose` golden tests (insta) cover ≥3 happy schemas and ≥4 known error
      classes.

## 6. Milestone 2 — query & mock-execute (the payoff)

Goal: run a query and see mocked results.

### Tasks

- **Core:** derive the API schema from the supergraph (strip `@join__*`,
  `_entities`, `_Service`); implement `validate_query` against it.
- **Core:** implement `mock::execute_mock` — the deterministic field-walker:
  - scalars/enums from a hash of `(seed, path, field)`;
  - objects/interfaces/unions recurse; abstract types hash-select a member;
  - lists fixed small length; nullability respected;
  - `@skip`/`@include` and variables honored; required fields always present.
- **Web:** add the Monaco query editor with **`monaco-graphql`**, fed the API
  schema for autocomplete + validation; variables editor; results panel.
- **Web:** Run button → `execute_mock` → render JSON; `seed` control.

### Acceptance criteria

- [ ] Query editor autocompletes against the composed schema.
- [ ] Running a query returns well-formed mock data matching the selection set.
- [ ] Same query + seed yields byte-identical results (snapshot test).
- [ ] Mock-executor unit tests cover nullability, lists, abstract types,
      `@skip`/`@include`, variables.

## 7. Milestone 3 — query plan visualizer

Goal: show how a query federates (the teaching value).

### Tasks

- **Core:** implement `plan::plan` with apollo-federation's query planner; map
  to the slim `QueryPlan` DTO (Fetch/Flatten/Sequence/Parallel nodes, subgraph
  names, selection sets).
- **Core:** add DTO round-trip tests so the JS contract can't silently break.
- **Web:** query-plan tab rendering the plan as a tree, updating on Run.

### Acceptance criteria

- [ ] A multi-subgraph query shows a plan with the expected fetch nodes and
      subgraph attribution.
- [ ] The plan view is independent of execution (renders even if execution is
      disabled).

## 8. Milestone 4 — persistence & sharing

Goal: shippable polish.

### Tasks

- **Web:** serialize workspace → gzip → base64 in the URL hash; restore on load.
- **Web:** localStorage autosave of the working session.
- **Web:** verify a shared URL reproduces identical results (seed-deterministic).

### Acceptance criteria

- [ ] Round-trip test: serialize → URL → restore → deep-equal.
- [ ] Opening a shared URL on a clean browser reproduces the same mock output.

## 9. Deferred (milestone 5+)

Explicitly **not** in the first release (YAGNI):

- Per-type example-data overrides for richer mock control.
- Custom scalar override hooks.
- Schema import/export (files, introspection JSON).
- Examples gallery / templates.
- `crane` flake build outputs for reproducible artifact builds.
- Opaque compiled-schema handles across the boundary (only if profiling shows
  recomposition cost matters).

---

## 10. Testing strategy (per layer)

- **Rust native (`cargo test`):** compose golden tests (insta), validate
  position tests, mock-executor determinism snapshots, DTO round-trips. Fast;
  runs in `pre-push` and CI.
- **WASM (`wasm-pack test --headless --chrome`):** one call per export
  asserting envelope shape; catches wasm-only failures. **CI only.**
- **JS (Vitest + Playwright):** store reducer + URL round-trip; one e2e smoke
  test (two subgraphs → compose → query → results).

## 11. CI

`.github/workflows/ci.yml` runs every suite inside `nix develop`, so tool
versions match local git hooks exactly — a hook that passes locally cannot fail
CI on a version skew.

## 12. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `apollo-federation` won't compile to wasm32 | Medium | Critical | Spike 0 first; pivot options documented |
| apollo-federation API breaks on upgrade (no semver) | High over time | Medium | Exact version pin; golden tests catch regressions; upgrades are deliberate |
| `wasm-bindgen` CLI/crate skew | Medium | Low | Both pinned via flake |
| Mock data feels unrealistic | Medium | Low | Deferred example-data overrides (m5) |
| WASM bundle too large | Low | Medium | `wasm-opt -Oz`, lazy-load, size profile already set |

## 13. Definition of done (v1)

A user can, entirely in the browser with no backend: author ≥2 federated
subgraphs with live validation, compose them into a visible supergraph, run a
query with autocomplete against mocked deterministic data, inspect the query
plan, and share the whole workspace via URL.
