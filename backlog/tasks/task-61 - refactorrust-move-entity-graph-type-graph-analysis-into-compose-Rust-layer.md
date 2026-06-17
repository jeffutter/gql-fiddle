---
id: TASK-61
title: >-
  refactor(rust): move entity graph & type graph analysis into compose() Rust
  layer
status: To Do
assignee: []
created_date: '2026-06-17 04:31'
labels:
  - architecture
  - rust
  - wasm
dependencies: []
references:
  - web/src/schemaToEntityGraph.ts
  - web/src/schemaToTypeGraph.ts
  - crates/gql-core/src/compose.rs
  - crates/gql-core/src/dto.rs
  - web/src/core/types.ts
priority: medium
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`schemaToEntityGraph.ts` and `schemaToTypeGraph.ts` both re-parse the supergraph SDL from scratch using `graphql-js` to scan federation directives (`@join__type`, `@join__field`) and build graph structures for visualization. The Rust `compose()` function already has the fully-parsed supergraph with all those annotations in memory via `apollo-compiler` and `apollo-federation` — it discards this information immediately.

## Goal

Extend the `compose()` return value with pre-computed `entity_graph` and `type_graph` data so the web layer consumes plain data structures instead of re-parsing SDL. This removes the `graphql-js` dependency from these two files and moves the analysis to where the data already lives.

## Shape of the change

**Rust side (`crates/gql-core/`):**
- Add `EntityGraph` and `TypeGraph` DTO types to `dto.rs` (nodes, edges, subgraph membership)
- Walk the composed supergraph in `compose.rs` to populate these structures and serialize them into the compose result JSON alongside existing fields (`supergraph_sdl`, `api_schema_sdl`, `hints`)

**Web side (`web/src/`):**
- Update `core/types.ts` to add `entity_graph` and `type_graph` fields on `ComposeResult`
- Refactor `schemaToEntityGraph.ts` and `schemaToTypeGraph.ts` to accept the pre-computed data from the compose result rather than calling `graphql-js` `parse()` and walking ASTs
- Consumers (`EntityOwnershipGraph.tsx`, `TypeGraph.tsx`, and their wiring in `App.tsx`) should require no changes if the output shape of the two utility files is preserved
<!-- SECTION:DESCRIPTION:END -->
