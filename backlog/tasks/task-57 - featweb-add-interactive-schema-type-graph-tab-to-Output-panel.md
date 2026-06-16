---
id: TASK-57
title: 'feat(web): add interactive schema type graph tab to Output panel'
status: To Do
assignee: []
created_date: '2026-06-16 18:47'
labels:
  - visualization
  - output-panel
  - schema
dependencies: []
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
- [ ] #1 A 'Type Graph' tab appears in the Output panel tab strip on both desktop and mobile
- [ ] #2 The tab shows an informational message when composition has failed (not an error state)
- [ ] #3 Object, Interface, Union, and Input types appear as nodes; Scalar and Enum nodes are shown but visually smaller
- [ ] #4 A toggle control hides/shows Scalar and Enum nodes
- [ ] #5 Edges connect types via their field return types
- [ ] #6 Nodes are color-coded by their owning subgraph, using the same palette as Field Attribution and Entity Ownership Graph
- [ ] #7 A subgraph filter control shows only the selected subgraph's types and their direct connections
- [ ] #8 Zoom and pan work via mouse wheel and drag
- [ ] #9 Double-clicking the canvas background fits the graph to the viewport
- [ ] #10 Clicking a node highlights its direct edges and neighbors and dims all other nodes/edges
- [ ] #11 elkjs is loaded via dynamic import (lazy) — a spinner is shown while layout computes
- [ ] #12 @xyflow/react styles do not bleed into or conflict with the existing app design system
- [ ] #13 Respects the 'Ink at Night' dark theme
<!-- AC:END -->
