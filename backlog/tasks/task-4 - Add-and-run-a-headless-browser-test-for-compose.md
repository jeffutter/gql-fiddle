---
id: TASK-4
title: Add and run a headless-browser test for compose()
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
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
- [ ] #1 tests/wasm.rs composes two real subgraphs via the exported compose() and asserts ok:true plus a token from the SDL
- [ ] #2 nix develop -c wasm-pack test --headless --chrome crates/gql-core passes
- [ ] #3 The old placeholder assertion is replaced
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/tests/wasm.rs.
2. Replace the placeholder test so it: builds a JSON array string of two small VALID subgraphs (each a JSON object with "name" and "sdl"), then calls the exported gql_core::compose(that_json_string) which returns a JSON String.
3. Assert the returned string contains "\"ok\":true" AND a token guaranteed to be in the composed SDL (for example "type Query").
4. Run: nix develop -c wasm-pack test --headless --chrome crates/gql-core
5. The test must pass. If Chrome is missing, it is provided by the Nix shell; make sure you ran the command via nix develop.
<!-- SECTION:PLAN:END -->
