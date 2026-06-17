---
id: TASK-60
title: 'feat(web): add schema containment hierarchy tree tab to output panel'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-17 03:24'
updated_date: '2026-06-17 11:10'
labels:
  - visualization
  - schema
  - web
  - planned
dependencies: []
priority: medium
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Add a new "Schema Tree" (or "Type Hierarchy") tab to the output panel that visualizes the GraphQL schema as a collapsible containment/nesting tree rooted at `Query`, `Mutation`, and `Subscription`.

Unlike the existing schema type graph (which shows connectivity), this view emphasizes **depth and containment** — how types nest inside each other when you traverse the graph. This is useful for:

- Understanding data hierarchy before writing a query (e.g. `Order → LineItem → Product → Variant`)
- SDUI schemas where component nesting maps directly to page structure
- Any schema where you want to understand traversal paths and depth

## Design

### Tree Structure

- Root nodes: `Query`, `Mutation`, `Subscription` entry points
- Each node is a field; its children are the fields of its return type
- Only expand **object/interface/union** types as children — scalar fields are leaves
- Show the field name and return type on each node
- Collapsible/expandable nodes

### Cycle Handling

Schemas commonly have cycles (e.g. `User → friends → [User]`). When a type is encountered that is already an ancestor in the current path, render it as a **reference leaf** (e.g. `→ User (see above)`) rather than expanding it again. This prevents infinite recursion while still communicating the relationship exists.

Types already seen elsewhere in the tree (but not in the current ancestor chain) can optionally be collapsed by default but still expandable.

### Display Details

- Indicate list fields visually (e.g. `[LineItem]` vs `LineItem`)
- Indicate nullable vs non-null fields (e.g. with `?` suffix or muted styling)
- Union/interface slots should show all possible concrete types as expandable children
- Arguments on fields can be shown on hover or as a secondary line

## Implementation Notes

- The existing schema type graph tab (`web/src/`) is a good reference for how schema introspection data is accessed
- Consider reusing tree-rendering patterns from the execution timeline if applicable
- The tree can be built lazily (expand on click) to avoid rendering the full schema up front for large schemas
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new tab appears in the output panel showing the schema containment tree
- [x] #2 Tree is rooted at Query/Mutation/Subscription entry points
- [x] #3 Nodes are collapsible and expandable
- [x] #4 Cycles are detected and rendered as reference leaves rather than infinitely expanding
- [x] #5 List fields are visually distinguished from singular fields
- [x] #6 Nullable fields are visually distinguished from non-null fields
- [x] #7 Union/interface slots show all possible concrete types as children
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a "Schema Tree" tab to the output panel that visualizes the GraphQL schema as a collapsible containment/nesting tree rooted at Query, Mutation, and Subscription. The tree emphasizes depth and traversal paths rather than type connectivity (which the existing Type Graph tab already shows).

The implementation follows the established three-file pattern used by every other visualization tab:
1. `schemaToSchemaTree.ts` — pure parsing function (supergraph SDL → typed tree data model)
2. `SchemaTree.tsx` — React component rendering the collapsible tree
3. `schemaToSchemaTree.test.ts` — unit tests for the parsing logic
4. Wire into `App.tsx` alongside the other tabs

No new dependencies are needed. Tree rendering uses plain React with `useState` for expand/collapse — no ReactFlow or ELK required since this is a containment tree, not a force-directed graph.

---

## File 1: `web/src/schemaToSchemaTree.ts`

### Data model

```ts
export interface SchemaTreeField {
  fieldName: string;
  typeName: string;       // unwrapped named type
  isList: boolean;        // true if the return type is wrapped in List at any level
  isNonNull: boolean;     // true if the outermost wrapper is NonNull
  isLeaf: boolean;        // true if the return type is scalar/enum (no children to expand)
  isCycleRef: boolean;    // true when this type is already an ancestor in the current path
  children: SchemaTreeField[];   // populated eagerly for non-cycle, non-leaf nodes
}

export interface SchemaTreeNode {
  rootTypeName: "Query" | "Mutation" | "Subscription";
  fields: SchemaTreeField[];   // top-level fields on the root type
}

export interface SchemaTree {
  roots: SchemaTreeNode[];   // one entry per root type that exists in the schema
}
```

### Algorithm

**Pass 1:** Parse the SDL with `parse()` from the `graphql` package. Collect:
- All type definitions into a `typeMap: Map<string, TypeDef>` where `TypeDef` stores the kind (object/interface/union/scalar/enum) and the fields/members list.
- Root operation type names (Query, Mutation, Subscription) — these are the tree roots.

**Pass 2:** For each root type that exists in the schema, walk its fields recursively with an `ancestorPath: Set<string>` to detect cycles.

For each field:
- Unwrap List/NonNull wrappers to get the named type; record `isList` and `isNonNull` flags.
- Look up the named type in `typeMap`.
- If the type is scalar or enum → `isLeaf: true`, `children: []`.
- If the type name is in `ancestorPath` → `isCycleRef: true`, `children: []` (reference leaf).
- Otherwise → recurse: add the type to `ancestorPath`, collect its fields as children, then remove it (backtracking).
- For union types → each concrete member type becomes a child field with `fieldName` rendered as `"… on MemberType"`.
- For interface types → treat like an object type (fields are the interface's own fields).

Filter out federation-internal types (same `isFederationInternal()` guard as in `schemaToTypeGraph.ts`).

Return `{ roots }` — empty roots array if SDL is invalid or has no root types.

### Key design decisions
- The tree is built **eagerly** (full structure computed upfront). Lazy expansion is deferred to the render layer via `useState`. For very large schemas this avoids re-parsing on every expand but keeps the component stateless w.r.t. schema data.
- Types seen in ancestor chain → cycle ref. Types seen elsewhere in the tree but not in ancestor chain → normal node (expandable), consistent with the ticket's spec ("optionally collapsed by default but still expandable" — they just start closed by default in the component).

---

## File 2: `web/src/SchemaTree.tsx`

### Component interface

```tsx
export interface SchemaTreeProps {
  supergraphSdl: string;
}

export function SchemaTree({ supergraphSdl }: SchemaTreeProps) { ... }
```

Internally calls `schemaToSchemaTree(supergraphSdl)` with `useMemo`.

### Rendering

A recursive `FieldNode` sub-component renders each `SchemaTreeField`:

- Indented with a toggle button (▶ / ▼) for expandable nodes.
- Expanded state tracked with `useState<boolean>` per node, defaulting:
  - `true` for root-type fields (Query/Mutation/Subscription fields start open).
  - `false` for deeper nodes (lazy visual expansion, even though data is pre-computed).
- Display format per field:
  - `fieldName: [TypeName]` for list fields, `fieldName: TypeName` for singular.
  - `fieldName: TypeName!` or `fieldName: [TypeName]!` with `!` when non-null (or use muted `?` suffix for nullable fields — see ticket spec).
  - Cycle ref leaves: `fieldName: → TypeName (↑ cycle)` in muted/italic styling.
  - Leaf scalars: `fieldName: TypeName` in muted color (no toggle button).
  - Union member children: `… on MemberType` in italic.
- Styling uses CSS custom properties from `theme.css` (no new tokens needed):
  - `var(--text)` for field names, `var(--text-muted)` for type names and secondary info.
  - `var(--accent)` for root type headers (Query / Mutation / Subscription).
  - `var(--font-mono)` for field name + type rendering.
  - `var(--surface-2)` / `var(--border)` for hover row highlight.
- Each root type (Query, Mutation, Subscription) is rendered as a section header in accent color, always expanded.

No ReactFlow, no ELK, no canvas. Pure React + HTML/CSS tree.

Empty state: `<p className="empty-state">Compose a valid supergraph to see the schema tree.</p>` (matches other tabs).

---

## File 3: `web/src/schemaToSchemaTree.test.ts`

Tests to cover (following the established pattern in `schemaToTypeGraph.test.ts`):

1. Returns `{ roots: [] }` for invalid/empty SDL.
2. Query root type produces a `SchemaTreeNode` with `rootTypeName: "Query"`.
3. Scalar return fields are marked `isLeaf: true` with no children.
4. Object return type fields produce children (nested fields).
5. List fields set `isList: true`.
6. Non-null fields set `isNonNull: true`.
7. Cycle in ancestor path produces `isCycleRef: true`, no children.
8. Non-ancestor repeated type (seen in sibling branch) is NOT a cycle ref.
9. Union members appear as children with `fieldName` prefixed with `"… on "`.
10. Federation internal types are excluded from children.
11. Missing root types (no Mutation) are omitted from `roots`.

---

## File 4: Wiring in `App.tsx`

### State

Extend the `rightTab` union type:
```ts
"sdl" | "plan" | "sequence" | "timeline" | "entities" | "type-graph" | "schema-tree" | "results"
```

Extend `fullscreenTab` union type:
```ts
"sequence" | "timeline" | "entities" | "type-graph" | "schema-tree" | null
```

Add to `VISUAL_TAB_LABELS`:
```ts
"schema-tree": "Schema Tree",
```

### Content variable

```tsx
const schemaTreeContent = (
  <div className="scroll">
    {typeGraphSdl === null ? (
      <p className="empty-state">Compose a valid supergraph to see the schema tree.</p>
    ) : (
      <SchemaTree supergraphSdl={typeGraphSdl} />
    )}
  </div>
);
```

Note: `typeGraphSdl` is already computed as `compose?.ok ? compose.supergraph_sdl : null` — reuse it.

### Tab buttons

Add after the "Type Graph" tab button in both the desktop tab strip and the mobile output tab strip:
```tsx
<button
  onClick={() => setRightTab("schema-tree")}
  aria-pressed={rightTab === "schema-tree"}
  className={rightTab === "schema-tree" ? "tab is-active" : "tab"}
>
  Schema Tree
</button>
```

### Conditional render

Add in the `compositionErrorContent ??` block:
```tsx
{rightTab === "schema-tree" && schemaTreeContent}
```

Add to fullscreen modal body:
```tsx
{fullscreenTab === "schema-tree" && schemaTreeContent}
```

Update the fullscreen button visibility guard to also match `"schema-tree"`.

### Import

```tsx
import { SchemaTree } from "./SchemaTree";
```

---

## Acceptance Criteria Mapping

1. Tab appears in output panel → wiring in App.tsx adds the tab button ✓
2. Tree rooted at Query/Mutation/Subscription → `SchemaTreeNode` per root type ✓
3. Nodes collapsible/expandable → `useState` per `FieldNode` ✓
4. Cycles → `isCycleRef: true` rendered as reference leaf ✓
5. List fields visually distinguished → `[TypeName]` bracket notation ✓
6. Nullable vs non-null → `?` suffix or `!` suffix ✓
7. Union/interface slots show concrete types as children → union members as `… on T` children ✓

---

## Testing

Run `pnpm test run schemaToSchemaTree` after implementing the parsing module to verify unit tests pass before wiring into App.

Run `pnpm tsc --noEmit` to verify no TypeScript errors across the changed files.

No Playwright e2e tests are required for this ticket (tab wiring is consistent with existing tabs that are not separately e2e-tested).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete.

Files created:
- web/src/schemaToSchemaTree.ts — pure parsing function; builds eager tree from supergraph SDL with cycle detection via ancestor path set
- web/src/SchemaTree.tsx — React component with recursive FieldNode; expand/collapse via useState; union members rendered as '… on Type' children
- web/src/schemaToSchemaTree.test.ts — 24 unit tests covering all spec scenarios

Files modified:
- web/src/App.tsx — imported SchemaTree; extended rightTab and fullscreenTab union types; added schemaTreeContent variable; added 'Schema Tree' tab button in desktop and mobile tab strips; added conditional renders in compositionErrorContent blocks and fullscreen modal
- web/src/theme.css — added .schema-tree component styles using existing theme tokens

All 205 tests pass; TypeScript reports no errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a new 'Schema Tree' tab to the output panel that visualizes the GraphQL schema as a collapsible containment/nesting tree rooted at Query, Mutation, and Subscription. Created schemaToSchemaTree.ts (pure parsing function with eager tree construction and ancestor-path-based cycle detection), SchemaTree.tsx (recursive React component with per-node expand/collapse via useState, union members as '… on Type' children, list/nullable/non-null visual distinction), and 24 unit tests. Wired the tab into App.tsx alongside existing tabs including fullscreen support. Styled using existing theme.css tokens."
<!-- SECTION:FINAL_SUMMARY:END -->
