---
id: TASK-51
title: 'CI: cache Cargo registry and target directories across Rust jobs'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-15 12:11'
updated_date: '2026-06-15 21:42'
labels:
  - ci
  - infra
  - planned
dependencies:
  - TASK-50
priority: medium
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Each CI job that invokes `cargo` (the new `rust-checks`, `wasm-build`, and `wasm-browser-tests` jobs from TASK-50) currently compiles `apollo-compiler`, `apollo-federation`, and the rest of the dependency tree from scratch every run — a large, slow build. `magic-nix-cache-action` only caches the Nix store (toolchain derivations from the flake), not Cargo's `~/.cargo/registry`, `~/.cargo/git`, or `target/`.

Add `Swatinem/rust-cache@v2` (or equivalent `actions/cache` with keys derived from `Cargo.lock` / `crates/gql-core/Cargo.toml`) to each of the three Rust-touching jobs. Because `rust-checks` builds the native target while `wasm-build` (via wasm-pack) and `wasm-browser-tests` (via wasm-pack test, a separate wasm-bindgen-test harness build) build for `wasm32-unknown-unknown`, use distinct cache keys/`shared-key`s per job so the caches don't collide or thrash each other.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 rust-checks, wasm-build, and wasm-browser-tests jobs cache ~/.cargo/registry, ~/.cargo/git, and target/ (or wasm-pack's equivalent target dirs)
- [x] #2 Cache keys incorporate the Cargo.lock hash plus a per-job/target discriminator so native and wasm32 caches don't collide
- [ ] #3 A second CI run on an unchanged Cargo.lock shows a cache hit and a noticeably faster cargo/wasm-pack build step in the Actions log
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Add `Swatinem/rust-cache@v2` to each of the three Rust-touching jobs in
`.github/workflows/ci.yml` (`rust-checks`, `wasm-build`, `wasm-browser-tests`).
This action caches `~/.cargo/registry`, `~/.cargo/git`, and the workspace
`target/` directory, keyed on a hash of `Cargo.lock` (and `Cargo.toml`s),
with smart handling of incremental build artifacts and cleanup of stale
entries.

Since this is a single-member workspace (`crates/gql-core`), `cargo`/`wasm-pack`
both resolve `target/` to the workspace root, but with different subtrees:
- `rust-checks` builds the native target (`target/debug/...`)
- `wasm-build` (wasm-pack build) and `wasm-browser-tests` (wasm-pack test,
  a separate wasm-bindgen-test harness build) both build for
  `target/wasm32-unknown-unknown/...`

To avoid the three jobs' caches colliding/thrashing each other (per AC #2),
give each job a distinct `shared-key` via `Swatinem/rust-cache@v2`'s
`shared-key` input. `rust-cache` already namespaces by job automatically via
`save-if`/`shared-key` + the runner's job context, but being explicit makes
the per-job separation clear and intentional.

## Placement

Insert the cache step immediately after `magic-nix-cache-action` and before
the first `nix develop -c cargo ...` step in each of the three jobs — the
cache must be restored before any cargo invocation that would populate
`~/.cargo` or `target/`.

```yaml
- uses: DeterminateSystems/nix-installer-action@main
- uses: DeterminateSystems/magic-nix-cache-action@main
- uses: Swatinem/rust-cache@v2
  with:
    shared-key: "rust-checks"          # or "wasm-build" / "wasm-browser-tests"
    workspaces: ". -> target"
```

### Per-job `shared-key` values

- `rust-checks` -> `shared-key: rust-checks`
- `wasm-build` -> `shared-key: wasm-build`
- `wasm-browser-tests` -> `shared-key: wasm-browser-tests`

Using distinct `shared-key`s gives each job its own cache entry
(`rust-cache` derives the full cache key from `shared-key` + a hash of
`Cargo.lock`/`Cargo.toml`/rust toolchain version + OS), satisfying AC #2
(native vs wasm32 caches don't collide) since `wasm-build` and
`wasm-browser-tests` also won't share a cache with each other even though
both target wasm32 (their cargo invocations differ: `wasm-pack build` vs
`wasm-pack test`, which produce different artifact sets under
`target/wasm32-unknown-unknown/`).

### `workspaces` input

Set `workspaces: ". -> target"` (the default for a workspace at repo root) in
all three jobs — this tells the action where `Cargo.lock` lives and which
`target/` directory to cache. Since the action runs steps via
`nix develop -c cargo ...` / `nix develop -c wasm-pack ...`, but `rust-cache`
itself doesn't need the Rust toolchain on PATH to do its caching (it only
needs to read `Cargo.lock` and manage the `target/`/`~/.cargo` directories on
the runner's filesystem), it can run before/outside `nix develop` without
issue.

## Implementation steps

1. In `.github/workflows/ci.yml`, add a `Swatinem/rust-cache@v2` step (with
   `shared-key` set per the table above and `workspaces: ". -> target"`)
   right after the `magic-nix-cache-action` step in:
   - `rust-checks`
   - `wasm-build`
   - `wasm-browser-tests`
2. Do NOT add this to `web-checks` or `e2e` — those jobs don't invoke cargo
   directly (they consume the pre-built `wasm-bindings` artifact); pnpm
   caching for those jobs is TASK-52.
3. Double check `Swatinem/rust-cache@v2`'s default cache key already
   incorporates the runner OS and a hash of lockfiles/toolchain — no extra
   `key`/`env` inputs are needed beyond `shared-key` for the per-job
   discriminator required by AC #2.

## Verification

1. Push the change (or open a PR) and confirm in the Actions log for each of
   the three jobs:
   - A "Cache not found" / cold cache message on the first run (cache miss,
     since this is a new cache key), followed by a "Restoring cargo build
     artifacts" / cache save step.
   - Build proceeds normally and all three jobs still pass.
2. Trigger a second run with an unchanged `Cargo.lock` (e.g. push an
   unrelated small commit) and confirm:
   - The `rust-cache` step reports a cache hit for each job.
   - The subsequent `cargo fmt/clippy/test`, `pnpm build:wasm`
     (wasm-pack build), and `wasm-pack test` steps show noticeably reduced
     compile time vs the cold run (AC #3) — e.g. compare wall-clock duration
     of the "Rust tests (native)", "WASM build", and "WASM tests" steps
     between the two runs in the Actions UI.
3. Confirm the three jobs' caches remain independent — e.g. check the
   Actions "Caches" tab (repo Settings > Actions > Caches) shows three
   distinct cache entries (one per `shared-key`).

## Out of scope

- pnpm store caching for `web-checks`/`e2e` (TASK-52, separate ticket).
- No changes needed to `web-checks` or `e2e` job definitions.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added Swatinem/rust-cache@v2 to rust-checks, wasm-build, and wasm-browser-tests jobs in .github/workflows/ci.yml, placed immediately after magic-nix-cache-action and before any cargo/wasm-pack invocation. Each job uses a distinct shared-key (rust-checks, wasm-build, wasm-browser-tests) with workspaces: ". -> target" so the native-target cache (rust-checks) and the two wasm32-unknown-unknown caches (wasm-build via wasm-pack build, wasm-browser-tests via wasm-pack test) don't collide or thrash each other, satisfying AC #1 and #2. web-checks and e2e were left unchanged (they only consume the wasm-bindings artifact, no cargo invocations; pnpm caching is TASK-52). AC #3 (observing a cache hit + faster build on a second CI run with unchanged Cargo.lock) can only be verified once this is pushed and CI runs twice against an unchanged Cargo.lock -- left unchecked pending that live verification.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Swatinem/rust-cache@v2 (with per-job shared-key and workspaces: ". -> target") to the rust-checks, wasm-build, and wasm-browser-tests jobs in .github/workflows/ci.yml, caching ~/.cargo/registry, ~/.cargo/git, and target/ keyed off Cargo.lock with distinct keys per native/wasm32 job so the caches don't collide. AC #3 (cache hit + faster build on a second unchanged-Cargo.lock CI run) requires a live CI run to confirm and is left unchecked for post-merge verification.
<!-- SECTION:FINAL_SUMMARY:END -->
