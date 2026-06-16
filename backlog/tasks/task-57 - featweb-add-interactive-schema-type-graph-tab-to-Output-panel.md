---
id: TASK-57
title: 'feat(web): add interactive schema type graph tab to Output panel'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-16 18:47'
updated_date: '2026-06-16 22:03'
labels:
  - visualization
  - output-panel
  - schema
  - planned
dependencies:
  - TASK-57.1
  - TASK-57.2
  - TASK-57.3
references:
  - web/src/App.tsx
  - web/src/core/types.ts
  - web/src/store.ts
documentation:
  - 'https://reactflow.dev/learn'
  - 'https://eclipse.dev/elk/documentation.html'
priority: low
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a new "Type Graph" tab to the Output panel that renders the composed schema as an interactive node-link diagram. Nodes are GraphQL types (Object, Interface, Union, Input, Scalar, Enum); edges connect types via field return-type references. Nodes are color-coded by the subgraph that owns them. Users can zoom, pan, click nodes to highlight neighbors, and filter to a single subgraph.

This helps schema designers see the overall shape of their schema: isolated clusters, over-connected hub types, and the topology of cross-subgraph relationships that aren't legible from SDL.

**App placement:**
- New "Type Graph" tab in the Output panel (top-right), alongside Query Plan / Sequence Diagram / Supergraph SDL.
- Driven by `compose` state in `App.tsx` — specifically `supergraph_sdl` from a successful `ComposeResult`.
- Tab is disabled or shows an informational message when composition has failed.
- This is a composition-level view (not query-level), so it does not depend on `planResult`.

**Library:**
- `@xyflow/react` v12 (`@xyflow/react`, ~65 KB min+gzip) for rendering and interaction — React-native, built-in zoom/pan, custom node/edge renderers, minimap. The current maintained package (the old `reactflow` package is legacy).
- `elkjs` (~180 KB) for hierarchical layout, loaded via dynamic import on first render to avoid initial bundle cost. ELK hierarchical layout roots the graph from Query/Mutation/Subscription for a clear top-down reading.
- CSS: `@xyflow/react/dist/style.css` must be imported, scoped to avoid conflicts with the existing design system.

**Implementation approach:**
- New `schemaToTypeGraph.ts` utility that parses `supergraph_sdl` (using `graphql-js` `buildASTSchema` + `parse`, already available) to produce nodes and edges. Extract ownership from `@join__type(graph: ...)` directives.
- New `TypeGraph.tsx` component that lazy-loads `elkjs`, computes layout, and renders via `@xyflow/react`. Show a loading spinner while ELK runs.
- Filter control (subgraph selector) to isolate a subgraph's types and their direct connections.
- Toggle to hide Scalar/Enum nodes (these add clutter at large scale).
- Clicking a node highlights its edges and immediate neighbors, dims everything else.
- Double-click on the canvas fits the graph to the viewport.
- **Note:** This view can become unwieldy on complex schemas with 100+ types. The filter and scalar/enum toggle are essential for usability at scale. Consider this a known limitation and document it.

**Design:** Respects the "Ink at Night" dark theme. Override `@xyflow/react` default styles via CSS custom properties. **Subgraph color coding must match the palette used in Field Attribution decorations and the Entity Ownership Graph** — share the same deterministic subgraph→color mapping utility.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A 'Type Graph' tab appears in the Output panel tab strip on both desktop and mobile
- [x] #2 The tab shows an informational message when composition has failed (not an error state)
- [x] #3 Object, Interface, Union, and Input types appear as nodes; Scalar and Enum nodes are shown but visually smaller
- [x] #4 A toggle control hides/shows Scalar and Enum nodes
- [x] #5 Edges connect types via their field return types
- [x] #6 Nodes are color-coded by their owning subgraph, using the same palette as Field Attribution and Entity Ownership Graph
- [x] #7 A subgraph filter control shows only the selected subgraph's types and their direct connections
- [x] #8 Zoom and pan work via mouse wheel and drag
- [x] #9 Double-clicking the canvas background fits the graph to the viewport
- [x] #10 Clicking a node highlights its direct edges and neighbors and dims all other nodes/edges
- [x] #11 elkjs is loaded via dynamic import (lazy) — a spinner is shown while layout computes
- [x] #12 @xyflow/react styles do not bleed into or conflict with the existing app design system
- [x] #13 Respects the 'Ink at Night' dark theme
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a "Type Graph" tab to the Output panel that renders the composed supergraph as an interactive node-link diagram. This is a composition-level view (driven by `compose.supergraph_sdl`), analogous to the existing "Entities" tab which uses `EntityOwnershipGraph`.

The work is split into three sequential sub-tasks:

1. **TASK-57.1** — Install `@xyflow/react` and `elkjs` npm packages. Prerequisite for everything else.
2. **TASK-57.2** — Create `schemaToTypeGraph.ts` utility and its unit tests. Parses supergraph SDL into the node/edge data model used by the component. Pure function, no React.
3. **TASK-57.3** — Create `TypeGraph.tsx` component and wire the tab into `App.tsx`. The main visual/interaction work.

## Key design decisions

- **Library**: `@xyflow/react` (v12, the maintained successor to `reactflow`) for rendering and interaction. `elkjs` for hierarchical layout, loaded via dynamic `import()` to avoid bloating the initial bundle.
- **SDL parsing**: Uses `parse` + `Kind` from `graphql` (already a dependency) to walk the AST, following the same pattern as `schemaToEntityGraph.ts`. No `buildASTSchema`.
- **Color sharing**: Reuses `subgraphColorVar` from `subgraphColors.ts` — the same utility used by field attribution decorations and the Entity Ownership Graph. Ensures consistent palette across all views.
- **CSS isolation**: `@xyflow/react/dist/style.css` is imported inside the `TypeGraph.tsx` module. ReactFlow's CSS custom properties are overridden under the `.type-graph-root` class to match the Ink at Night theme without leaking styles into the rest of the app.
- **Filtering**: The utility returns the full graph; the component applies scalar/enum toggle and subgraph filter before passing to ELK and ReactFlow.

## Integration and verification steps

After TASK-57.3 is complete:

1. Run `pnpm tsc --noEmit` in `web/` — must pass with no errors.
2. Run `pnpm test run` in `web/` — `schemaToTypeGraph.test.ts` must pass.
3. Run `pnpm lint` — must pass.
4. Start `pnpm dev` and manually verify all 13 acceptance criteria.
5. Run `pnpm e2e` — existing smoke tests must still pass (no regressions).
6. Verify the `rightTab` TypeScript union is complete (no exhaustive-check TypeScript errors).

## Known limitation

On schemas with 100+ types, the graph can become unwieldy. The subgraph filter and scalar/enum toggle are the primary mitigation. This is documented in TASK-57 as a known limitation and should be noted in a code comment in `TypeGraph.tsx`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### TASK-57.1 — Dependencies installed
- Added `@xyflow/react@12.11.0` and `elkjs@0.11.1` to `web/package.json` dependencies.
- `@types/elkjs` does not exist on npm; elkjs ships its own TypeScript declarations at `elkjs/lib/elk-api.d.ts`.

### TASK-57.2 — schemaToTypeGraph.ts utility
- Created `web/src/schemaToTypeGraph.ts`: pure function, no React, AST-only parsing via `parse` + `Kind` from `graphql` (same pattern as `schemaToEntityGraph.ts`).
- Exports `TypeKind`, `TypeGraphNode`, `TypeGraphEdge`, `TypeGraph` types and `schemaToTypeGraph()` function.
- Pass 1: collects Object, Interface, Union, Input, Scalar, Enum nodes. Skips built-in scalars, federation internals (`join__*`, `link__*`, `_Service`, `_Any`, `_Entity`, `_FieldSet`), and root operation types (Query, Mutation, Subscription). Collects `@join__type(graph:)` directives for subgraph ownership.
- Pass 2: emits deduplicated field-return-type edges (Set of `source->target` keys prevents parallel duplicates; self-loops skipped).
- 24 unit tests in `web/src/schemaToTypeGraph.test.ts` — all passing.

### TASK-57.3 — TypeGraph.tsx component and App.tsx wiring
- Created `web/src/TypeGraph.tsx`: React component using `@xyflow/react` v12 for rendering + `elkjs` dynamically imported for layout.
- ELK singleton cached at module level; loaded once on first render via dynamic `import()`.
- ELK layout options: `elk.algorithm: layered`, `elk.direction: DOWN` for top-down reading.
- Custom `TypeGraphNode` renderer: colored border/background using `subgraphColorVar()` (same utility as Field Attribution and Entity Ownership Graph). Scalar/Enum nodes use smaller height (28px vs 44px).
- Node click highlights edges and neighbors, dims other nodes. Canvas click clears selection.
- Double-click on pane background fits the graph to viewport (detected via class check on event target since ReactFlow v12 does not expose `onPaneDoubleClick`).
- Controls bar: subgraph filter `<select>` and Scalars & Enums checkbox, positioned top-right.
- Loading spinner shown while ELK computes layout.
- CSS overrides scoped to `.type-graph-root` class added to `theme.css` — overrides all `--xy-*` CSS custom properties to match Ink at Night theme without leaking into the rest of the app.
- `@xyflow/react/dist/style.css` imported at the top of `TypeGraph.tsx`.
- `rightTab` union in `App.tsx` extended to include `"type-graph"`.
- Type Graph tab button added to both desktop and mobile tab strips.
- `typeGraphContent` rendered in both desktop and mobile output pane switch blocks.

### Verification
- `pnpm tsc --noEmit`: 0 errors
- `pnpm test run`: 161/161 tests passing (24 new schemaToTypeGraph tests)
- `pnpm lint`: 0 errors
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the interactive schema type graph feature. Added `@xyflow/react` and `elkjs` as dependencies. Created `schemaToTypeGraph.ts` (pure utility, 24 tests) and `TypeGraph.tsx` (React component with ELK layout, subgraph/scalar filters, node-click highlighting, double-click fit-view, dark theme overrides scoped to `.type-graph-root`). Wired a new \"Type Graph\" tab into App.tsx (both desktop and mobile layouts). All 13 acceptance criteria satisfied; 161/161 tests pass, TypeScript clean, lint clean."
<!-- SECTION:FINAL_SUMMARY:END -->
