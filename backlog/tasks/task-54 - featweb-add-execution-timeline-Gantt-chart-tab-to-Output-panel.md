---
id: TASK-54
title: 'feat(web): add execution timeline (Gantt chart) tab to Output panel'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-16 18:46'
updated_date: '2026-06-16 18:59'
labels:
  - visualization
  - output-panel
  - query-plan
  - planned
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
- [ ] #11 1:done
- [ ] #12 2:done
- [ ] #13 3:done
- [ ] #14 4:done
- [ ] #15 5:done
- [ ] #16 6:done
- [ ] #17 7:done
- [ ] #18 8:done
- [ ] #19 9:done
- [ ] #20 10:done
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add an "Execution Timeline" tab to the Output panel (top-right) that renders the query plan as a horizontal Gantt-style SVG chart — one row per subgraph, bars positioned by execution depth. This is a pure frontend change: two new files (`planToTimeline.ts` and `ExecutionTimeline.tsx`) plus small wiring edits in `App.tsx`.

No sub-tickets are created. The work is a cohesive, single-session feature with no independently shippable increments; splitting it would create conjoined pieces that must be merged together anyway.

---

## File 1 — `web/src/planToTimeline.ts`

### Purpose

Walk the `PlanNode` tree (same input as `planToMermaid`) and produce a flat array of `TimelineItem` records ready for SVG layout. The topology walk assigns an integer `depthStart` (column where the bar begins) and `depthEnd` (column where it ends, always `depthStart + 1` for atomic fetches) to each item, identifies the critical path, and deduplicates services into rows.

### Types to export

```ts
export interface TimelineItem {
  id: string;          // stable key for React (e.g. "users-0")
  service: string;     // subgraph name → row
  label: string;       // first top-level field from operation string
  depthStart: number;  // 0-based column where the bar begins
  depthEnd: number;    // exclusive end column (always depthStart + 1 for leaf fetches)
  isOnCriticalPath: boolean;
}

export interface TimelineData {
  items: TimelineItem[];
  services: string[];  // ordered unique service names (row order)
  maxDepth: number;    // total number of depth columns
}

export function planToTimeline(root: PlanNode): TimelineData
```

### Walk algorithm

Use a recursive function `walk(node, depthStart): number` that returns the `depthEnd` (exclusive) reached by the subtree:

- **Fetch**: emit one `TimelineItem` with `depthStart` and `depthEnd = depthStart + 1`; return `depthStart + 1`.
- **Sequence**: call `walk` on each child in order, threading the output depth as the next child's input depth. Return the final depth.
- **Parallel**: call `walk` on all children with the same `depthStart`; return the max depth across all children.
- **Flatten**: delegate to `walk(node.node, depthStart)`.
- **Subscription**: walk `primary`, then walk `rest` (if present) starting from the depth returned by `primary`.
- **Defer**: walk `primary` (if present), then walk each `deferred[i].node` (if present) with the same start depth as primary (deferred branches are conceptually parallel to primary). Return max depth.
- **Condition**: walk both branches with the same start depth; return max depth across both.

### Critical path detection

After collecting all items, compute the critical path as the set of items whose `depthStart` forms the longest sequential chain. In practice: find `maxDepth`, then mark every item where removing it would shorten the longest chain. A simpler but correct approximation: mark items that form the unique longest sequence. Because Sequence nodes already increment depth linearly, items in a Sequence subtree that reaches `maxDepth` are all on the critical path.

Simple implementation: after the walk, find the maximum `depthEnd` (= `maxDepth`). Items are on the critical path if they are part of any chain from depth 0 to `maxDepth` with no parallel shortcut. A safe approximation: mark an item as on the critical path if it sits in a depth column that is not reachable by any parallel branch — i.e., a column where the only way to reach it is through this item. The simplest correct approach: trace back from items with `depthEnd == maxDepth` and mark all items that are their sequential predecessors. Since the data is flat after the walk (no parent links), use a column-based heuristic: an item is on the critical path if its `depthStart` column has only one occupant (no parallel alternatives at that depth). For parallel items at the same depth, none is on the critical path unless they are the only group feeding into the next sequential step.

Practical algorithm:
1. Group items by `depthStart`.
2. A depth column is "sequential" (not parallel) if `items[depthStart].length === 1`.
3. An item is on the critical path if ALL depth columns from 0 to its `depthEnd - 1` are sequential, AND it sits in the deepest reachable sequential chain.

This is an approximation that is correct for all real query plan shapes (Sequence-of-Parallels) and avoids graph traversal complexity.

---

## File 2 — `web/src/ExecutionTimeline.tsx`

### Component signature

```tsx
export function ExecutionTimeline({ node }: { node: PlanNode })
```

### Rendering approach

Hand-rolled SVG (no library). The ticket explicitly rules out npm packages, and the data size (5–20 bars, 2–10 rows) makes layout arithmetic straightforward.

### Layout constants (declared at top of file)

```ts
const ROW_HEIGHT = 36;       // px per service row
const ROW_PADDING = 6;       // vertical gap between bars
const BAR_HEIGHT = ROW_HEIGHT - ROW_PADDING * 2;
const COL_WIDTH = 120;       // px per depth column
const LABEL_WIDTH = 100;     // px reserved for row labels on the left
const CHART_PADDING = 12;    // outer padding
const TOOLTIP_HEIGHT = 48;   // tooltip box height
```

### SVG structure

```
<svg width={LABEL_WIDTH + maxDepth * COL_WIDTH + CHART_PADDING * 2}
     height={services.length * ROW_HEIGHT + CHART_PADDING * 2}>

  // Alternating row background stripes (subtle, theme-matched)
  {services.map((svc, rowIdx) =>
    <rect key={svc} fill={rowIdx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)'} ... />
  )}

  // Vertical depth-column gridlines
  {Array.from({length: maxDepth + 1}, (_, col) =>
    <line key={col} stroke="var(--border)" strokeDasharray="4 3" ... />
  )}

  // Row labels (left side)
  {services.map((svc, rowIdx) =>
    <text key={svc} fill="var(--text-muted)" fontSize={11} ... >{svc}</text>
  )}

  // Bars — each TimelineItem
  {items.map(item =>
    <g key={item.id} onMouseEnter={...} onMouseLeave={...}>
      <rect
        x={LABEL_WIDTH + item.depthStart * COL_WIDTH + BAR_GAP}
        y={CHART_PADDING + services.indexOf(item.service) * ROW_HEIGHT + ROW_PADDING}
        width={COL_WIDTH - BAR_GAP * 2}
        height={BAR_HEIGHT}
        rx={4}
        fill={item.isOnCriticalPath ? 'var(--accent)' : 'var(--surface-3)'}
        stroke={item.isOnCriticalPath ? 'var(--accent-hover)' : 'var(--border-strong)'}
      />
      <text fill={item.isOnCriticalPath ? 'var(--accent-contrast)' : 'var(--text)'}
            fontSize={11} dominantBaseline="middle" ...>
        {item.label}
      </text>
    </g>
  )}

  // Hover tooltip (rendered last so it draws on top)
  {tooltip &&
    <g>
      <rect fill="var(--surface-3)" stroke="var(--border-strong)" rx={4} ... />
      <text fill="var(--text)" fontSize={11} ...>{tooltip.service}: {tooltip.label}</text>
    </g>
  }
</svg>
```

### Tooltip state

```ts
const [tooltip, setTooltip] = useState<{
  x: number; y: number;
  service: string; label: string;
} | null>(null);
```

Show on `onMouseEnter` of a bar `<g>`, hide on `onMouseLeave`. Position using the bar's SVG coordinates (no getBoundingClientRect needed — use the item's computed x/y from layout).

Clip the tooltip to stay within the SVG: if `x + tooltipWidth > svgWidth`, flip it left of the cursor.

### Empty and error states (matching other tabs)

```tsx
if (planResult === null)
  return <p className="empty-state">Run a query to see the timeline.</p>;
if (!planResult.ok)
  return <div className="callout callout--error">...</div>;
```

Wait — the component takes `node: PlanNode` (already resolved), so the outer `App.tsx` handles the null/error guards (same pattern as `SequenceDiagram`). The component itself only needs to handle the case where `planToTimeline` returns zero items (e.g. an empty plan):

```tsx
if (items.length === 0)
  return <p className="empty-state">No fetch nodes found in this plan.</p>;
```

---

## App.tsx wiring

### 1. Expand the `rightTab` union type

Line 134 currently reads:
```ts
const [rightTab, setRightTab] = useState<"sdl" | "plan" | "sequence" | "results">("plan");
```

Change to:
```ts
const [rightTab, setRightTab] = useState<"sdl" | "plan" | "sequence" | "timeline" | "results">("plan");
```

### 2. Add import

```ts
import { ExecutionTimeline } from "./ExecutionTimeline";
```

### 3. Add `timelineContent` JSX variable (after `sequenceContent`)

```tsx
const timelineContent = (
  <div className="scroll">
    {planResult === null ? (
      <p className="empty-state">Run a query to see the timeline.</p>
    ) : planResult.ok ? (
      <ExecutionTimeline node={planResult.query_plan} />
    ) : (
      <div className="callout callout--error">
        {planResult.errors.map((e, i) => (
          <ErrorMessage key={i} text={e.message} />
        ))}
      </div>
    )}
  </div>
);
```

### 4. Desktop tab strip — add Timeline button after Sequence Diagram

In the desktop Output panel nav, after the "Sequence Diagram" button:
```tsx
<button
  onClick={() => setRightTab("timeline")}
  aria-pressed={rightTab === "timeline"}
  className={rightTab === "timeline" ? "tab is-active" : "tab"}
>
  Timeline
</button>
```

And add to the content switch:
```tsx
{rightTab === "timeline" && timelineContent}
```

### 5. Mobile tab strip — add Timeline button after Sequence Diagram

In the mobile Output section nav, after the Sequence Diagram button:
```tsx
<button
  onClick={() => setRightTab("timeline")}
  aria-pressed={rightTab === "timeline"}
  className={rightTab === "timeline" ? "tab is-active" : "tab"}
>
  Timeline
</button>
```

And add to the mobile content switch:
```tsx
{rightTab === "timeline" && timelineContent}
```

### 6. Mobile reset guard — add "timeline" to the condition

Line 153:
```ts
if (!isMobile && rightTab === "results") setRightTab("plan");
```

No change needed — "timeline" is valid on both desktop and mobile, unlike "results" which is mobile-only.

---

## Unit tests — `planToTimeline.test.ts`

Follow the pattern of `planToMermaid.test.ts`. Key cases:

1. **Single Fetch** — one item, `depthStart: 0`, `depthEnd: 1`, `maxDepth: 1`, on critical path.
2. **Sequence of two Fetches** — two items, depths 0→1 and 1→2, both on critical path.
3. **Parallel of two Fetches** — two items, both at depth 0, neither on critical path (parallel, not sequential). `maxDepth: 1`.
4. **Sequence containing Parallel** — tests mixed nesting: items at depth 0 (sequential), items at depth 1 (parallel). Critical path includes depth-0 item.
5. **Flatten wrapping Fetch** — Flatten is transparent; returns the inner Fetch's item.
6. **Service row deduplication** — two Fetches to the same service produce two items but one row in `services`.
7. **Subscription** — primary and rest are sequential.
8. **Defer** — deferred branches are at same depth as primary (parallel semantics).

---

## Acceptance criteria mapping

| Criterion | Covered by |
|-----------|------------|
| #1 Timeline tab in Output (desktop + mobile) | App.tsx tab strip edits (steps 4 + 5) |
| #2 Each subgraph gets a row | `services` array from `planToTimeline` → one SVG row per entry |
| #3 Parallel fetches at same horizontal depth | Parallel walk sets same `depthStart` for all children |
| #4 Sequential fetches at increasing depth | Sequence walk threads depth through children |
| #5 Critical path visually distinguished | `isOnCriticalPath` → accent color vs surface-3 fill |
| #6 Hover tooltip | `onMouseEnter`/`onMouseLeave` state, SVG `<g>` tooltip overlay |
| #7 Empty state matches other tabs | `<p className="empty-state">` pattern |
| #8 Plan errors use .callout--error | Same as `sequenceContent` guard in App.tsx |
| #9 CSS custom properties from theme.css | All colors use `var(--...)` tokens only |
| #10 No new npm packages | Hand-rolled SVG, no imports added to package.json |

---

## Implementation order

1. Create `web/src/planToTimeline.ts` — pure function, no React, fully testable.
2. Write `web/src/planToTimeline.test.ts` — verify walk algorithm against all node kinds.
3. Create `web/src/ExecutionTimeline.tsx` — SVG component consuming `planToTimeline`.
4. Edit `web/src/App.tsx` — import, add `timelineContent`, wire tab strips on desktop and mobile, expand union type.
5. Run `pnpm test` and `pnpm build` to confirm no regressions.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Files created
- `web/src/planToTimeline.ts` — pure walk function producing flat TimelineItem array; handles all 7 PlanNode kinds (Fetch, Sequence, Parallel, Flatten, Subscription, Defer, Condition)
- `web/src/planToTimeline.test.ts` — 15 unit tests covering all node kinds, critical path logic, service deduplication, edge cases
- `web/src/ExecutionTimeline.tsx` — hand-rolled SVG component; alternating row stripes, vertical gridlines, bar labels, hover tooltip positioned in SVG coordinates

### Files modified
- `web/src/App.tsx` — added ExecutionTimeline import, expanded rightTab union type to include 'timeline', added timelineContent JSX block, wired Timeline button + content in both desktop Output panel and mobile Output tab strip

### Critical path algorithm
Groups items by depthStart column. Walks columns 0..maxDepth-1 in order; a column is 'sequential' (single occupant). The sequential chain stops at the first parallel column. Items are on the critical path only when every column from 0 to their depthEnd is sequential AND criticalEnd == maxDepth.

### No new npm packages
Hand-rolled SVG avoids any library dependency. Build confirmed clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added ExecutionTimeline Gantt chart tab to the Output panel. Two new files (planToTimeline.ts with 15 unit tests, ExecutionTimeline.tsx hand-rolled SVG) plus wiring in App.tsx for both desktop and mobile tab strips. All 109 tests pass, build is clean, no new npm packages added.
<!-- SECTION:FINAL_SUMMARY:END -->
