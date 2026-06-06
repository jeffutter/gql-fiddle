---
id: TASK-3
title: Build gql-core to WebAssembly and fix wasm build errors
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
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
- [ ] #1 nix develop -c wasm-pack build crates/gql-core --target web succeeds
- [ ] #2 A .wasm file exists under crates/gql-core/pkg/
- [ ] #3 If getrandom was required, the Cargo.toml getrandom line is the ONLY dependency change made
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Run: nix develop -c wasm-pack build crates/gql-core --target web
2. On success a crates/gql-core/pkg/ folder appears containing gql_core.js and a .wasm file. Done.
3. If it fails with a "getrandom" error for the wasm target: open crates/gql-core/Cargo.toml, uncomment the getrandom line so it reads:
     getrandom = { version = "0.2", features = ["js"] }
   then run the build again.
4. If it fails for any other reason: run 'nix develop -c cargo tree -p gql-core' to find the offending dependency, paste the full error into this task's notes, and stop. Do not guess-edit unrelated code.
<!-- SECTION:PLAN:END -->
