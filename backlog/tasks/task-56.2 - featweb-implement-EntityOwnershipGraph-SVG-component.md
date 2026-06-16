---
id: TASK-56.2
title: 'feat(web): implement EntityOwnershipGraph SVG component'
status: Done
assignee: []
created_date: '2026-06-16 19:22'
updated_date: '2026-06-16 19:27'
labels:
  - task
dependencies:
  - TASK-56.1
references:
  - web/src/EntityOwnershipGraph.tsx
  - web/src/ExecutionTimeline.tsx
  - web/src/subgraphColors.ts
  - web/src/theme.css
parent_task_id: TASK-56
priority: high
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `web/src/EntityOwnershipGraph.tsx` — the SVG rendering component for the entity ownership graph. Accepts an `EntityGraph` (from `schemaToEntityGraph.ts`) and renders it as a clustered, interactive SVG. This component has no knowledge of SDL parsing — it only receives the typed data model.

**Layout algorithm (custom SVG, no external lib):**
- Arrange subgraph clusters in a grid: up to 3 columns, then wrap. Each cluster is a rounded-rect with a header label.
- Within each cluster, arrange entity nodes vertically with spacing. Node size: fixed width (~120px), height proportional to number of key fields displayed.
- After cluster positions are computed, derive node center coordinates. Draw directed edges as SVG `<path>` elements (cubic Bezier curves) between the center-right and center-left of source/target nodes, routing outside cluster boundaries.
- For bidirectional edges (A→B and B→A for the same entity), offset the two curves slightly (use different curvature) so both are visible; render with a distinct marker (double-headed arrowhead or a different stroke color using `var(--warning)` or `var(--accent)`).
- One-way edges use a standard arrowhead marker (`<marker>` SVG element, `markerEnd`).

**Interactivity:**
- Hover over an edge shows a tooltip: `Resolved via @key(fields: "<fields>")`. Follow the `TooltipState` pattern from `ExecutionTimeline.tsx` — a React state holding x/y/text, rendered as an SVG `<g>` on top.
- No zoom/pan needed (the graph is small by design, 5–30 nodes). The SVG width/height is computed from layout; wrap in an `overflow: auto` container so it scrolls if large.

**Theming:**
- Cluster background: `${subgraphColorVar(name)}22` (very low opacity tint of the subgraph color).
- Cluster border: `${subgraphColorVar(name)}88`.
- Cluster header text: `subgraphColorVar(name)`.
- Node fill: `var(--surface-2)`, border: `var(--border-strong)`.
- Node text: `var(--text)`.
- One-way edge stroke: `var(--text-muted)`.
- Bidirectional edge stroke: `var(--warning)` (already defined in theme.css).
- Use `subgraphColorVar` from `web/src/subgraphColors.ts` — do NOT import `injectSubgraphStyles` (not needed here).

**Empty state:** If `nodes.length === 0`, render `<p className="empty-state">No entity types found.</p>`.

**Props interface:**
```ts
interface EntityOwnershipGraphProps {
  graph: EntityGraph;
}
```
<!-- SECTION:DESCRIPTION:END -->
