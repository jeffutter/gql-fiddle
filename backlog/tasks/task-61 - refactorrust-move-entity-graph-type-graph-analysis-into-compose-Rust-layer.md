---
id: TASK-61
title: >-
  refactor(rust): move entity graph & type graph analysis into compose() Rust
  layer
status: In Progress
assignee:
  - '@ralph'
created_date: '2026-06-17 04:31'
updated_date: '2026-06-17 11:45'
labels:
  - architecture
  - rust
  - wasm
  - planned
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After both subtasks are done, `cargo test -p gql-core` passes
- [x] #2 After both subtasks are done, `pnpm test run` passes from web/
- [x] #3 The Entities and Type Graph tabs render correctly end-to-end
- [x] #4 No graphql-js import in schemaToEntityGraph.ts or schemaToTypeGraph.ts
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

This feature removes two redundant graphql-js SDL re-parses from the web layer by moving the EntityGraph and TypeGraph analysis into the Rust `compose()` function, which already holds the fully-parsed supergraph in memory. Work splits cleanly into two sequential subtasks.

### Sub-ticket breakdown

**TASK-61.1** (Rust — do first): Extend `dto.rs` and `compose.rs` to compute and serialize `EntityGraph` and `TypeGraph` into the compose result JSON. Must be complete before TASK-61.2.

**TASK-61.2** (Web — do second): Update `types.ts`, `schemaToEntityGraph.ts`, `schemaToTypeGraph.ts`, `TypeGraph.tsx`, and `App.tsx` to consume the pre-computed data from the compose result instead of calling `graphql-js` parse.

### Execution order

1. Complete and merge TASK-61.1 (Rust side outputs new fields, all Rust tests pass)
2. Complete and merge TASK-61.2 (Web side consumes new fields, removes graphql-js re-parse)

### Integration verification

After both subtasks are merged:
- Run `pnpm build:wasm` from `web/` to produce a fresh WASM artifact
- Run `pnpm dev` and open the app — compose two subgraphs sharing an entity, then verify the Entities tab and Type Graph tab render correctly
- Run `cargo test -p gql-core` and `cd web && pnpm test run` — all tests must pass
- Confirm `schemaToEntityGraph.ts` and `schemaToTypeGraph.ts` have no `import ... from "graphql"` lines

### Key coordination point

TASK-61.1 should add a `kind?: String` field to `GraphNode` in `dto.rs` so the TypeGraph preserves its scalar/enum node kind. This is noted in TASK-61.2's plan. If TASK-61.1 ships without this field, TASK-61.2 must default all node kinds to `"object"` and the scalar/enum toggle in `TypeGraph.tsx` will cease to function. Prefer adding the field in TASK-61.1.

### Risk: `success_path_keys_match_contract` test

The existing Rust test `success_path_keys_match_contract` asserts the compose success payload has exactly `{ok, supergraph_sdl, api_schema_sdl, hints}`. Adding `entity_graph` and `type_graph` will break this test. TASK-61.1 must update it.
<!-- SECTION:PLAN:END -->
