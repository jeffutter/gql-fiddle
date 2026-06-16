---
id: TASK-54
title: 'feat(web): add execution timeline (Gantt chart) tab to Output panel'
status: To Do
assignee: []
created_date: '2026-06-16 18:46'
labels:
  - visualization
  - output-panel
  - query-plan
dependencies: []
references:
  - web/src/SequenceDiagram.tsx
  - web/src/planToMermaid.ts
  - web/src/PlanTree.tsx
  - web/src/core/types.ts
  - web/src/App.tsx
priority: medium
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a new "Timeline" tab to the Output panel (top-right) that renders the query plan as a horizontal execution timeline — one row per subgraph, bars positioned by dependency depth. This gives users an immediate visual sense of which fetches run in parallel, what the critical path is, and how deep the execution chain is.

Unlike the existing Sequence Diagram (protocol message-passing style), the timeline shows time/depth relationships at a glance: "this query is 3 levels deep" and "this fetch is the bottleneck."

**App placement:**
- New "Timeline" tab in the Output panel (top-right), alongside Query Plan / Sequence Diagram / Supergraph SDL.
- Driven by `planResult` (same data source as the existing `SequenceDiagram.tsx`).
- Add `"timeline"` to the `rightTab` state union in `App.tsx` (`"sdl" | "plan" | "sequence" | "timeline" | "results"`).
- Also wire into the mobile Output tab strip.

**Implementation approach:**
- New `ExecutionTimeline.tsx` component alongside `SequenceDiagram.tsx` and `PlanTree.tsx`.
- New `planToTimeline.ts` utility that walks the `PlanNode` tree and produces a flat list of `{ service, depthStart, depthEnd, label, isOnCriticalPath }` items. Depth is derived from a topological sort of the plan tree: Parallel nodes share the same depth, Sequence nodes increment depth.
- Render as a hand-rolled SVG React component — no additional npm package needed for this scale (5–20 bars across 2–10 rows). Each subgraph is a labeled row, bars are `<rect>` elements.
- Highlight the critical path (longest sequential chain) in a distinct accent color.
- Hover tooltip on each bar showing the operation/field label and which subgraph handles it.

**No additional npm packages required.** Researched alternatives (uPlot ~47 KB, @visx packages) are unnecessary given the fixed, small data size.

**Design:** Must respect the "Ink at Night" dark theme via CSS custom properties from `theme.css`. Follow the existing pattern of `SequenceDiagram.tsx` for empty/error states (use `.empty-state` class, `.callout--error` for plan errors).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A 'Timeline' tab appears in the Output panel tab strip alongside existing tabs on both desktop and mobile
- [ ] #2 Each subgraph that appears in the plan gets its own labeled row in the chart
- [ ] #3 Parallel fetches appear at the same horizontal depth column
- [ ] #4 Sequential fetches appear at increasing depth columns, left to right
- [ ] #5 The critical path (longest sequential dependency chain) is visually distinguished from parallel/off-path fetches
- [ ] #6 Each bar shows a hover tooltip with the fetch's field/operation label and subgraph name
- [ ] #7 The empty state ('Run a query to see the timeline.') matches styling of other Output tabs
- [ ] #8 Plan errors display using the existing .callout--error pattern
- [ ] #9 The chart uses CSS custom properties from theme.css and renders correctly on the dark 'Ink at Night' theme
- [ ] #10 No new npm packages are added for this feature
<!-- AC:END -->
