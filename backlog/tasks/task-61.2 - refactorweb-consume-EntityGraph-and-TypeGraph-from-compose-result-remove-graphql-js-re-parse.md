---
id: TASK-61.2
title: >-
  refactor(web): consume EntityGraph and TypeGraph from compose result, remove
  graphql-js re-parse
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-17 04:31'
updated_date: '2026-06-17 11:45'
labels:
  - architecture
  - web
  - planned
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Entity Ownership Graph renders identically to before (same nodes, edges, subgraph grouping)
- [ ] #2 Type Graph renders identically to before (same nodes, edges, subgraph attribution and kind badges)
- [ ] #3 Neither `schemaToEntityGraph.ts` nor `schemaToTypeGraph.ts` imports from `"graphql"` (graphql-js)
- [ ] #4 All web unit tests pass: `pnpm test run`
- [ ] #5 `pnpm tsc --noEmit` passes with no type errors
- [ ] #6 Fallback to empty-state when `entity_graph` or `type_graph` is absent from the compose result
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

Update the web layer to consume `entity_graph` and `type_graph` from the compose result instead of re-parsing the supergraph SDL via `graphql-js`. The goal: `schemaToEntityGraph.ts` and `schemaToTypeGraph.ts` become thin mappers from the Rust DTOs to the existing TS types; consumers (`EntityOwnershipGraph.tsx`, `TypeGraph.tsx`, `App.tsx`) change minimally.

This task depends on TASK-61.1 being complete first.

### Step 1 — Update `core/types.ts`

Add the Rust DTO shapes to the `ComposeResult` success branch. The Rust DTOs use a flat generic shape (`GraphNode { id, label, subgraphs }`, `GraphEdge { source, target, label? }`):

```ts
// Shared Rust DTO shapes (mirroring dto.rs GraphNode / GraphEdge)
export interface RustGraphNode {
  id: string;       // e.g. "PRODUCTS:Product" for entity graph
  label: string;    // type name
  subgraphs: string[];
}

export interface RustGraphEdge {
  source: string;
  target: string;
  label?: string;   // key fields string for entity edges
}

export interface RustGraph {
  nodes: RustGraphNode[];
  edges: RustGraphEdge[];
  subgraphs: string[];
}

export type ComposeResult =
  | {
      ok: true;
      supergraph_sdl: string;
      api_schema_sdl: string;
      hints: CompositionHint[];
      entity_graph?: RustGraph;
      type_graph?: RustGraph;
    }
  | { ok: false; errors: CompositionError[] };
```

### Step 2 — Refactor `schemaToEntityGraph.ts`

The current signature is `schemaToEntityGraph(supergraphSdl: string): EntityGraph`. Change it to accept the Rust DTO:

```ts
import type { RustGraph } from "./core/types";

export function schemaToEntityGraph(rustGraph: RustGraph): EntityGraph {
  // Map RustGraphNode → EntityNode
  // Node id in Rust is "SUBGRAPH:TypeName" — split to get typeName and subgraph
  const nodes: EntityNode[] = rustGraph.nodes.map((n) => {
    const colonIdx = n.id.indexOf(":");
    const subgraph = colonIdx >= 0 ? n.id.slice(0, colonIdx) : n.id;
    const typeName = colonIdx >= 0 ? n.id.slice(colonIdx + 1) : n.label;
    // keyFields: extract from the node's edges or store separately
    // The Rust entity graph edge label carries the key fields string
    // Collect key fields for this (subgraph, type) pair from edges where target matches
    const keyFields = rustGraph.edges
      .filter((e) => e.target === n.id && e.label)
      .map((e) => e.label!);
    return { id: n.id, typeName, subgraph, keyFields };
  });

  const edges: EntityEdge[] = rustGraph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    sourceSubgraph: e.source.split(":")[0] ?? e.source,
    targetSubgraph: e.target.split(":")[0] ?? e.target,
    typeName: e.target.split(":")[1] ?? e.target,
    keyFields: e.label ?? "",
  }));

  return { nodes, edges, subgraphs: rustGraph.subgraphs };
}
```

**Important:** Preserve the `EntityGraph`, `EntityNode`, `EntityEdge` type exports — `EntityOwnershipGraph.tsx` imports them directly. The return type must stay identical.

**Update the test** (`schemaToEntityGraph.test.ts`): The test currently calls `schemaToEntityGraph(sdlString)`. Change the test to construct the equivalent `RustGraph` input and call the new signature. Since this is a unit test for the mapping logic, the tests can be kept compact.

### Step 3 — Refactor `schemaToTypeGraph.ts`

Similar change: accept `RustGraph` instead of SDL string. Map to the existing `TypeGraph` return shape.

```ts
import type { RustGraph } from "./core/types";

export function schemaToTypeGraph(rustGraph: RustGraph): TypeGraph {
  // RustGraphNode has { id (= typeName for type graph), label, subgraphs }
  // We need to infer TypeKind — the Rust side doesn't encode it in the DTO.
  // Options:
  //   a) Add a `kind` field to RustGraphNode in Rust
  //   b) Default all nodes to "object" kind (loses scalar/enum distinction)
  //   c) Encode kind in the label or id
  // Recommended: add `kind?: string` to RustGraphNode in dto.rs and types.ts
  //   so the Rust side can emit "object" | "interface" | "union" | "input" | "scalar" | "enum"

  const nodes: TypeGraphNode[] = rustGraph.nodes.map((n) => ({
    id: n.id,
    typeName: n.label,
    kind: (n.kind ?? "object") as TypeKind,
    subgraph: n.subgraphs[0] ?? null,
    subgraphs: n.subgraphs,
  }));

  const edges: TypeGraphEdge[] = rustGraph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    sourceType: e.source,
    targetType: e.target,
  }));

  return { nodes, edges, subgraphs: rustGraph.subgraphs };
}
```

**Coordination note:** The `kind` field is not in TASK-61.1's DTO spec. During execution, either:
- Add `kind: Option<String>` to `GraphNode` in `dto.rs` and emit it from `build_type_graph`, OR
- Accept a `kind: "object"` fallback for all nodes (the TypeGraph's scalar/enum toggle will be non-functional for type-graph nodes from Rust, but the graph still renders)

The former is strongly preferred. Coordinate with TASK-61.1 to add the `kind` field.

**Update the test** (`schemaToTypeGraph.test.ts`): Change from SDL-string input to `RustGraph` input.

### Step 4 — Update `TypeGraph.tsx`

The `TypeGraph` component currently takes `supergraphSdl: string` and calls `schemaToTypeGraph` internally. Change the prop to accept `RustGraph` directly:

```ts
export interface TypeGraphProps {
  typeGraph: RustGraph;
}
```

Update `TypeGraphInner` to accept and use `typeGraph: RustGraph` instead of parsing SDL. Remove the `schemaToTypeGraph(supergraphSdl)` calls inside the component; instead call `schemaToTypeGraph(typeGraph)` once.

### Step 5 — Update `App.tsx`

**For entity graph:**
```ts
// Before:
const entityGraph = useMemo(
  () => (compose?.ok ? schemaToEntityGraph(compose.supergraph_sdl) : null),
  [compose],
);

// After:
const entityGraph = useMemo(
  () => (compose?.ok && compose.entity_graph ? schemaToEntityGraph(compose.entity_graph) : null),
  [compose],
);
```

**For type graph (TypeGraph component):**
Change `typeGraphSdl` and `typeGraphContent` to pass `compose.type_graph` directly:

```ts
const typeGraphData = compose?.ok ? compose.type_graph ?? null : null;

const typeGraphContent = (
  <div className="scroll" style={{ height: "100%" }}>
    {typeGraphData === null ? (
      <p className="empty-state">Compose a valid supergraph to see the type graph.</p>
    ) : (
      <TypeGraph typeGraph={schemaToTypeGraph(typeGraphData)} />
    )}
  </div>
);
```

Or pass the `RustGraph` directly into `TypeGraph` if step 4 changes the prop type.

**Fallback handling:** If `entity_graph` or `type_graph` is absent from the compose result (e.g. an older WASM build), show the empty state rather than crashing. The `?.` optional chaining above handles this.

### Step 6 — Remove `graphql` imports

After the refactor, verify that neither `schemaToEntityGraph.ts` nor `schemaToTypeGraph.ts` imports from `"graphql"` (the graphql-js package). The `parse`, `Kind`, and related imports should be gone.

If `TypeGraph.tsx` still imports `schemaToTypeGraph` and calls it with a `RustGraph`, the `"graphql"` import is already removed from the utility file — no action needed in the component itself.

### Step 7 — Run quality gates

```sh
cd web && pnpm tsc --noEmit   # type-check
pnpm test run                  # unit tests
pnpm lint                      # eslint
```

### Files to change

- `web/src/core/types.ts` — add `RustGraphNode`, `RustGraphEdge`, `RustGraph`; update `ComposeResult`
- `web/src/schemaToEntityGraph.ts` — change signature from `(sdl: string)` to `(graph: RustGraph)`; update mapping
- `web/src/schemaToTypeGraph.ts` — change signature from `(sdl: string)` to `(graph: RustGraph)`; update mapping
- `web/src/TypeGraph.tsx` — update prop from `supergraphSdl: string` to pre-computed graph data
- `web/src/App.tsx` — pass `compose.entity_graph` / `compose.type_graph` to the utility functions
- `web/src/schemaToEntityGraph.test.ts` — update test inputs to `RustGraph` shape
- `web/src/schemaToTypeGraph.test.ts` — update test inputs to `RustGraph` shape

### Coordination note

TASK-61.1 should add `kind?: String` to `GraphNode` in dto.rs so the TypeGraph can preserve scalar/enum filtering. Confirm this during execution before writing the mapping code.
<!-- SECTION:PLAN:END -->
