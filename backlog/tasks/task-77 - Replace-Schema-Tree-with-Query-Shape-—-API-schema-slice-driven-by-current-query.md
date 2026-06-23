---
id: TASK-77
title: >-
  Replace Schema Tree with Query Shape — API schema slice driven by current
  query
status: To Do
assignee: []
created_date: '2026-06-23 02:01'
labels:
  - web
  - ux
dependencies: []
priority: medium
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The current "Schema Tree" tab shows the full supergraph schema as a collapsible tree rooted at Query/Mutation/Subscription. This is useful for exploration but doesn't answer the more practical question: "what shape does my current query return?"

Replace it with a "Query Shape" view that shows only the slice of the API schema that the active query selects — a page-hierarchy view of the response structure.

## Design decisions (settled in brainstorm)

- **Source**: `compose.api_schema_sdl` (not supergraph SDL — no Federation internals) + `currentQuery`
- **Empty state**: When there's no query or the query is invalid, show "Write a query to see its shape." Nothing else.
- **Labels**: `fieldName: TypeAnnotation` (e.g. `products: [Product]!`) — same format as current Schema Tree
- **Expand/collapse**: Nodes start **collapsed** by default, same as current Schema Tree
- **Fragments**: Named fragments collected in a first pass and inlined at use sites; inline fragments (`... on User`) render as `… on User` nodes
- **Root header**: Operation kind + name, e.g. `query GetProducts` or `query` if unnamed
- **Tab**: Rename label from "Schema Tree" → "Query Shape"; keep tab key `"schema-tree"` to avoid state churn
- **Cycle detection**: Not needed — query documents are DAGs

## Files to create/change

| File | Change |
|---|---|
| `web/src/queryToQueryShape.ts` | New — parse query + API schema SDL, build `QueryShapeTree` |
| `web/src/queryToQueryShape.test.ts` | New — unit tests |
| `web/src/QueryShape.tsx` | New — renders the shape tree |
| `web/src/SchemaTree.tsx` | Export `FieldNode` / `RootNode` for reuse, OR `QueryShape.tsx` inlines its own copies |
| `web/src/App.tsx` | Tab label → "Query Shape"; pass `api_schema_sdl` + `currentQuery`; render `<QueryShape>` |

## Reuse

`SchemaTreeField` / `SchemaTreeNode` types from `schemaToSchemaTree.ts` can be reused as-is for the data model — the tree shape is identical, only the builder logic differs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tab label in the right panel reads "Query Shape" (was "Schema Tree")
- [ ] #2 When no query is written or the query is invalid, the tab shows only: "Write a query to see its shape."
- [ ] #3 When a valid query is present, the tree shows only the fields the query selects — not the full schema
- [ ] #4 Each node is labeled `fieldName: TypeAnnotation` (e.g. `products: [Product]!`)
- [ ] #5 Root section header shows the operation kind and name (e.g. `query GetProducts`; or `query` if unnamed)
- [ ] #6 Nodes start collapsed; clicking the toggle expands children
- [ ] #7 Named fragments are inlined at their use sites
- [ ] #8 Inline fragments (`... on TypeName`) appear as `… on TypeName` nodes
- [ ] #9 The view uses the API schema SDL (no Federation-internal types), not the supergraph SDL
- [ ] #10 Unit tests in `queryToQueryShape.test.ts` cover: basic field selection, nested selection sets, named fragment inlining, inline fragments, lists and non-null types, invalid/empty query returns empty tree
<!-- AC:END -->
