---
id: TASK-56.1
title: 'feat(web): implement schemaToEntityGraph.ts SDL parsing utility'
status: Done
assignee: []
created_date: '2026-06-16 19:21'
updated_date: '2026-06-16 19:27'
labels:
  - task
  - planned
dependencies: []
references:
  - web/src/schemaToEntityGraph.ts
  - web/src/schemaToEntityGraph.test.ts
documentation:
  - >-
    https://www.apollographql.com/docs/federation/federated-types/federated-directives/
  - 'https://graphql.org/graphql-js/language/#parse'
parent_task_id: TASK-56
priority: high
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `web/src/schemaToEntityGraph.ts` — a pure data-transformation utility that parses the supergraph SDL and produces a typed graph data structure (nodes + edges) ready for SVG rendering.

**Input:** `supergraph_sdl: string` (the SDL produced by a successful composition).

**Output:**
```ts
export interface EntityNode {
  id: string;          // e.g. "User"
  typeName: string;
  subgraph: string;    // owning subgraph name
  keyFields: string[]; // values from @key(fields: "...") on this subgraph
}

export interface EntityEdge {
  id: string;          // e.g. "products->users:User"
  sourceSubgraph: string;
  targetSubgraph: string;
  typeName: string;    // the entity type that is referenced cross-boundary
  keyFields: string;   // the @key(fields) string for the resolution
}

export interface EntityGraph {
  nodes: EntityNode[];
  edges: EntityEdge[];
  subgraphs: string[]; // ordered unique list of subgraph names
}
```

**Algorithm:**
1. Use `graphql`'s `parse()` + iterate `DocumentNode` definitions — no `buildASTSchema` needed since we only need directives.
2. For each `ObjectTypeDefinition` / `ObjectTypeExtension`, collect all `@join__type(graph: ...)` directive usages to establish ownership mapping: `{ typeName → Set<subgraph> }`.
3. Among those, identify entity types: types that also have at least one `@key(fields: ...)` directive in the **individual subgraph SDL** — but since we're reading from the supergraph SDL, use `@join__type(key: "...")` argument or `@join__implements` patterns. In practice the supergraph SDL stores key info on `@join__type(graph:G, key:"id")`. Parse this to extract key fields per subgraph.
4. For each field on each entity type: if the return type (unwrapped of List/NonNull) is itself an entity owned by a *different* subgraph, create an edge `sourceSubgraph → targetSubgraph`.
5. Deduplicate edges (multiple fields may reference the same cross-boundary entity — merge into a single edge per `source+target+typeName` triple, keeping the key fields string).
6. Return `{ nodes, edges, subgraphs }` where `subgraphs` is sorted alphabetically for stable color assignment.

**Edge cases:**
- No entities found → return `{ nodes: [], edges: [], subgraphs: [] }`.
- Self-referential types (entity owned by same subgraph referencing itself) → no edge created.
- Types owned by multiple subgraphs (federated `@key` on both sides) → create a node per subgraph entry, generate bidirectional edges.

**Testing:** Add `web/src/schemaToEntityGraph.test.ts` with vitest. Cover: single-subgraph (no cross-boundary edges), two-subgraph entity reference, bidirectional/circular reference, types with no `@key` excluded.
<!-- SECTION:DESCRIPTION:END -->
