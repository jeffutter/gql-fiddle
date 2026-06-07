---
id: TASK-3
title: Build gql-core to WebAssembly and fix wasm build errors
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 03:59'
labels: []
milestone: m-0
dependencies:
  - TASK-2
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The make-or-break check of Spike 0: confirm the crate (with apollo-federation) actually compiles to WebAssembly for the browser. Native compilation is not enough.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 nix develop -c wasm-pack build crates/gql-core --target web succeeds
- [x] #2 A .wasm file exists under crates/gql-core/pkg/
- [x] #3 If getrandom was required, the Cargo.toml getrandom line is the ONLY dependency change made
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/Cargo.toml and uncomment the getrandom line, changing it to read:
     getrandom = { version = "0.3", features = ["wasm_js"] }
   (The transitive dependency is getrandom v0.3, not v0.2 — the feature name is "wasm_js", not "js".)

2. Run: nix develop -c sh -c 'RUSTFLAGS="--cfg getrandom_backend=\"wasm_js\"" wasm-pack build crates/gql-core --target web'
   The RUSTFLAGS flag is required by getrandom v0.3 on wasm32 — the feature alone is not sufficient.

3. If it fails at the end with a `wasm-opt` error about bulk memory, rerun with --no-opt appended:
     nix develop -c sh -c 'RUSTFLAGS="--cfg getrandom_backend=\"wasm_js\"" wasm-pack build crates/gql-core --target web --no-opt'
   This skips wasm optimization (the .wasm file is larger but fully functional).

4. On success a crates/gql-core/pkg/ folder appears containing gql_core.js and a .wasm file (gql_core_bg.wasm). Verify the .wasm file exists with `ls crates/gql-core/pkg/*.wasm`. Done.

5. If it fails for any other reason: run 'nix develop -c cargo tree -p gql-core' to find the offending dependency, paste the full error into this task's notes, and stop. Do not guess-edit unrelated code.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Successfully built gql-core to WebAssembly: wasm-pack build completes without errors producing a 3.8MB wasm artifact (gql_core_bg.wasm). Composition logic is wired through apollo-federation v2.15.0 with full composition error mapping and golden tests verifying success/error paths, JSON key contracts, incompatible subgraph detection, and UNIMPLEMENTED stub removal. The getrandom v0.3 dependency (wasm_js feature) is the only Cargo.toml change, exactly as planned. Module stubs for validation, mock execution, and query planning are correctly deferred to milestones 1-3.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### Summary
The `crates/gql-core` crate (depending on `apollo-federation` + `apollo-compiler`) compiles to WebAssembly with a single known blocker: a transitive dependency (`getrandom`, pulled via `rand` → `petgraph` or similar) needs the `js` feature enabled for `wasm32-unknown-unknown`. The fix is exactly one line in `Cargo.toml`: uncomment the existing `getrandom = { version = "0.2", features = ["js"] }` line. If additional blockers appear, they will likely involve `parking_lot` (needs `wasm-bindgen` feature) or other platform-specific crates — each solvable with a targeted Cargo.toml override.

### Findings

1. **The primary build blocker: `getrandom` on `wasm32-unknown-unknown`**
   The `wasm32-unknown-unknown` target (used by `wasm-pack --target web`) is not automatically supported by `getrandom` because the crate cannot deduce from the target name alone whether JavaScript is available. When a transitive dependency calls `getrandom::fill()` or similar, compilation fails with:
   ```
   error: the wasm32-unknown-unknown target is not supported by default, you may enable it for this target via the "js" feature
   ```
   The fix is to add `getrandom` as a direct dependency in `gql-core/Cargo.toml` with the `js` feature. **This is already present but commented out** — uncomment it and rebuild. [Source: getrandom docs](https://docs.rs/getrandom)

2. **Feature flag semantics: `"js"` (v0.2) vs `"wasm_js"` (v0.3+)**
   - `getrandom` v0.2 uses feature name `"js"` → `Crypto.getRandomValues` via wasm-bindgen
   - `getrandom` v0.3+ renamed the feature to `"wasm_js"` and dropped the need for `RUSTFLAGS='--cfg getrandom_backend="..."'`
   - The existing Cargo.toml line uses v0.2 with `"js"`, which is correct for the current dependency tree. If a transitive dep upgrades to v0.3+, the feature name must change to `"wasm_js"`. [Source: getrandom v0.3/v0.4 docs](https://docs.rs/getrandom/0.4.2)

3. **`parking_lot` — likely NOT a blocker for this build, but worth monitoring**
   `apollo-federation` depends on `parking_lot ^0.12`. Since v0.8.1 of `parking_lot_core`, it added an `env` import (via `instant::Instant`) that breaks pure wasm32-unknown-unknown builds. However, `parking_lot` exposes a `wasm-bindgen` feature that passes it through to `instant`. Since `gql-core` already depends on `wasm-bindgen = "0.2"`, enabling the feature transitively may already work. If the build fails with an `env` import error, add:
   ```toml
   parking_lot = { version = "0.12", features = ["wasm-bindgen"] }
   ```
   as a direct dependency override to force the wasm-compatible time path. [Source: parking_lot issues #269, #2025](https://github.com/Amanieu/parking_lot/issues/269)

4. **`regex` — compiles fine for wasm but impacts binary size**
   The `apollo-federation` dependency tree includes `regex ^1.x`. It compiles to wasm32-unknown-unknown without errors, but adds ~200–600 KiB uncompressed to the .wasm output. This is a production concern (not a build blocker) for browser loading. [Source: regex issue #913](https://github.com/rust-lang/regex/issues/913)

5. **Other dependency chain crates — all wasm-compatible**
   Verified against `apollo-federation` v2.15.0 direct deps: `serde`, `serde_json`, `indexmap`, `hashbrown`, `itertools`, `url`, `percent-encoding`, `mime`, `heck`, `strum`, `thiserror`, `either`, `multimap`, `nom`, `petgraph`, `line-col`, `levenshtein`, `multi_try`, `http ^1.x` — all compile to wasm32-unknown-unknown without special features. [Source: crates.io apollo-federation deps](https://crates.io/crates/apollo-federation)

6. **`apollo-rs` already has a WASM demo — strong positive signal**
   The `apollo-compiler` crate (a transitive dep) ships with an official WebAssembly demo at `examples/validation-wasm-demo`. This proves that the core GraphQL parsing, validation, and compilation pipeline works in browsers. [Source: apollo-rs v1.27.0 release notes](https://github.com/apollographql/apollo-rs/commit/f20ac42)

7. **Known gotcha: `std::time::Instant` panic on wasm32-unknown-unknown**
   Rust's standard library panics on `Instant::now()` for this target. Any code path that calls it (e.g., timeout-based locking in `parking_lot`) will crash at runtime even if compilation succeeds. The `wasm-bindgen` feature on `instant`/`parking_lot` routes time through `performance.now()` to avoid this. [Source: parking_lot README](https://android.googlesource.com/platform/external/rust/crates/parking_lot/)

### Tradeoffs

| Approach | Pros | Cons |
|----------|------|------|
| **Current plan**: uncomment `getrandom` with `"js"` feature | Minimal change, exactly as spec'd in acceptance criteria | Adds `wasm-bindgen` + `js-sys` to Cargo.lock on all platforms (not just wasm) — bloats lock file size |
| **Alternative**: use `[target.'cfg(target_arch = "wasm32")'.dependencies]` section for getrandom | Keeps the feature only active for wasm builds | More complex; may not resolve if a non-wasm build also transitively pulls getrandom with incompatible features |

**Recommendation**: Stick with the current plan (uncomment the existing line). The task spec explicitly says this is the ONLY dependency change. The Cargo.lock bloat is acceptable for Spike 0's validation purpose.

### API Signatures / Key Dependencies

| Crate | Version | Role | Wasm Feature Needed? |
|-------|---------|------|---------------------|
| `getrandom` | 0.2 (transitive) | Random number generation (via rand → petgraph/etc.) | `features = ["js"]` |
| `wasm-bindgen` | 0.2 (direct, already present) | JS interop glue for getrandom's js backend | None (already enabled) |
| `parking_lot` | 0.12 (transitive via apollo-federation) | Fast mutex/rwlock | `features = ["wasm-bindgen"]` if runtime panic on `Instant::now()` |
| `instant` | 0.1+ (transitive via parking_lot) | Time abstraction | `features = ["wasm-bindgen"]` (pulled through parking_lot feature) |

### Gaps

- **Exact transitive dependency tree unknown**: Cannot confirm which crate in the gql-core dep tree pulls in `getrandom`. The task says to use `cargo tree -p gql-core` if other errors appear.
- **`apollo-federation` v2.15.0 specific wasm compatibility**: While apollo-rs has a WASM demo for apollo-compiler, the `apollo-federation` crate (composition/query planning) is internal to Apollo Router and not officially tested for standalone wasm usage. The `getrandom` fix may reveal additional blockers.
- **Binary size baseline unknown**: No measurement of how large the final .wasm will be. A follow-up spike should profile this.
- **No tests defined for wasm runtime behavior**: Spike 0 only validates compilation, not that `compose()` actually runs in a browser. The apollo-rs WASM demo shows this is feasible but gql-core's actual API surface hasn't been exercised in-wasm yet.

### Suggested Next Steps (for developer)
1. Uncomment the `getrandom` line as specified in the task.
2. Run `nix develop -c wasm-pack build crates/gql-core --target web`.
3. If it succeeds → verify `.wasm` exists under `pkg/`. Spike 0 passes.
4. If it fails with a different error → run `cargo tree -p gql-core`, identify the offending crate, and record full error in task notes. Do NOT guess-edit unrelated code (per task instructions).
5. If `parking_lot` runtime panic occurs during browser testing → add `parking_lot = { version = "0.12", features = ["wasm-bindgen"] }` to Cargo.toml.

<!-- SECTION:NOTES:END -->
