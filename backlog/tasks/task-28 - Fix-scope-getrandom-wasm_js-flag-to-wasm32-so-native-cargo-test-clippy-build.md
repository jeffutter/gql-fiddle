---
id: TASK-28
title: 'Fix: scope getrandom wasm_js flag to wasm32 so native cargo test/clippy build'
status: Done
assignee:
  - developer
created_date: '2026-06-07 22:37'
updated_date: '2026-06-08 01:21'
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
- [x] #1 .envrc no longer exports RUSTFLAGS globally
- [x] #2 .cargo/config.toml scopes the getrandom flag to wasm32 using a valid key: the table header is [target.'cfg(target_arch = "wasm32")'] with rustflags directly under it (no .build sub-key)
- [x] #3 nix develop -c cargo test -p gql-core passes with RUSTFLAGS exported exactly as the old .envrc did (i.e. the flag no longer reaches the native host build)
- [x] #4 nix develop -c cargo clippy -p gql-core --all-targets is clean and emits no 'unused key build' warning
- [x] #5 nix develop -c bash -c "cd web && pnpm build:wasm" still produces web/src/wasm/gql_core_bg.wasm
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

3. Verify native build/test no longer sees the wasm flag. With .envrc updated and config.toml corrected, run:
     nix develop -c cargo test -p gql-core
   All 12 tests must compile and pass. There should be NO getrandom "wasm_js backend requires the wasm_js feature" error (that error appeared when RUSTFLAGS leaked to the native host build).

4. Verify clippy is clean and warning-free:
     nix develop -c cargo clippy -p gql-core --all-targets
   Confirm there is NO `warning: unused key 'build' in [target] config table` line in the output. The clippy run should be clean aside from normal compilation messages.

5. Verify the wasm build still works end to end:
     nix develop -c bash -c "cd web && pnpm build:wasm"
   This runs `wasm-pack build ../crates/gql-core --target web` which delegates to Cargo (respects .cargo/config.toml). Confirm a .wasm artifact exists under web/src/wasm/ afterwards (the files are git-ignored; do not stage them).

6. Run the native test suite once more for final confidence: nix develop -c cargo test -p gql-core.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed getrandom wasm_js flag scoping: removed the global RUSTFLAGS export from .envrc and corrected the invalid [target.cfg(...).build] key in .cargo/config.toml to [target.cfg(target_arch = "wasm32")]. All 5 acceptance criteria verified — native tests (13), web tests (8), clippy, formatting, WASM build all pass cleanly with zero warnings.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-28 — Scope getrandom wasm_js flag to wasm32 target

## Summary
The fix is straightforward: remove the global `RUSTFLAGS` export from `.envrc` and correct an invalid TOML table key in `.cargo/config.toml`. The Cargo Book explicitly documents that `[target.'cfg(target_arch = "wasm32")']` accepts `rustflags` directly as a child key — there is no `.build` sub-key. In getrandom v0.3+, enabling the `wasm_js` feature via Cargo.toml automatically selects the wasm_js backend; the `--cfg getrandom_backend="wasm_js"` RUSTFLAGS flag is no longer needed and only breaks native builds when set globally.

## Findings

1. **Cargo `[target.*]` config accepts `rustflags` directly — `.build` is invalid**
   The Cargo Book (Configuration reference) documents the exact valid keys under `[target.<triple>]` and `[target.<cfg>]`: `linker`, `runner`, `rustflags`, `rustdocflags`. There is no `.build` sub-key. Using `[target.'cfg(target_arch = "wasm32")'.build]` causes Cargo to emit `warning: unused key 'build'` and silently ignores the entire table — a no-op. The correct form is `[target.'cfg(target_arch = "wasm32")']` with `rustflags` as a direct child key.
   [Source](https://doc.rust-lang.org/stable/cargo/reference/config.html#target)

2. **getrandom v0.3.4+ auto-selects wasm_js backend when the feature is enabled — no RUSTFLAGS needed**
   Starting with getrandom 0.3.4, enabling the `wasm_js` crate feature automatically uses the wasm_js backend by default for `wasm32-unknown-unknown`. Users "will no longer need to specify `--cfg getrandom_backend=\"wasm_js\"` in RUSTFLAGS" (getrandom CHANGELOG v0.3.4). The `--cfg` flag still works as an override but is entirely unnecessary when the feature is enabled via Cargo.toml dependencies. For library crates, enabling the feature in `[target.'cfg(all(target_arch = "wasm32", not(target_os = "emscripten")))'.dependencies]` is the correct approach and already present in this project.
   [Source](https://github.com/rust-random/getrandom/blob/master/CHANGELOG.md#034---2025-10-14)

3. **RUSTFLAGS env var has highest priority — it overrides all config.toml rustflags**
   Cargo checks rustflags sources in this order (mutually exclusive, first match wins):
   1. `CARGO_ENCODED_RUSTFLAGS` environment variable
   2. `RUSTFLAGS` environment variable ← **this is what .envrc sets globally**
   3. All matching `target.<triple>.rustflags` and `target.<cfg>.rustflags` config entries
   4. `build.rustflags` config value
   
   Because `.envrc` exports `RUSTFLAGS` globally, it takes precedence over *all* target-specific rustflags in config.toml — meaning the scoped config was never even consulted when .envrc was sourced. Removing the export is required for the config-based scoping to work at all.
   [Source](https://doc.rust-lang.org/stable/cargo/reference/config.html#buildrustflags)

4. **`cfg()` expressions in `[target.*]` table headers are supported but have known limitations**
   Cargo supports `cfg()` expressions as table keys (e.g., `[target.'cfg(target_arch = "wasm32")']`). However, the docs warn: "Do not try to match on `debug_assertions`, `test`, Cargo features like `feature=\"foo\"`, or values set by build scripts." Matching on `target_arch` is safe and well-supported. If both a triple and a cfg expression match, the triple takes precedence; if multiple cfg expressions match, flags are joined.
   [Source](https://doc.rust-lang.org/stable/cargo/reference/config.html#target)

5. **No external libraries or API signatures needed**
   This is purely a configuration fix — editing two files (`.envrc` and `.cargo/config.toml`). No code changes, no dependency version bumps, no new packages. The acceptance criteria are all verification commands that run inside the existing Nix dev shell.

## Gotchas

- **Do not re-add RUSTFLAGS to .envrc** — even if scoped with `RUSTFLAGS_TARGET`, Cargo's env var priority means any RUSTFLAGS export will override config.toml rustflags entirely. The only correct path is config-based scoping.
- **direnv must be reloaded** after editing `.envrc` — run `direnv allow` or restart the shell. Otherwise the old RUSTFLAGS value persists in the session.
- **The `[wasm-pack]` section is unrelated** to Cargo's target config — it's a custom table read by wasm-pack CLI, not Cargo. It can remain unchanged.
- **Cargo does NOT read `.cargo/config.toml` from workspace member crates** — only from the workspace root. Since `.cargo/config.toml` sits at the repo root, this is fine for the project structure described.

## Sources

### Kept
- **Cargo Book — Configuration** (https://doc.rust-lang.org/stable/cargo/reference/config.html) — Authoritative reference for all `[target.*]` valid keys, rustflags priority order, and cfg expression limitations
- **getrandom CHANGELOG v0.3.4** (https://github.com/rust-random/getrandom/blob/master/CHANGELOG.md#034---2025-10-14) — Documents that `wasm_js` feature auto-selects the backend; RUSTFLAGS flag no longer required
- **Cargo issue #5777** (https://github.com/rust-lang/cargo/issues/5777) — Confirms cfg expressions in `[target.*]` have known limitations but `target_arch` matching is reliable

### Dropped
- Cargo issue #6858, #8170, #12862, #11166 — Related but not directly relevant to this specific fix (they cover edge cases with cfg + features, mutual exclusivity of build.rustflags vs target.rustflags, and extern library resolution)
- GitHub PR #10462 (targeted RUSTFLAGS variants) — Unstable feature; not needed for this fix

## Gaps

Nothing significant. The fix is a two-line edit to configuration files with no external dependencies. The acceptance criteria verification commands are all deterministic — if native tests pass and wasm build produces the expected artifact, the task is done. One minor gap: confirming which version of getrandom the project actually pins (the task says v0.3, but the CHANGELOG shows 0.3.4+ behavior applies). This should be verified in `crates/gql-core/Cargo.toml` before implementation to ensure the auto-selection behavior is available.

<!-- SECTION:NOTES:END -->
