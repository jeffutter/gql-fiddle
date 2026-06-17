---
id: TASK-61.2
title: >-
  refactor(web): consume EntityGraph and TypeGraph from compose result, remove
  graphql-js re-parse
status: To Do
assignee: []
created_date: '2026-06-17 04:31'
labels:
  - architecture
  - web
dependencies:
  - TASK-61.1
references:
  - web/src/schemaToEntityGraph.ts
  - web/src/schemaToTypeGraph.ts
  - web/src/core/types.ts
  - web/src/App.tsx
parent_task_id: TASK-61
priority: medium
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the web half of TASK-61. TASK-61.1 extends the `compose()` WASM result to include pre-computed `entity_graph` and `type_graph` fields. This task updates the web layer to consume those fields directly.

## Goal

Remove the `graphql-js` SDL re-parsing from `schemaToEntityGraph.ts` and `schemaToTypeGraph.ts`, replacing it with a pass-through of the already-computed data from the compose result.

## Implementation guidance

**`web/src/core/types.ts`** — add to `ComposeResult` (success case):
```ts
entity_graph?: { nodes: GraphNode[]; edges: GraphEdge[]; subgraphs: string[] }
type_graph?:   { nodes: GraphNode[]; edges: GraphEdge[]; subgraphs: string[] }
// where GraphNode = { id: string; label: string; subgraphs: string[] }
// and   GraphEdge = { source: string; target: string; label?: string }
```

**`web/src/schemaToEntityGraph.ts`** — change the function signature from accepting a SDL string + `graphql` parse call to accepting the pre-computed `entity_graph` payload. Map the DTO fields to the existing `EntityGraph` return type so downstream consumers (`EntityOwnershipGraph.tsx`) need no changes.

**`web/src/schemaToTypeGraph.ts`** — same treatment: accept the pre-computed `type_graph` payload, map to existing `TypeGraph` return type so `TypeGraph.tsx` needs no changes.

**`web/src/App.tsx`** (or wherever the compose result is consumed) — pass `composeResult.entity_graph` and `composeResult.type_graph` to the two utility functions instead of the SDL string.

## Verification

- The Entity Ownership Graph and Type Graph visualizations render identically to before
- `graphql` (graphql-js) import is no longer used in `schemaToEntityGraph.ts` or `schemaToTypeGraph.ts`
<!-- SECTION:DESCRIPTION:END -->
