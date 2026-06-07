---
id: TASK-14
title: Derive the API schema from the supergraph
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 22:39'
labels: []
milestone: m-2
dependencies:
  - TASK-2
  - TASK-28
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Queries run against the client-facing "API schema" (the supergraph with federation internals removed). Add an internal helper that returns it, because validate_query, execute_mock, and plan all need it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A pub(crate) helper returns the API schema for a composed supergraph
- [ ] #2 A test confirms the API schema excludes @join__, _entities, _Service and includes a user-defined type
- [ ] #3 nix develop -c cargo build and cargo test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. In gql-core add a helper (new module api_schema.rs, or inside compose.rs) that takes the composed supergraph and returns the API schema. Use apollo-federation 2.15.0 (look for an "api schema" capability on the supergraph type; read https://docs.rs/apollo-federation/2.15.0 ).
2. Mark it pub(crate) so the other modules can call it.
3. Return it as whatever the other tasks can consume most easily (the apollo-compiler Schema type, or an SDL string). Add a one-line comment stating which you chose.
4. Add one unit test: compose two subgraphs, derive the API schema, and assert it does NOT contain "@join__" or "_entities", but DOES contain a user-defined type from the subgraphs.
5. Build + test: nix develop -c cargo test -p gql-core
<!-- SECTION:PLAN:END -->
