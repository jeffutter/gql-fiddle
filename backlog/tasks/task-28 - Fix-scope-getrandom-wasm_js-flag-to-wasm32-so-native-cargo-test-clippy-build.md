---
id: TASK-28
title: 'Fix: scope getrandom wasm_js flag to wasm32 so native cargo test/clippy build'
status: To Do
assignee: []
created_date: '2026-06-07 22:37'
updated_date: '2026-06-07 22:38'
labels:
  - review-followup
milestone: m-1
dependencies:
  - TASK-27
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-27 (.cargo/config.toml:2 and .envrc:4). Axis: Resilient/Correct — the project's primary test/lint commands are broken in the documented dev workflow.

The getrandom_backend="wasm_js" flag is forced onto ALL build targets, not just wasm32:

1. .envrc:4 exports RUSTFLAGS globally (export RUSTFLAGS="--cfg getrandom_backend=\"wasm_js\""). In the documented direnv workflow this leaks onto the native host build, so `nix develop -c cargo test -p gql-core` fails to compile getrandom with: 'The "wasm_js" backend requires the `wasm_js` feature for `getrandom`'. cargo build, cargo clippy and cargo test are all broken this way. Verified: unsetting RUSTFLAGS makes all 12 native tests pass.

2. TASK-27 tried to scope the flag via the table header [target.'cfg(target_arch = "wasm32")'.build] in .cargo/config.toml, but `.build` is NOT a valid sub-key under [target.*]. cargo emits `warning: unused key 'build' in [target] config table cfg(target_arch = "wasm32")` on every invocation and ignores the rustflags entirely (a no-op).

The wasm build does NOT actually need the env flag: the wasm_js *feature* is already enabled for wasm32 via Cargo.toml's [target.'cfg(all(target_arch = "wasm32", not(target_os = "emscripten")))'.dependencies] getrandom entry. Verified: `cargo build -p gql-core --target wasm32-unknown-unknown` succeeds with RUSTFLAGS unset. So the global RUSTFLAGS export is pure downside — it only breaks native builds. The correctly-scoped config form (target rustflags applied only to wasm32) also builds wasm fine (verified via --config).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 .envrc no longer exports RUSTFLAGS globally
- [ ] #2 .cargo/config.toml scopes the getrandom flag to wasm32 using a valid key: the table header is [target.'cfg(target_arch = "wasm32")'] with rustflags directly under it (no .build sub-key)
- [ ] #3 nix develop -c cargo test -p gql-core passes with RUSTFLAGS exported exactly as the old .envrc did (i.e. the flag no longer reaches the native host build)
- [ ] #4 nix develop -c cargo clippy -p gql-core --all-targets is clean and emits no 'unused key build' warning
- [ ] #5 nix develop -c bash -c "cd web && pnpm build:wasm" still produces web/src/wasm/gql_core_bg.wasm
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

Background: the getrandom wasm_js flag must only ever apply to the wasm32 target. It is currently applied globally (via .envrc) and the config attempt to scope it is a no-op (invalid key). The wasm_js *feature* in crates/gql-core/Cargo.toml already enables getrandom's wasm support for wasm32, and the wasm build succeeds without the env flag — so removing the global flag does not break the wasm build.

1. Edit .envrc. Delete the comment line and the export line that read:
     # Required by getrandom v0.3 on wasm32-unknown-unknown.
     export RUSTFLAGS="--cfg getrandom_backend=\"wasm_js\""
   Leave the rest of .envrc (use flake, lefthook install) intact. If you have a direnv-activated shell, run `direnv allow` afterwards so the change takes effect.

2. Edit .cargo/config.toml. Change ONLY the table header on line 2 from:
     [target.'cfg(target_arch = "wasm32")'.build]
   to:
     [target.'cfg(target_arch = "wasm32")']
   Leave the existing `rustflags = ["--cfg", "getrandom_backend=\"wasm_js\""]` line directly beneath it unchanged, and leave the [wasm-pack] section unchanged. The `.build` sub-key does not exist under [target.*]; removing it makes the rustflags valid and applied only when compiling for wasm32. The final file should be:
     # Required by getrandom v0.3 on wasm32-unknown-unknown.
     [target.'cfg(target_arch = "wasm32")']
     rustflags = ["--cfg", "getrandom_backend=\"wasm_js\""]

     # Disable wasm-opt (nixpkgs binaryen doesn't support bulk memory ops).
     [wasm-pack]
     wasm-opt = false

3. Verify native build/test no longer sees the wasm flag. Reproduce the original failing condition by exporting the flag the way .envrc used to, then confirm it no longer reaches the native build now that it is config-scoped to wasm32:
     nix develop -c cargo test -p gql-core
   It must compile and all tests pass (no getrandom "wasm_js backend requires the wasm_js feature" error).

4. Verify clippy is clean and warning-free:
     nix develop -c cargo clippy -p gql-core --all-targets
   Confirm there is NO `warning: unused key 'build' in [target] config table` line in the output.

5. Verify the wasm build still works end to end:
     nix develop -c bash -c "cd web && pnpm build:wasm"
   Confirm web/src/wasm/gql_core_bg.wasm exists afterwards (it is git-ignored; do not stage it).

6. Run the native test suite once more to be sure: nix develop -c cargo test -p gql-core.
<!-- SECTION:PLAN:END -->
