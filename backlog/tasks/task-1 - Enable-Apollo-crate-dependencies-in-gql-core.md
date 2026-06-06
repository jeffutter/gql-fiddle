---
id: TASK-1
title: Enable Apollo crate dependencies in gql-core
status: Done
assignee: []
created_date: '2026-06-06 20:20'
updated_date: '2026-06-06 21:16'
labels: []
milestone: m-0
dependencies: []
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Apollo GraphQL crates are currently commented out in the core crate so the scaffold builds without them. Turn them on so later tasks can compose and validate schemas. First step of Spike 0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 crates/gql-core/Cargo.toml has apollo-compiler = "=1.32.0" and apollo-federation = "=2.15.0" uncommented
- [ ] #2 nix develop -c cargo build -p gql-core succeeds (native build)
- [ ] #3 No dependency version numbers were changed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/Cargo.toml.
2. Under the "[dependencies]" Apollo section, uncomment exactly these two lines so they read:
     apollo-compiler = "=1.32.0"
     apollo-federation = "=2.15.0"
   Keep the leading "=" (exact pin). Do NOT change the numbers.
3. Leave the getrandom line commented for now.
4. Run: nix develop -c cargo build -p gql-core
5. If it builds, done. If the NATIVE build fails because of a missing dependency, paste the exact error into this task's notes and stop (do not edit unrelated code).
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Uncommented apollo-compiler = "=1.32.0" and apollo-federation = "=2.15.0" in crates/gql-core/Cargo.toml. The native build, clippy, fmt, and all 2 existing tests pass cleanly. No dependency versions were changed; getrandom remains commented as planned.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### Task: Enable Apollo crate dependencies in gql-core

**Status:** ✅ COMPLETE — native build succeeded (`cargo build -p gql-core` in 37s via Nix shell).

---

### What was done
Uncommented two dependency lines in `crates/gql-core/Cargo.toml`:
```toml
apollo-compiler = "=1.32.0"
apollo-federation = "=2.15.0"
```
Left the `getrandom` line commented (not needed — no `getrandom` build error surfaced).

### Key findings from research

1. **Rust edition 2024 compatibility**: `apollo-federation` v2.15.0 was upgraded to Rust edition 2024 [PR #6839](https://github.com/apollographql/router/pull/6839). The project workspace declares `edition = "2021"` and `rust-version = "1.82"`, but the Nix dev shell provides **Rust 1.96.0** (well above the 1.85 minimum for edition 2024). Each crate compiles with its own edition, so there's no conflict — `apollo-federation` builds fine as a dependency of an edition-2021 crate.

2. **No semver guarantees on apollo-federation**: The crate is treated as Router-internal by Apollo and does not follow semantic versioning externally. Version must match the Router release (v2.15.0 → Router v2.15.0). This means future bumps should be coordinated with Router releases.

3. **Security advisory**: `apollo-compiler` has a known vulnerability (GHSA-7mpv-9xg6-5r79) — excessive resource consumption via named fragment processing. Not a build blocker but worth monitoring for a patch before production use.

4. **No dependency version conflicts**: Both crates compiled cleanly with zero version changes to existing dependencies. The exact pins (`=1.32.0`, `=2.15.0`) resolved without transitive conflicts.

### Acceptance criteria status
- [x] #1 — `apollo-compiler = "=1.32.0"` and `apollo-federation = "=2.15.0"` uncommented in `crates/gql-core/Cargo.toml`
- [x] #2 — `nix develop -c cargo build -p gql-core` succeeded (37s, native dev profile)
- [x] #3 — No dependency version numbers changed

### Next steps / open gaps
- **WASM target**: The task only requires a native build. A WASM target (`wasm32-unknown-unknown`) still needs to be verified — `apollo-federation` may have WASM compatibility issues since it's designed for Node.js server use.
- **getrandom fallback**: If transitive deps need WASM-compatible randomness later, uncomment the `getrandom = { version = "0.2", features = ["js"] }` line.
- **API surface exploration**: The developer should review the public API of both crates (especially `apollo_compiler::Compiler` and `apollo_federation::compose::compose_supergraph`) before Spike 0's schema composition work begins.
<!-- SECTION:NOTES:END -->
