---
id: TASK-57.3
title: Implement TypeGraph.tsx component and wire Type Graph tab into App.tsx
status: Done
assignee: []
created_date: '2026-06-16 21:54'
updated_date: '2026-06-16 22:02'
labels:
  - task
dependencies:
  - TASK-57.2
references:
  - web/src/App.tsx
  - web/src/EntityOwnershipGraph.tsx
  - web/src/schemaToEntityGraph.ts
  - web/src/subgraphColors.ts
  - web/src/theme.css
documentation:
  - 'https://reactflow.dev/learn'
  - 'https://eclipse.dev/elk/documentation.html'
parent_task_id: TASK-57
priority: high
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `web/src/TypeGraph.tsx` — the React component that renders the interactive schema type graph using `@xyflow/react` for interactivity and `elkjs` (lazily loaded) for layout. Then wire the new \"Type Graph\" tab into `App.tsx` (both desktop and mobile layouts).\n\nThis is the visual/interaction layer for TASK-57. Depends on the `schemaToTypeGraph` utility (TASK-57.2) and the installed packages (TASK-57.1).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Part A: TypeGraph.tsx

### CSS scoping

Import `@xyflow/react/dist/style.css` at the top of `TypeGraph.tsx` (or in a scoped wrapper). Override ReactFlow CSS custom properties to match the Ink at Night theme. Wrap the `<ReactFlow>` component in a `<div className="type-graph-root">` and add CSS to `theme.css` (or a co-located `TypeGraph.css`) that scopes the overrides:

```css
.type-graph-root {
  --xy-background-color: var(--surface);
  --xy-node-background-color: var(--surface-2);
  --xy-node-border-color: var(--border-strong);
  --xy-node-color: var(--text);
  --xy-edge-stroke: var(--text-muted);
  --xy-minimap-background-color: var(--surface-2);
  /* etc. */
  width: 100%;
  height: 100%;
}
```

### Component interface

```ts
interface TypeGraphProps {
  supergraphSdl: string;
}
export function TypeGraph({ supergraphSdl }: TypeGraphProps)
```

### State

- `nodes` / `edges` — `@xyflow/react` Node[] / Edge[] state, managed via `useNodesState` / `useEdgesState`
- `selectedNodeId: string | null` — tracks the clicked node for highlight/dim
- `showScalarsEnums: boolean` — toggle for Scalar/Enum visibility (default: false to reduce clutter)
- `subgraphFilter: string | null` — null = show all
- `layoutReady: boolean` — false while ELK is computing layout (show spinner)

### ELK layout (lazy loaded)

Load `elkjs` via dynamic import on first render. Cache the ELK instance in a module-level variable so it is only instantiated once:

```ts
let elkInstance: ELK | null = null;
async function getElk() {
  if (!elkInstance) {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    elkInstance = new ELK();
  }
  return elkInstance;
}
```

ELK layout options for top-down hierarchical layout:
```ts
{
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.spacing.nodeNode": "40",
}
```

Run layout in a `useEffect` that fires whenever the filtered node/edge set changes. During layout, set `layoutReady = false` to show the spinner. On completion, set positions on nodes and `layoutReady = true`.

### Filtering

Apply filters before passing to ELK and ReactFlow:
1. If `!showScalarsEnums`: remove nodes with kind `"scalar"` or `"enum"`, and remove edges that reference them.
2. If `subgraphFilter !== null`: keep only nodes where `node.subgraphs.includes(subgraphFilter)` OR where the node is connected to such a node by one hop. Remove disconnected edges.

### Custom node renderer

Create a `TypeGraphNode` custom node component. Render a rounded rect with:
- Background: `color-mix(in srgb, <subgraphColorVar(subgraph)> 18%, var(--surface-2))`
- Border: `color-mix(in srgb, <subgraphColorVar(subgraph)> 55%, transparent)`
- Text: type name in `var(--text)`, kind badge in `var(--text-muted)` (smaller, e.g. "object", "interface")
- Scalar/Enum nodes: smaller height (28px vs 44px default)
- Selected/neighbor highlight: full opacity; non-selected when something is selected: opacity 0.25

Register as `nodeTypes = { typeGraphNode: TypeGraphNode }` outside the component (stable reference).

### Interaction

**Click node**: set `selectedNodeId` to the node's id. Compute neighbor set (all nodes reachable via one edge from/to the selected node). Apply `selected` / `dimmed` class or inline style. Clear selection on click of canvas background.

**Double-click canvas**: call `reactFlowInstance.fitView({ duration: 300 })`. Use `useReactFlow` hook and `onPaneDoubleClick` handler on `<ReactFlow>`.

**Zoom/pan**: use default ReactFlow controls. Optionally add `<Controls />` component from `@xyflow/react`.

**Minimap**: Add `<MiniMap />` component, styled to match the theme.

### Controls UI

Render a small controls bar inside the type-graph-root div, absolutely positioned top-right (above the ReactFlow canvas):

```
[Subgraph: All ▼]  [Show Scalars/Enums ☐]
```

- Subgraph selector: `<select>` with "All" + each subgraph name
- Toggle: `<label><input type="checkbox" /> Scalars & Enums</label>`

Style with existing `.btn`, `.input` classes where possible.

### Loading state

While `layoutReady === false`, render `<span className="spinner" aria-label="Computing layout" />` centered over the graph area.

---

## Part B: Wire into App.tsx

### 1. Extend the rightTab type

```ts
// Before:
"sdl" | "plan" | "sequence" | "timeline" | "entities" | "results"

// After:
"sdl" | "plan" | "sequence" | "timeline" | "entities" | "type-graph" | "results"
```

### 2. Import

```ts
import { TypeGraph } from "./TypeGraph";
```

And in `useMemo`:
```ts
const typeGraphSdl = compose?.ok ? compose.supergraph_sdl : null;
```

### 3. Define typeGraphContent

```tsx
const typeGraphContent = (
  <div className="scroll" style={{ position: "relative" }}>
    {typeGraphSdl === null ? (
      <p className="empty-state">Compose a valid supergraph to see the type graph.</p>
    ) : (
      <TypeGraph supergraphSdl={typeGraphSdl} />
    )}
  </div>
);
```

Note: the `scroll` div needs `height: 100%` for ReactFlow to fill its container — verify the existing `.scroll` class handles this, or add `style={{ height: "100%" }}`.

### 4. Add tab buttons

In both the **desktop** output tab strip and the **mobile** output tab strip, add a "Type Graph" button after "Entities":

```tsx
<button
  onClick={() => setRightTab("type-graph")}
  aria-pressed={rightTab === "type-graph"}
  className={rightTab === "type-graph" ? "tab is-active" : "tab"}
>
  Type Graph
</button>
```

### 5. Render typeGraphContent

In both the desktop render block and the mobile render block, add:
```tsx
{rightTab === "type-graph" && typeGraphContent}
```

### 6. Mobile rightTab reset guard

The existing `useEffect` that resets `rightTab` to `"plan"` when returning to desktop and `rightTab === "results"` needs no change — `"type-graph"` is valid on desktop too.

---

## Acceptance criteria cross-check

After implementation, all 13 ACs in TASK-57 must pass. Verify manually:
- Tab appears on desktop and mobile (AC#1)
- Failed compose shows empty-state message (AC#2)
- Node kinds rendered correctly (AC#3)
- Toggle hides/shows Scalars/Enums (AC#4)
- Edges from field return types (AC#5)
- Subgraph color coding matches palette (AC#6)
- Subgraph filter (AC#7)
- Zoom/pan (AC#8)
- Double-click fits view (AC#9)
- Click highlights neighbors (AC#10)
- ELK lazy load with spinner (AC#11)
- No style bleed from @xyflow/react (AC#12)
- Dark theme (AC#13)
<!-- SECTION:PLAN:END -->
