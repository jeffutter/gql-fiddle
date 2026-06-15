---
id: TASK-50
title: 'CI: split monolithic check job into parallel jobs'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-15 12:11'
updated_date: '2026-06-15 21:05'
labels:
  - ci
  - infra
  - planned
dependencies: []
priority: medium
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`.github/workflows/ci.yml` currently runs everything in a single sequential `check` job: Rust fmt/clippy/native-test, WASM build, WASM browser tests (wasm-pack + headless Chrome), then web install/lint/typecheck/unit-test/e2e — all back to back. None of these steps run concurrently even though most are independent, so CI wall-clock time is roughly the sum of every step.

Split this into multiple jobs with an explicit `needs` graph so independent work runs concurrently:

- **`rust-checks`** (no deps): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (native). Fully independent of WASM/web.
- **`wasm-build`** (no deps): builds `web/src/wasm` via `pnpm build:wasm` (which is just `wasm-pack build crates/gql-core --target web --out-dir web/src/wasm` — doesn't require `pnpm install`). Upload `web/src/wasm` as a build artifact (`actions/upload-artifact`).
- **`wasm-browser-tests`** (no deps): `wasm-pack test --headless --chrome crates/gql-core` — a separate cargo build (wasm-bindgen-test harness), independent of `wasm-build`'s output.
- **`web-checks`** (needs `wasm-build`): download the `web/src/wasm` artifact, `pnpm install --frozen-lockfile`, then `pnpm lint`, `pnpm tsc --noEmit`, `pnpm test run`. `web/src/core/index.ts` imports generated bindings from `web/src/wasm`, so lint/typecheck/unit-tests all require the artifact to exist first.
- **`e2e`** (needs `wasm-build`): download the artifact, `pnpm install --frozen-lockfile`, `pnpm e2e`. Note: `pnpm e2e`'s Playwright `webServer` runs `pnpm dev`, which itself re-runs `build:wasm` via `cargo-watch` — investigate whether the e2e job can use a lighter webServer command (e.g. `vite` directly) once the artifact is already in place, to avoid rebuilding WASM a second time within the same run.

This lets `rust-checks`, `wasm-build`, and `wasm-browser-tests` start immediately and run concurrently, with `web-checks`/`e2e` starting as soon as `wasm-build` finishes rather than after the entire Rust suite completes.

This is the foundational restructuring — follow-up tickets add Cargo and pnpm caching to the new jobs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ci.yml defines rust-checks, wasm-build, wasm-browser-tests, web-checks, and e2e as separate jobs
- [x] #2 web-checks and e2e declare `needs: wasm-build` and consume web/src/wasm via upload-artifact/download-artifact rather than rebuilding it themselves
- [x] #3 rust-checks, wasm-build, and wasm-browser-tests have no inter-dependencies on each other and run concurrently
- [x] #4 All checks currently covered by the single `check` job still run and gate the workflow (note any required-status-check name changes needed for branch protection)
- [x] #5 The e2e job's redundant WASM rebuild (pnpm dev -> build:wasm) is addressed, or explicitly documented as a known follow-up if not fixed here
- [ ] #6 A CI run on a PR shows reduced total wall-clock time vs the current single-job baseline on main
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Replace the single `check` job in `.github/workflows/ci.yml` with five jobs and an explicit `needs` graph, so independent work runs concurrently.

```
rust-checks        (no deps)
wasm-build         (no deps)  --> uploads web/src/wasm artifact
wasm-browser-tests (no deps)
web-checks         (needs: wasm-build) --> downloads artifact
e2e                (needs: wasm-build) --> downloads artifact
```

## Job definitions

All jobs share the same setup steps:
```yaml
- uses: actions/checkout@v4
- uses: DeterminateSystems/nix-installer-action@main
- uses: DeterminateSystems/magic-nix-cache-action@main
```

### 1. `rust-checks` (no deps)
Steps (moved verbatim from current job, unchanged):
- `nix develop -c cargo fmt --check`
- `nix develop -c cargo clippy --all-targets -- -D warnings`
- `nix develop -c cargo test`

### 2. `wasm-build` (no deps)
- `nix develop -c bash -c "cd web && pnpm build:wasm"` (runs `wasm-pack build crates/gql-core --target web --out-dir ../../web/src/wasm` — does NOT need `pnpm install` since it only invokes wasm-pack/cargo)
- Upload artifact: `actions/upload-artifact@v4` with `name: wasm-bindings`, `path: web/src/wasm`

### 3. `wasm-browser-tests` (no deps)
- `nix develop -c wasm-pack test --headless --chrome crates/gql-core` (unchanged, separate wasm-bindgen-test harness build, independent of wasm-build's output)

### 4. `web-checks` (needs: wasm-build)
- `actions/download-artifact@v4` with `name: wasm-bindings`, `path: web/src/wasm`
- `nix develop -c bash -c "cd web && pnpm install --frozen-lockfile"`
- `nix develop -c bash -c "cd web && pnpm lint"`
- `nix develop -c bash -c "cd web && pnpm tsc --noEmit"`
- `nix develop -c bash -c "cd web && pnpm test run"`

### 5. `e2e` (needs: wasm-build)
- `actions/download-artifact@v4` with `name: wasm-bindings`, `path: web/src/wasm`
- `nix develop -c bash -c "cd web && pnpm install --frozen-lockfile"`
- `nix develop -c bash -c "cd web && pnpm e2e"`

**Redundant WASM rebuild (AC #5):** Playwright's `webServer.command` is `pnpm dev`, which itself runs `pnpm build:wasm` via `cargo-watch` before starting Vite — rebuilding the artifact that was just downloaded. Fix by adding a CI-only webServer command that skips the wasm rebuild and runs Vite directly, e.g. add a script to `web/package.json`:
```json
"dev:no-wasm": "vite"
```
and in `web/playwright.config.ts`, branch on `process.env.CI`:
```ts
webServer: {
  command: process.env.CI ? "pnpm dev:no-wasm" : "pnpm dev",
  port: 8001,
  reuseExistingServer: !process.env.CI,
},
```
This relies on the downloaded `web/src/wasm` artifact already being present (from `wasm-build` via `download-artifact`), so `vite` alone is sufficient — `cargo-watch`/`build:wasm` is unnecessary in CI.

## Required-status-check name changes (AC #4)

Branch protection is configured outside this repo (GitHub UI/API, not checked in). The single required check `check` must be replaced with the five new job names: `rust-checks`, `wasm-build`, `wasm-browser-tests`, `web-checks`, `e2e`. Document this in the PR description as a manual follow-up — update the branch protection required-status-checks list after this PR merges and a run completes (new job names won't appear in the picker until they've run at least once).

## Out of scope (follow-ups)
- TASK-51: Cargo registry/target caching for rust-checks, wasm-build, wasm-browser-tests (depends on TASK-50)
- TASK-52: pnpm store caching for web-checks and e2e (depends on TASK-50)

## Verification
1. Edit `.github/workflows/ci.yml` per the job breakdown above; edit `web/package.json` and `web/playwright.config.ts` for the e2e webServer fix.
2. Open a PR (or push to main) and confirm in the Actions UI:
   - All 5 jobs appear; `rust-checks`, `wasm-build`, `wasm-browser-tests` start immediately/concurrently
   - `web-checks` and `e2e` wait for `wasm-build`, download the artifact successfully
   - `e2e`'s webServer starts via `vite` only (no `build:wasm`/cargo-watch step in its log)
   - All checks pass and total wall-clock time is reduced vs the current single-job baseline (AC #6)
3. Update branch protection required status checks (manual GitHub UI step, document in PR description per AC #4)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced the single 'check' job in .github/workflows/ci.yml with five jobs per the implementation plan:
- rust-checks (no deps): cargo fmt --check, clippy, cargo test
- wasm-build (no deps): pnpm build:wasm, uploads web/src/wasm as 'wasm-bindings' artifact
- wasm-browser-tests (no deps): wasm-pack test --headless --chrome
- web-checks (needs: wasm-build): downloads artifact, pnpm install/lint/tsc/test
- e2e (needs: wasm-build): downloads artifact, pnpm install + pnpm e2e

Fixed the redundant WASM rebuild (AC #5): added 'dev:no-wasm': 'vite' script to web/package.json, and playwright.config.ts now uses 'pnpm dev:no-wasm' for webServer.command when process.env.CI is set (falls back to 'pnpm dev' locally). Verified locally that 'pnpm dev:no-wasm' starts Vite directly without invoking build:wasm/cargo-watch.

AC #4: all checks previously gated by the single 'check' required status check are preserved across the five new jobs. Branch protection required-status-checks must be updated manually (GitHub UI/API, outside this repo) to require rust-checks, wasm-build, wasm-browser-tests, web-checks, and e2e in place of 'check' — new job names won't appear in the picker until they've run at least once on a workflow run.

AC #6 (reduced wall-clock time) can only be confirmed by an actual CI run on main/a PR after this change is pushed; not verifiable locally.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split the monolithic 'check' CI job into five jobs (rust-checks, wasm-build, wasm-browser-tests, web-checks, e2e) with web-checks/e2e depending on wasm-build via upload/download-artifact. Also fixed the e2e job's redundant WASM rebuild by adding a 'dev:no-wasm' script and branching playwright.config.ts's webServer command on CI. Manual follow-up: update branch protection required status checks from 'check' to the five new job names after this runs once.
<!-- SECTION:FINAL_SUMMARY:END -->
