---
id: TASK-77
title: >-
  Replace Schema Tree with Query Shape — API schema slice driven by current
  query
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 02:01'
updated_date: '2026-06-23 03:20'
labels:
  - web
  - ux
  - planned
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
- [x] #1 Tab label in the right panel reads "Query Shape" (was "Schema Tree")
- [x] #2 When no query is written or the query is invalid, the tab shows only: "Write a query to see its shape."
- [x] #3 When a valid query is present, the tree shows only the fields the query selects — not the full schema
- [x] #4 Each node is labeled `fieldName: TypeAnnotation` (e.g. `products: [Product]!`)
- [x] #5 Root section header shows the operation kind and name (e.g. `query GetProducts`; or `query` if unnamed)
- [x] #6 Nodes start collapsed; clicking the toggle expands children
- [x] #7 Named fragments are inlined at their use sites
- [x] #8 Inline fragments (`... on TypeName`) appear as `… on TypeName` nodes
- [x] #9 The view uses the API schema SDL (no Federation-internal types), not the supergraph SDL
- [x] #10 Unit tests in `queryToQueryShape.test.ts` cover: basic field selection, nested selection sets, named fragment inlining, inline fragments, lists and non-null types, invalid/empty query returns empty tree
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Replace the existing "Schema Tree" tab (which shows the full schema regardless of any query) with a "Query Shape" view that reflects only the slice of the API schema selected by the active query. No sub-tickets are needed — all changes are tightly coupled and ship together as a single focused session.

---

## Implementation

### 1. New file: `web/src/queryToQueryShape.ts`

Pure data-transformation module: parse a query document + API schema SDL, return a `QueryShapeTree` (same shape as `SchemaTree` but with different semantics for the root).

**Data model**

```ts
export interface QueryShapeOperation {
  /** e.g. "query GetProducts" or "query" */
  header: string;
  /** Top-level selected fields — same SchemaTreeField nodes reused as-is. */
  fields: SchemaTreeField[];
}

export interface QueryShapeTree {
  /** One entry per operation definition in the document. Normally just one. */
  operations: QueryShapeOperation[];
}
```

`SchemaTreeField` and its helpers (`typeFlags`, `namedTypeName`) from `schemaToSchemaTree.ts` are reused directly — import them and the `SchemaTree*` types from that module.

**Algorithm (`queryToQueryShape(apiSchemaSdl, query)`):**

1. Parse `apiSchemaSdl` with `parse()` → build a `typeMap: Map<string, TypeInfo>` (same two-pass approach as `schemaToSchemaTree.ts`'s pass 1 — extract only `ObjectTypeDefinition`, `InterfaceTypeDefinition`, `UnionTypeDefinition`, `ScalarTypeDefinition`, `EnumTypeDefinition`; no Federation filtering needed since the source is `api_schema_sdl`). Also record root operation type fields.
2. Parse `query` with `parse()`. On failure or empty string → return `{ operations: [] }`.
3. **Fragment collection pass** — scan all `FragmentDefinition` nodes into a `Map<string, FragmentDefinitionNode>` for O(1) inline lookup at use sites.
4. For each `OperationDefinitionNode` in the document:
   a. Determine root type name (`query` → `"Query"`, `mutation` → `"Mutation"`, `subscription` → `"Subscription"`).
   b. Build `header` string: `${operationKind} ${operationName}` (e.g. `"query GetProducts"`) or just `${operationKind}` if unnamed.
   c. Walk the selection set recursively → produce `SchemaTreeField[]`.
5. Return `{ operations }`.

**Recursive selection walker (`buildShapeFields`):**

Receives `(selectionSet, parentTypeName, typeMap, fragmentMap)`.

For each selection:

- **`FieldNode`**: look up the field's return type from `typeMap.get(parentTypeName)`. Compute `isList`, `isNonNull`, `isLeaf`, `typeName` using the same helpers from `schemaToSchemaTree.ts`. Recurse into the field's own `selectionSet` (if present and the type is non-leaf) with the field's `typeName` as the new `parentTypeName`. No cycle detection needed (query documents are DAGs — cycles in query selection would make the GraphQL spec reject the operation).
- **`FragmentSpreadNode`**: look up the `FragmentDefinition` by name in `fragmentMap`, then recurse into its `selectionSet` with the fragment's `typeCondition.name.value` as `parentTypeName`. The fragment's fields are **inlined** (no wrapper node) — exactly as if they were written inline.
- **`InlineFragmentNode`**: emit a `SchemaTreeField` node with `fieldName: "… on <TypeName>"` (or `"… on <ParentType>"` if no type condition), `typeName` set to the condition type, `isLeaf: false`, `isCycleRef: false`, `isList: false`, `isNonNull: false`. Children are produced by recursing into the inline fragment's `selectionSet` with the condition type as `parentTypeName`.

**Edge cases:**
- If the field name is not found in `typeMap.get(parentTypeName)` (e.g. introspection `__typename`), emit a leaf node with `typeName: "__typename"`, `isLeaf: true`, no children.
- If `apiSchemaSdl` or `query` fails to parse → return `{ operations: [] }`.
- Empty query string → return `{ operations: [] }`.

---

### 2. New file: `web/src/queryToQueryShape.test.ts`

Unit tests using vitest. Cover all 10 scenarios from acceptance criteria #10:

1. Basic field selection — single scalar field
2. Nested selection sets — object field with children
3. Named fragment inlining — fields from a named fragment appear as siblings
4. Inline fragments — appear as `… on TypeName` nodes with children
5. Lists and non-null types — `isList`/`isNonNull` flags correct
6. Invalid SDL → `{ operations: [] }`
7. Empty query string → `{ operations: [] }`
8. Invalid query document → `{ operations: [] }`
9. Operation header — named operation uses `query GetProducts`; unnamed uses `query`
10. Multiple operations — each produces a separate `QueryShapeOperation`

Test pattern mirrors `schemaToSchemaTree.test.ts`: SDL builder helpers at the top, `describe` blocks per concern.

---

### 3. New file: `web/src/QueryShape.tsx`

React component that renders a `QueryShapeTree`.

```tsx
export interface QueryShapeProps {
  apiSchemaSdl: string;
  query: string;
}
```

- Uses `useMemo(() => queryToQueryShape(apiSchemaSdl, query), [apiSchemaSdl, query])`.
- **Empty state** (when `tree.operations.length === 0`): render `<p className="empty-state">Write a query to see its shape.</p>`.
- For each operation: render a `<section className="schema-tree__root">` with `<h3 className="schema-tree__root-header">{op.header}</h3>` and a `<ul>` of field nodes.
- **Reuse `FieldNode`** from `SchemaTree.tsx` — export it from `SchemaTree.tsx` and import it in `QueryShape.tsx`. This avoids duplicating the expand/collapse, type-label, and CSS logic. (The `FieldNode` props type can also be exported from `SchemaTree.tsx`.)
- Nodes start collapsed by default (`defaultExpanded={false}`) — consistent with the ticket spec and the current `SchemaTree` behavior for non-root fields.
- Inline fragment nodes (`fieldName.startsWith("… on ")`) are rendered by `FieldNode` exactly as union members are today — the CSS class `schema-tree__field-name--union-member` already handles this styling.

---

### 4. Modify `web/src/SchemaTree.tsx`

Export `FieldNode` and `FieldNodeProps` so `QueryShape.tsx` can reuse them:

```ts
// Add export keyword:
export interface FieldNodeProps { ... }
export function FieldNode(...) { ... }
```

No other changes to `SchemaTree.tsx` or its behavior.

---

### 5. Modify `web/src/App.tsx`

**a. Track `api_schema_sdl`** — the compose result already includes it. Derive it alongside the existing `supergraphSdlForTree`:

```ts
// Replace:
const supergraphSdlForTree = compose?.ok ? compose.supergraph_sdl : null;

// With:
const supergraphSdlForTree = compose?.ok ? compose.supergraph_sdl : null;
const apiSchemaSdlForShape = compose?.ok ? compose.api_schema_sdl : null;
```

**b. Replace `schemaTreeContent`** — instead of rendering `<SchemaTree supergraphSdl={...}>`, render `<QueryShape apiSchemaSdl={...} query={currentQuery}>`. The `QueryShape` component handles its own empty state, so the outer null guard can simplify:

```tsx
const queryShapeContent = (
  <div className="scroll">
    <QueryShape
      apiSchemaSdl={apiSchemaSdlForShape ?? ""}
      query={currentQuery}
    />
  </div>
);
```

(When `apiSchemaSdlForShape` is null, the empty string causes `queryToQueryShape` to return `{ operations: [] }`, which renders the empty state — clean and no conditional needed.)

**c. Rename tab labels** — change every occurrence of `"Schema Tree"` button text to `"Query Shape"`. The tab key `"schema-tree"` is preserved as specified. Locations in `App.tsx`:
- Desktop results tab strip (line ~1524)
- Mobile results tab strip (line ~1283)
- `VISUAL_TAB_LABELS` record (line ~1374)

**d. Replace render references** — change every `{resultsTab === "schema-tree" && schemaTreeContent}` to `{resultsTab === "schema-tree" && queryShapeContent}` (two occurrences: desktop and mobile). Same for the fullscreen modal.

**e. Add import** — add `import { QueryShape } from "./QueryShape";` at the top. Remove `import { SchemaTree } from "./SchemaTree";` if `SchemaTree` is no longer referenced in `App.tsx` (it won't be after this change).

---

## Execution order

1. Create `queryToQueryShape.ts` (logic)
2. Create `queryToQueryShape.test.ts` (tests — run `pnpm test run queryToQueryShape` to validate)
3. Export `FieldNode`/`FieldNodeProps` from `SchemaTree.tsx`
4. Create `QueryShape.tsx` (renders the tree from step 1 using the FieldNode from step 3)
5. Update `App.tsx` (wire up the new component, rename tab labels)
6. Run `pnpm test run` (full unit test suite)
7. Run `pnpm tsc --noEmit` (typecheck)
8. Run `pnpm lint` (ESLint)

---

## Files changed

| File | Action |
|---|---|
| `web/src/queryToQueryShape.ts` | Create |
| `web/src/queryToQueryShape.test.ts` | Create |
| `web/src/QueryShape.tsx` | Create |
| `web/src/SchemaTree.tsx` | Export `FieldNode` + `FieldNodeProps` |
| `web/src/App.tsx` | Wire `QueryShape`, rename labels, track `api_schema_sdl` |

---

## Risks / notes

- **`api_schema_sdl` vs `supergraph_sdl`**: The API schema strips Federation-internal directives and types. No need to filter them in `queryToQueryShape.ts` — the source is already clean.
- **`__typename` fields**: Common in queries. They will not be found in `typeMap` since `__typename` is an implicit introspection field. Emit as leaf nodes gracefully.
- **No cycle detection**: Query documents cannot have cycles (the GraphQL spec disallows selection on a scalar/leaf without stopping recursion). The `selectionSet` will be undefined on leaf fields, which naturally terminates recursion.
- **`SchemaTree` is unused in `App.tsx` after this change** but remains in the codebase — it is still accurate and may be useful for tours or other purposes. Do not delete it.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation followed the plan exactly.

- Created `web/src/queryToQueryShape.ts`: pure data-transformation module that parses a query document + API schema SDL and returns a `QueryShapeTree`. Reuses `SchemaTreeField` type from `schemaToSchemaTree.ts`. Handles named fragment inlining (flat), inline fragments as `… on TypeName` nodes, __typename as leaf, and empty/invalid inputs gracefully.
- Created `web/src/queryToQueryShape.test.ts`: 22 unit tests covering all 10 scenarios from AC#10.
- Exported `FieldNodeProps` and `FieldNode` from `SchemaTree.tsx` for reuse.
- Created `web/src/QueryShape.tsx`: renders a `QueryShapeTree` using the exported `FieldNode`. Empty state shows "Write a query to see its shape." when no operations are present.
- Updated `App.tsx`: replaced `SchemaTree` import with `QueryShape`; added `apiSchemaSdlForShape` derived from `compose.api_schema_sdl`; replaced `schemaTreeContent` with `queryShapeContent`; renamed tab labels from "Schema Tree" to "Query Shape" in mobile strip, desktop strip, and `VISUAL_TAB_LABELS`. Tab key `schema-tree` preserved.

All 298 tests pass; no TypeScript errors; no ESLint errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the \"Schema Tree\" tab with a \"Query Shape\" view that shows only the API schema slice selected by the active query. Created `queryToQueryShape.ts` (pure data-transform), `queryToQueryShape.test.ts` (22 unit tests), and `QueryShape.tsx` (React component reusing `FieldNode` from `SchemaTree.tsx`). Updated `App.tsx` to wire the new component using `compose.api_schema_sdl` and renamed all tab labels from \"Schema Tree\" to \"Query Shape\" while preserving the `schema-tree` tab key. All 298 tests pass with no TypeScript or ESLint errors."
<!-- SECTION:FINAL_SUMMARY:END -->
