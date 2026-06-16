---
id: TASK-57.2
title: >-
  Add schemaToTypeGraph.ts utility — parse supergraph SDL into type graph
  nodes/edges
status: Done
assignee: []
created_date: '2026-06-16 21:53'
updated_date: '2026-06-16 22:02'
labels:
  - task
dependencies:
  - TASK-57.1
references:
  - web/src/schemaToEntityGraph.ts
  - web/src/schemaToEntityGraph.test.ts
  - web/src/subgraphColors.ts
documentation:
  - 'https://graphql.org/graphql-js/'
  - 'https://reactflow.dev/learn'
parent_task_id: TASK-57
priority: high
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `web/src/schemaToTypeGraph.ts` — a pure utility (no React) that parses a supergraph SDL string into the node/edge data model consumed by the TypeGraph component.\n\nThis is the data layer for TASK-57. It must be unit-tested in a companion `schemaToTypeGraph.test.ts` file, following the exact same pattern as `schemaToEntityGraph.ts` and its test.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Data model

Export these types from `schemaToTypeGraph.ts`:

```ts
export type TypeKind = "object" | "interface" | "union" | "input" | "scalar" | "enum";

export interface TypeGraphNode {
  /** Unique id — the type name (e.g. "User"). */
  id: string;
  typeName: string;
  kind: TypeKind;
  /** Primary owning subgraph name (first @join__type(graph:) directive, uppercased enum value). */
  subgraph: string | null;
  /** All subgraphs that declare this type (for types shared across subgraphs). */
  subgraphs: string[];
}

export interface TypeGraphEdge {
  /** Unique id, e.g. "User->Review". */
  id: string;
  sourceType: string;  // typeName of field owner
  targetType: string;  // typeName of return type
}

export interface TypeGraph {
  nodes: TypeGraphNode[];
  edges: TypeGraphEdge[];
  /** Sorted unique subgraph names. */
  subgraphs: string[];
}
```

## Parsing logic

Use `parse` + `Kind` from `graphql` (already in package.json). Do NOT use `buildASTSchema` — walk the AST directly as `schemaToEntityGraph.ts` does.

**Pass 1 — collect all named types:**
Walk all definition kinds:
- `ObjectTypeDefinition` / `ObjectTypeExtension` → kind `"object"` (skip `Query`, `Mutation`, `Subscription` — these are operation roots, not domain types; skip federation internal types like `_Service`, `_Any`, types starting with `join__` or `link__`)
- `InterfaceTypeDefinition` → kind `"interface"`
- `UnionTypeDefinition` → kind `"union"`
- `InputObjectTypeDefinition` → kind `"input"`
- `ScalarTypeDefinition` → kind `"scalar"` (skip built-in scalars: `String`, `Boolean`, `Int`, `Float`, `ID`)
- `EnumTypeDefinition` → kind `"enum"` (skip `join__Graph` and built-in enums)

For each type, collect `@join__type(graph: ...)` directive values to populate `subgraph` (first seen) and `subgraphs` (all seen). Types with no `@join__type` directive get `subgraph: null`.

**Pass 2 — collect field edges:**
Walk `ObjectTypeDefinition`, `ObjectTypeExtension`, `InterfaceTypeDefinition`, and `InputObjectTypeDefinition`. For each field, unwrap NonNull/List to get the named return type. If both the field-owner type and the return type exist as nodes (and they differ), emit an edge. Use a Set to deduplicate `"sourceType->targetType"` edges.

## Filtering conventions (consumed by component, not applied here)

The utility returns the full unfiltered graph. The `TypeGraph.tsx` component applies:
- Show/hide of Scalar and Enum nodes (and edges to/from them)
- Subgraph filter

## Tests (`schemaToTypeGraph.test.ts`)

Follow the pattern of `schemaToEntityGraph.test.ts`. Cover:
1. Empty/invalid SDL → `{ nodes: [], edges: [], subgraphs: [] }`
2. Single object type with @join__type → correct node with kind and subgraph
3. Field edge between two object types
4. Scalar/Enum nodes included with correct kind
5. Built-in scalars and federation internal types excluded
6. `Query`/`Mutation`/`Subscription` root types excluded from nodes
<!-- SECTION:PLAN:END -->
