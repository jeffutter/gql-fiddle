---
id: TASK-51
title: 'CI: cache Cargo registry and target directories across Rust jobs'
status: To Do
assignee: []
created_date: '2026-06-15 12:11'
labels:
  - ci
  - infra
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
- [ ] #1 rust-checks, wasm-build, and wasm-browser-tests jobs cache ~/.cargo/registry, ~/.cargo/git, and target/ (or wasm-pack's equivalent target dirs)
- [ ] #2 Cache keys incorporate the Cargo.lock hash plus a per-job/target discriminator so native and wasm32 caches don't collide
- [ ] #3 A second CI run on an unchanged Cargo.lock shows a cache hit and a noticeably faster cargo/wasm-pack build step in the Actions log
<!-- AC:END -->
