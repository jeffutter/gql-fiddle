---
id: TASK-50
title: 'CI: split monolithic check job into parallel jobs'
status: To Do
assignee: []
created_date: '2026-06-15 12:11'
labels:
  - ci
  - infra
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
- [ ] #1 ci.yml defines rust-checks, wasm-build, wasm-browser-tests, web-checks, and e2e as separate jobs
- [ ] #2 web-checks and e2e declare `needs: wasm-build` and consume web/src/wasm via upload-artifact/download-artifact rather than rebuilding it themselves
- [ ] #3 rust-checks, wasm-build, and wasm-browser-tests have no inter-dependencies on each other and run concurrently
- [ ] #4 All checks currently covered by the single `check` job still run and gate the workflow (note any required-status-check name changes needed for branch protection)
- [ ] #5 The e2e job's redundant WASM rebuild (pnpm dev -> build:wasm) is addressed, or explicitly documented as a known follow-up if not fixed here
- [ ] #6 A CI run on a PR shows reduced total wall-clock time vs the current single-job baseline on main
<!-- AC:END -->
