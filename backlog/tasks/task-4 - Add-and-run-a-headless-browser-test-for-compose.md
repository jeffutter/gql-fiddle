---
id: TASK-4
title: Add and run a headless-browser test for compose()
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 07:48'
labels: []
milestone: m-0
dependencies:
  - TASK-3
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prove composition runs in a real browser, not just that it compiles. Graduates the placeholder wasm test into a real one. Final acceptance of Spike 0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tests/wasm.rs composes two real subgraphs via the exported compose() and asserts ok:true plus a token from the SDL
- [x] #2 nix develop -c wasm-pack test --headless --chrome crates/gql-core passes
- [x] #3 The old placeholder assertion is replaced
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/tests/wasm.rs. It currently contains a single placeholder test that calls compose with an empty array and asserts the result contains "ok".

2. Replace the entire file contents with the following (only this file is changed — no source code, Cargo.toml, flake, or config edits needed):
```rust
//! Browser integration tests, run with `wasm-pack test --headless --chrome`.
//!
//! This is Spike 0's permanent home: it proves the crate not only compiles to
//! wasm32 but that the exports actually run in a real browser. Gated to wasm so
//! native `cargo test` skips it.
#![cfg(target_arch = "wasm32")]

use gql_core::compose;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn compose_two_valid_subgraphs_returns_ok_and_sdl() {
    // Two subgraphs sharing a User entity — same pair used in native tests
    // (crates/gql-core/src/compose.rs). Products defines the @key; reviews
    // extends it with @external.
    let subgraphs_json = r#"[
        {
            "name": "products",
            "sdl": "extend schema @link(url: \"https://specs.apollo.dev/federation/v2.3\", import: [\"@key\"]) @link(url: \"https://specs.apollo.dev/join/v0.3\", for: EXECUTION) { query: Query } type Query { me: User } type User @key(fields: \"id\") { id: ID! }"
        },
        {
            "name": "reviews",
            "sdl": "extend schema @link(url: \"https://specs.apollo.dev/federation/v2.3\", import: [\"@key\", \"@external\"]) @link(url: \"https://specs.apollo.dev/join/v0.3\", for: EXECUTION) { query: Query } type Query { mostRecentReview: Review } type Review { id: ID! body: String product: Product } type Product @key(fields: \"id\") { id: ID! reviews: [Review] } extend type User @key(fields: \"id\") { id: ID! @external reviews: [Review] }"
        }
    ]"#;

    let result = compose(subgraphs_json);

    // AC #1 — assert ok:true is present
    assert!(
        result.contains("\"ok\":true"),
        "expected ok:true in composition result, got: {}",
        result
    );

    // AC #1 — assert a token from the composed SDL (both subgraphs define Query)
    assert!(
        result.contains("type Query"),
        "expected composed supergraph SDL to contain 'type Query', got: {}",
        result
    );
}
```

3. Verify the file compiles within the Nix shell:
   ```
   nix develop -c cargo check --target wasm32-unknown-unknown -p gql-core
   ```

4. Run the browser test:
   ```
   nix develop -c wasm-pack test --headless --chrome crates/gql-core
   ```
   The first run auto-downloads chromedriver to `~/.cache/.wasm-pack/`. After that it is cached.

5. If step 4 fails with "failed to spawn chromedriver" or "No such file or directory": Chrome is not on your PATH. Fix by either:
   a. Installing google-chrome or chromium-browser on your system (e.g. `nix profile install nixpkgs#google-chrome`), OR
   b. Adding the browser binary to the flake's `buildInputs` in `flake.nix`, then re-entering the dev shell.
   The Nix dev shell provides chromedriver via wasm-pack auto-download, but it needs an actual Chrome/Chromium binary on PATH to drive.

6. Confirm exactly one test runs and passes. The old placeholder assertion is replaced by step 2 (satisfies AC #3).
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the placeholder wasm test with a real headless browser test that composes two subgraphs (products + reviews) sharing a User entity via the exported compose() function. The test asserts ok:true in the response and verifies 'type Query' appears in the composed SDL. Verified passing: cargo fmt check, wasm32 compilation, wasm-pack headless Chrome test (1 passed), TypeScript check, and web vitest suite. Completes Spike 0 acceptance.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### Context
The existing `tests/wasm.rs` contains a single placeholder test (`compose_returns_a_json_envelope`) that calls `compose("[]")` and does a weak assertion (`out.contains("ok")`). TASK-4 requires replacing this with a **real composition test** that proves the WASM export works end-to-end in a browser.

### Key Unknowns Researched

#### 1. The `compose` WASM export signature
From `src/lib.rs`, the exported function is:
```rust
#[wasm_bindgen]
pub fn compose(subgraphs_json: &str) -> String
```
It takes a **JSON string** of `[{"name": "...", "sdl": "..."}]` and returns a **JSON string**. The wasm-bindgen-generated JS binding accepts `&str` → `String`, which maps directly in the browser test.

#### 2. `wasm-bindgen-test` assertion capabilities
The crate does **not** provide custom assertion macros. It uses standard Rust assertions (`assert!`, `assert_eq!`, etc.) compiled to wasm32. For string content checks:
- `str::contains(&str)` — fully supported on wasm32, works identically to native Rust
- No special test crate needed beyond `wasm_bindgen_test::*`

#### 3. Valid subgraph SDL for the test
The existing unit tests in `compose.rs` already contain two valid, composing subgraphs (products + reviews sharing a `User` entity). These can be reused verbatim as the JSON payload. The composed supergraph will definitely contain `"type Query"` since both subgraphs define a root query type.

### Recommended Approach

**Replace the entire contents of `tests/wasm.rs` with:**

```rust
#![cfg(target_arch = "wasm32")]

use gql_core::compose;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn compose_two_valid_subgraphs_returns_ok_and_sdl() {
    let subgraphs_json = r#"[
        {
            "name": "products",
            "sdl": "extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION) { query: Query } type Query { me: User } type User @key(fields: "id") { id: ID! }"
        },
        {
            "name": "reviews",
            "sdl": "extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"]) @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION) { query: Query } type Query { mostRecentReview: Review } type Review { id: ID! body: String product: Product } type Product @key(fields: "id") { id: ID! reviews: [Review] } extend type User @key(fields: "id") { id: ID! @external reviews: [Review] }"
        }
    ]"#;

    let result = compose(subgraphs_json);

    // AC #1: assert ok:true AND a token from the SDL
    assert!(
        result.contains(""ok":true"),
        "expected ok:true in composition result, got: {}",
        result
    );
    assert!(
        result.contains("type Query"),
        "expected composed SDL to contain 'type Query', got: {}",
        result
    );
}
```

### Tradeoffs Considered

| Option | Pros | Cons |
|--------|------|------|
| Inline JSON strings in test (recommended) | Self-contained, no external fixtures, minimal deps | Long SDL strings need escaped quotes; harder to read |
| Separate `.sdl` fixture files | Cleaner reading | Requires `include_str!`, adds file management |
| Two separate tests (one per subgraph validity check) | Isolated failure signals | Overkill for a Spike 0 smoke test |

**Chosen: inline JSON.** The acceptance criteria call for a single test. The two subgraphs from the existing unit tests are small and well-understood.

### Gotchas
1. **`wasm-bindgen-test` requires `#![cfg(target_arch = "wasm32")]`** — already present in the file; do not remove it or native `cargo test` will try to run these tests.
2. **Quotes in JSON strings**: The SDL contains `@link(url: "...")` with double quotes. In Rust raw strings (`r#"..."#`), these must be escaped as `"`. Alternatively, use `concat!()` or a helper function to avoid escaping hell.
3. **Chrome vs Node.js**: The existing test configures `run_in_browser` which uses Chrome (headless). If Chrome is missing from the Nix shell, the test will fail — but the task spec says Chrome is provided by the Nix shell. Verify with `nix develop -c which chrome` or `chromium`.
4. **No `async` needed**: The `compose` function is synchronous; `wasm-bindgen-test` supports async tests but they're unnecessary here.

### Exact API Signatures

| API | Signature | Source |
|-----|-----------|--------|
| `gql_core::compose` | `pub fn compose(subgraphs_json: &str) -> String` (wasm_bindgen exported) | `src/lib.rs:40-56` |
| `SubgraphInput` | `struct { pub name: String, pub sdl: String }` (serde Deserialize) | `src/dto.rs` |
| `compose::compose` (internal) | `pub fn compose(subgraphs: &[SubgraphInput]) -> serde_json::Value` | `src/compose.rs:17-56` |
| `apollo_federation::composition::compose` | `fn compose(subgraphs: Vec<Subgraph<Initial>>, options: CompositionOptions) -> Result<CompositionSuccess, CompositionFailure>` | `apollo-federation = "=2.15.0"` |
| `Subgraph::parse` | `Subgraph::parse(name: &str, schema: &str, sdl: &str) -> Result<Self, ParseError>` | `apollo-federation = "=2.15.0"` |

### Files the Developer Will Touch
- **Only**: `crates/gql-core/tests/wasm.rs` — full replacement of test contents
- No changes to source code, Cargo.toml, flake, or config files needed.

### Verification Command
```bash
nix develop -c wasm-pack test --headless --chrome crates/gql-core
```
The test must pass within the Nix dev shell (Chrome provided by the flake).

<!-- SECTION:NOTES:END -->
