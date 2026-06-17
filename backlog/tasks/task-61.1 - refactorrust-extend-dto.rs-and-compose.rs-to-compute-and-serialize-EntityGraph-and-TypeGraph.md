---
id: TASK-61.1
title: >-
  refactor(rust): extend dto.rs and compose.rs to compute and serialize
  EntityGraph and TypeGraph
status: To Do
assignee: []
created_date: '2026-06-17 04:31'
labels:
  - architecture
  - rust
  - wasm
dependencies: []
references:
  - crates/gql-core/src/compose.rs
  - crates/gql-core/src/dto.rs
parent_task_id: TASK-61
priority: medium
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the Rust half of TASK-61. Currently `compose()` discards the fully-parsed supergraph immediately after serializing `supergraph_sdl`, `api_schema_sdl`, and `hints`. The web layer then re-parses the SDL with `graphql-js` in `schemaToEntityGraph.ts` and `schemaToTypeGraph.ts` to derive the same information from federation directives.

## Goal

Add `EntityGraph` and `TypeGraph` DTO structs and populate them inside `compose.rs` by walking the composed supergraph before returning.

## Implementation guidance

**`dto.rs`** — add:
```rust
#[derive(Serialize)]
pub struct GraphNode { pub id: String, pub label: String, pub subgraphs: Vec<String> }

#[derive(Serialize)]
pub struct GraphEdge { pub source: String, pub target: String, pub label: Option<String> }

#[derive(Serialize)]
pub struct EntityGraph { pub nodes: Vec<GraphNode>, pub edges: Vec<GraphEdge>, pub subgraphs: Vec<String> }

#[derive(Serialize)]
pub struct TypeGraph  { pub nodes: Vec<GraphNode>, pub edges: Vec<GraphEdge>, pub subgraphs: Vec<String> }
```

**`compose.rs`** — after successful composition:
- Walk `ObjectTypeDefinition`s in the supergraph schema
- For **EntityGraph**: collect types with `@join__type(key:)` directives; emit an edge when a field's return type is also an entity type owned by a different subgraph
- For **TypeGraph**: collect all named domain types (skip built-ins and `join__*`/`link__*` federation internals); emit edges for field return-type relationships and union member relationships; read `@join__type(graph:)` for subgraph attribution
- Add `entity_graph` and `type_graph` fields to the success JSON payload

## Output

The WASM boundary JSON for a successful compose result gains two new optional fields:
```json
{ "ok": true, "supergraph_sdl": "...", "api_schema_sdl": "...", "hints": [],
  "entity_graph": { "nodes": [...], "edges": [...], "subgraphs": [...] },
  "type_graph":   { "nodes": [...], "edges": [...], "subgraphs": [...] } }
```

TASK-61.2 consumes this output.
<!-- SECTION:DESCRIPTION:END -->
