---
id: TASK-2
title: Implement compose() with apollo-federation
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-0
dependencies:
  - TASK-1
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the stub in compose.rs with real federation composition: multiple subgraph schemas in, one supergraph SDL out. The JSON shape returned across the WASM boundary must not change. This is the core of Spike 0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two valid subgraphs sharing an entity compose to ok:true with a non-empty supergraph_sdl
- [ ] #2 Schemas that cannot compose return ok:false with at least one error
- [ ] #3 Returned JSON keys exactly match the contract (ok, supergraph_sdl, hints / ok, errors)
- [ ] #4 The UNIMPLEMENTED stub response is gone
- [ ] #5 nix develop -c cargo build -p gql-core succeeds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Read crates/gql-core/src/compose.rs (the stub) and crates/gql-core/src/dto.rs (SubgraphInput has fields: name, sdl).
2. Keep the signature exactly: pub fn compose(subgraphs: &[SubgraphInput]) -> serde_json::Value
3. Use apollo-federation 2.15.0 to compose the subgraphs. Find the correct API by reading the EXACT version docs at https://docs.rs/apollo-federation/2.15.0 (search for "compose"/"Supergraph"). This crate changes between versions, so read 2.15.0 specifically.
4. On success return exactly this JSON shape:
     { "ok": true, "supergraph_sdl": "<composed SDL>", "hints": [ { "code": "...", "message": "..." } ] }
   Use an empty array for "hints" when there are none.
5. On failure return exactly:
     { "ok": false, "errors": [ { "code": "...", "message": "...", "locations": [ { "line": N, "col": N } ] } ] }
   "locations" may be an empty array when the error has no position.
6. In dto.rs remove the #[allow(dead_code)] attributes on the SubgraphInput fields (they are now used).
7. Build: nix develop -c cargo build -p gql-core
<!-- SECTION:PLAN:END -->
