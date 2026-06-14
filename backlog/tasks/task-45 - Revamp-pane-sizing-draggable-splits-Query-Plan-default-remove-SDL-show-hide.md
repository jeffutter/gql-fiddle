---
id: TASK-45
title: 'Revamp pane sizing: draggable splits, Query Plan default, remove SDL show/hide'
status: Done
assignee:
  - developer
created_date: '2026-06-12 20:46'
updated_date: '2026-06-14 05:33'
labels:
  - ux
  - layout
dependencies: []
priority: medium
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app currently has a rigid two-row grid layout (top: subgraph editor + SDL/plan pane; bottom: query + variables + results). All splits are fixed 50/50 or 1/3 columns. Three changes are requested:

1. **Remove the Show/Hide button** on the Supergraph SDL tab — the SDL content should always be visible when that tab is active (the collapsed/expanded toggle state and related logic can be deleted).

2. **Make Query Plan the default tab** — change the initial `rightTab` state from `"sdl"` to `"plan"` so the Query Plan pane is shown on load.

3. **Draggable split dividers** — replace fixed `gridTemplateRows`/`gridTemplateColumns` values with resizable splits so users can drag to redistribute space. Splits to make resizable:
   - Vertical: top row vs bottom row (currently `gridTemplateRows: "1fr 1fr"`)
   - Horizontal in top row: subgraph editor vs SDL/plan pane (currently `gridTemplateColumns: "1fr 1fr"`)
   - Horizontal in bottom row: query vs variables vs results (currently `gridTemplateColumns: "1fr 1fr 1fr"`)

**Implementation approach**

Prefer a lightweight drag-divider implementation or a small focused library (e.g. `react-resizable-panels` or `allotment`) over building drag logic from scratch. Divider handles should be visually obvious (e.g. a subtle 4–8px hit area with a visual indicator on hover). Sizes do not need to be persisted across page loads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Show/Hide toggle button on the Supergraph SDL tab is removed; SDL content is always visible when that tab is active.
- [x] #2 Query Plan is the active tab on initial load (before the user interacts with the tab bar).
- [x] #3 The vertical split between the top and bottom rows can be dragged to resize.
- [x] #4 The horizontal split between the subgraph editor and the SDL/plan pane can be dragged to resize.
- [x] #5 The horizontal splits between the query, variables, and results panes can be dragged to resize.
- [x] #6 Drag handles have a visible hover state so they are discoverable.
- [x] #7 All existing tests continue to pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan: TASK-45 — Revamp pane sizing

## Overview

Replace the rigid CSS Grid layout in `web/src/App.tsx` with draggable resizable splits using `react-resizable-panels`, remove the SDL Show/Hide toggle, and make Query Plan the default tab.

---

## Files to modify

| File | Change |
|---|---|
| `web/package.json` | Add `react-resizable-panels` dependency |
| `web/src/App.tsx` | Replace CSS Grid layout with `<Group>`/`<Panel>`/`<Separator>`, remove collapse state, change default tab |
| `web/src/App.test.tsx` | Update tests that click the Show button; verify draggable splits render correctly |

No new files needed. The library provides all components; separator hover styling is inline on `<Separator>` props.

---

## Step-by-step implementation

### Phase 1: Library installation

```sh
cd web && pnpm add react-resizable-panels
```

The research brief recommends `react-resizable-panels` v4.x (Brian Vaughn, React core team). Size ~4KB gzip, no required CSS import beyond optional cursor styles.

### Phase 2: Remove Show/Hide toggle (AC#1)

In `web/src/App.tsx`:

1. Delete line:
   ```ts
   const [supergraphCollapsed, setSupergraphCollapsed] = useState(true);
   ```
2. Delete the Show/Hide button element and its wrapper `<div>` inside the SDL tab block.
3. Remove the `{!supergraphCollapsed && ...}` conditional wrapper around the SDL content div — the content renders unconditionally when `rightTab === "sdl"`.
4. Remove the collapsed-state error banner (the `{supergraphCollapsed && compose !== null && !compose.ok && ...}` block). Errors are always shown inline since SDL is always visible.

### Phase 3: Change default tab to Query Plan (AC#2)

In `web/src/App.tsx`, change:
```ts
const [rightTab, setRightTab] = useState<"sdl" | "plan">("sdl");
```
to:
```ts
const [rightTab, setRightTab] = useState<"sdl" | "plan">("plan");
```

### Phase 4: Replace CSS Grid with `react-resizable-panels` (AC#3–5)

**Imports to add:**
```tsx
import { Group, Panel, Separator } from "react-resizable-panels";
```

**Layout structure replacement:**

Replace the `<main>` element and its contents:

```tsx
<Group orientation="vertical" style={{ height: "100vh", padding: 8 }}>
  {/* === Top row: subgraph editor | SDL/plan === */}
  <Panel defaultSize={50} minSize={200}>
    <Group orientation="horizontal">
      <Panel defaultSize={50} minSize={200}>
        {/* Subgraph editor content — tabs, nav, Monaco editor (unchanged from current top-left div) */}
      </Panel>
      <Separator className="resize-handle" />
      <Panel defaultSize={50} minSize={200}>
        {/* SDL/plan tab pane — tab bar + SDL content or PlanTree (unchanged from current top-right div) */}
      </Panel>
    </Group>
  </Panel>

  <Separator className="resize-handle" />

  {/* === Bottom row: query | variables | results === */}
  <Panel defaultSize={50} minSize={200}>
    <Group orientation="horizontal">
      <Panel defaultSize={33.34} minSize={150}>
        {/* Query editor (unchanged from current bottom-left div) */}
      </Panel>
      <Separator className="resize-handle" />
      <Panel defaultSize={33.33} minSize={150}>
        {/* Variables + Run button (unchanged from current bottom-middle div) */}
      </Panel>
      <Separator className="resize-handle" />
      <Panel defaultSize={33.33} minSize={150}>
        {/* Results pane (unchanged from current bottom-right div) */}
      </Panel>
    </Group>
  </Panel>
</Group>
```

**Key details:**
- `orientation="vertical"` on the outer Group for top/bottom split.
- `orientation="horizontal"` on inner Groups for left/right splits.
- Each panel content div must set `minHeight: 0` so Monaco editors can shrink correctly inside flex containers.
- The `data-testid="subgraph-editor"` and `data-testid="query-editor"` attributes stay on their respective content divs inside Panels — preserve test selectors.
- No `autoSaveId` prop needed (sizes not persisted per task spec).

### Phase 5: Separator hover styling (AC#6)

Add a `<style>` block or append to an inline style approach. Since the project has no CSS files, add separator styling via a small inline `<style>` in `App.tsx` or use a constant:

Option A — Inline on each `<Separator>` (simplest, no new files):
```tsx
const separatorStyle: React.CSSProperties = {
  width: 4,
  height: 4,
};
```
Then target `.rp-Separator` via a `<style>` tag in the render output or add CSS to `index.html`.

Option B — Add `web/src/styles/panels.css` and import it (cleaner long-term):
```css
.resize-handle {
  width: 4px;
  height: 4px;
  background: transparent;
  transition: background-color 0.15s;
}
.resize-handle:hover,
.resize-handle.dragging {
  background: #d1d5db;
}
```
The research brief notes the library adds `.rp-Separator` class; target it in CSS for hover state.

### Phase 6: Update tests

**Tests that click the Show button (7 total):**
- `"successful compose shows supergraph SDL..."` — remove the `fireEvent.click(screen.getByText("▶ Show"))` line
- `"stale badge and gray styling..."` — remove the Show button click; content is now always visible. But since default tab is now `"plan"`, these tests need to click "Supergraph SDL" tab first.
- `"successful compose removes stale badge..."` — same: click SDL tab, no Show button needed
- `"no stale badge on first-ever failure"` — click SDL tab, no Show button needed
- `"failing compose shows 'No valid composition yet'"` — click SDL tab, no Show button needed

**New tests to add:**
1. Verify Query Plan is the default tab on mount (check that "Run a query to see the plan." text or Query Plan content is visible without user interaction).
2. Verify `<Group>` elements render with correct orientation attributes (snapshot or DOM structure check).
3. Verify separator elements exist between panels (at least 4 separators: 1 vertical + 3 horizontal = actually 1 + 2 = 3 total, since the top row has 2 panels = 1 separator, bottom row has 3 panels = 2 separators, plus 1 vertical = 4 separators total). Wait — outer Group has 2 panels (top/bottom) = 1 separator. Top inner Group has 2 panels = 1 separator. Bottom inner Group has 3 panels = 2 separators. Total: **4 Separator elements**.

---

## Exact library API calls

From research brief:

| API | Usage |
|---|---|\n| `import { Group, Panel, Separator } from "react-resizable-panels"` | Primary components |
| `<Group orientation="vertical">` | Outer split: top row vs bottom row |
| `<Group orientation="horizontal">` | Inner splits: left/right within each row |
| `<Panel defaultSize={N} minSize={M}>` | Each content region; N=percentage (0-100), M=pixels |
| `<Separator className="resize-handle" />` | Draggable divider between panels |

---

## TDD Order

1. **Test: default tab is Query Plan** — Verify `rightTab` initial value renders Query Plan content without user interaction.
2. **Test: Show button removed** — Assert no "Show"/"Hide" button exists in SDL tab; SDL content visible when SDL tab active.
3. **Test: split structure renders** — Verify `<Group>` and `<Panel>` elements exist with correct hierarchy (4 separators).
4. **Test: separator hover class present** — Verify `.resize-handle` class on separators.
5. **Update existing tests** — Remove Show button clicks, add SDL tab clicks where needed.

---

## Acceptance Criteria Mapping

| AC | How met |
|---|---|
| #1 (Remove Show/Hide) | Delete `supergraphCollapsed` state, button JSX, conditional wrapper. Content always visible in SDL tab. |
| #2 (Query Plan default) | Change `useState("sdl")` to `useState("plan")`. |
| #3 (Vertical split draggable) | Outer `<Group orientation="vertical">` with `<Separator>` between top/bottom Panels. |
| #4 (Top horizontal split draggable) | Inner `<Group orientation="horizontal">` in top Panel with `<Separator>`. |
| #5 (Bottom horizontal splits draggable) | Inner `<Group orientation="horizontal">` in bottom Panel with 2x `<Separator>` among 3 panels. |
| #6 (Hover state on handles) | `.resize-handle:hover` CSS rule changes background from transparent to `#d1d5db`. Library adds crosshair cursor automatically. |
| #7 (Existing tests pass) | Update Show button references; preserve `data-testid` attributes inside Panel wrappers. |

---

## Risks and Prerequisites

**Risk 1: Monaco editor resize during drag**
- Monaco requires its container to have explicit dimensions. The library sets inline styles on Panel DOM nodes, but Monaco may not auto-resize during dragging.
- Mitigation: If editors appear squashed during drag, add an `onLayoutChanged` callback that calls `editor.layout()`. The research brief notes `height="100%"` is already passed to Monaco; this should be sufficient in most cases.

**Risk 2: Test selector changes due to DOM structure**
- Replacing CSS Grid with `<Group>`/`<Panel>` wrappers adds nesting. Tests that query by DOM structure (e.g., `querySelectorAll > div:nth-child(2)`) will break.
- Mitigation: Most tests use text content or test IDs, which are stable. The Show button tests need explicit updates (see Phase 6 above).

**Risk 3: Panel sizing with Monaco's internal layout**
- The outer `<Panel>` elements contain inner `<Group>` elements. The library expects Panels to fill their allocated space. Content divs inside must have `minHeight: 0` and proper flex behavior.
- Mitigation: Ensure all content wrapper divs retain `minHeight: 0` from current CSS grid setup.

**Prerequisite: None** — no dependencies on other tasks. The task is self-contained UI layout work.

**Risk 4: Panel default sizing for 3-pane bottom row**
- Three panels need sizes summing to 100: `33.34 + 33.33 + 33.33 = 100`. The library normalizes these, but verify in testing that no panel receives 0% initially.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed. Replaced CSS Grid with react-resizable-panels (Group/Panel/Separator) across all three split regions. Removed the supergraphCollapsed Show/Hide toggle (SDL always visible when tab active). Changed default rightTab from "sdl" to "plan" so Query Plan shows on load. Added SEPARATOR_CSS with .resize-handle:hover rule (transparent → #d1d5db) rendered via a <style> tag. Polyfilled ResizeObserver in setupTests.tsx for JSDOM. Updated all 8 tests that previously clicked "▶ Show" to click the Supergraph SDL tab instead; fixed the plan mock to return { ok: false, errors: [] } so the plan tab never crashes; rewrote TASK-45 AC#1 test to assert the SDL content area renders without a toggle gate. All 92 tests pass; pnpm tsc --noEmit, pnpm lint, and prettier all pass.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-45 — Revamp pane sizing with draggable splits

## Summary

**Recommendation: use `react-resizable-panels` (v4.x, Brian Vaughn).** It is actively maintained by a React core team member, provides nested `Group`/`Panel` components that map cleanly to the three split regions needed (vertical top/bottom, horizontal editor/SDL, horizontal query/variables/results), supports keyboard accessibility out of the box, and has no CSS import required beyond the optional `index.css`. The API is straightforward enough to replace the current CSS Grid layout with minimal structural changes.

## Findings

### 1. Library comparison: `react-resizable-panels` vs `allotment`

| Criterion | `react-resizable-panels` v4.x | `allotment` |
|---|---|---|
| **Maintainer** | Brian Vaughn (React core team) — very active, 60+ contributors | Single maintainer (johnwalley) — moderate activity |
| **NPM weekly downloads** | ~150k+ | ~8k |
| **Size (gzip)** | ~4 KB | ~3 KB |
| **CSS required** | Optional (`index.css` for cursor styles); component is fully styleable via `style`/`className` props | Required (`import "allotment/dist/style.css"`) — VS Code-inspired dark theme, may need significant overrides |
| **Nested layouts** | Native via nested `<Group>` components | Not supported (single-axis only) |
| **Orientation** | `"horizontal"` or `"vertical"` per Group | `vertical` boolean on parent only |
| **Collapsible panels** | Built-in (`collapsible`, `collapsedSize`) | No native collapse |
| **Keyboard accessibility** | Arrow keys to resize, Escape to stop — WCAG compliant | No keyboard support |
| **Auto-save layout** | Built-in via `autoSaveId` prop (localStorage) | Not built-in |
| **Imperative API** | `useGroupRef()` / `usePanelRef()` hooks → `getLayout()`, `setLayout()`, `collapse()`, `expand()` | Ref `.reset()`, `.resize()` only |
| **Snap to zero** | Via `collapsible` + `collapsedSize` | Built-in (`snap` prop) |
| **Server-side rendering** | Supported (v4+) | Not supported (browser-only, see FAQ) |

**Verdict:** `react-resizable-panels` is the better fit because:
- The task requires **three independent split axes**, which maps naturally to nested `<Group orientation="vertical">` and `<Group orientation="horizontal">` components. Allotment only supports a single axis per component — you would need three separate Allotment instances with manual coordination, losing the ability for users to resize all three splits simultaneously.
- Keyboard accessibility is a nice-to-have that react-resizable-panels provides for free.
- No CSS import needed means no theme conflicts with the existing light UI.

### 2. Mapping current layout to `react-resizable-panels`

The current App.tsx has this structure:

```
<main> (CSS grid, 1fr 1fr rows)
  <section top>   (CSS grid, 1fr 1fr columns)
    <div subgraph editor>
    <div SDL/plan tab pane>
  </section>
  <section bottom>  (CSS grid, 1fr 1fr 1fr columns)
    <div query>
    <div variables>
    <div results>
  </section>
</main>
```

This maps to **three nested Groups**:

```tsx
<Group orientation="vertical">
  {/* Top row — horizontal split */}
  <Group orientation="horizontal">
    <Panel defaultSize={50} minSize={20}>
      {/* Subgraph editor content (tabs + Monaco) */}
    </Panel>
    <Separator />
    <Panel defaultSize={50} minSize={20}>
      {/* SDL/plan tab pane */}
    </Panel>
  </Group>
  <Separator />
  {/* Bottom row — horizontal split with 3 panels */}
  <Group orientation="horizontal">
    <Panel defaultSize={33.34} minSize={10}>
      {/* Query editor */}
    </Panel>
    <Separator />
    <Panel defaultSize={33.33} minSize={10}>
      {/* Variables editor */}
    </Panel>
    <Separator />
    <Panel defaultSize={33.33} minSize={10}>
      {/* Results */}
    </Panel>
  </Group>
</Group>
```

**Key structural changes:**
- Replace `<main>`'s `display: grid` with a single `<Group orientation="vertical">` and set `height: "100vh"` on the root Group.
- Replace each inner `<section>`'s `display: grid` with `<Group orientation="horizontal">`.
- Each grid cell becomes a `<Panel>`.
- Between adjacent panels, insert a `<Separator />` (or `<PanelResizeHandle />` — both render a draggable divider; `Separator` is semantically richer).
- Remove the `gap: 8, padding: 8` from the main container and move that as outer padding on each panel's content wrapper.

### 3. Exact API signatures

**Installation:**
```sh
npm install react-resizable-panels
```

**Imports:**
```tsx
import { Group, Panel, Separator } from "react-resizable-panels";
// Optional: import "react-resizable-panels/index.css"; // cursor styles
```

**`<Group>` props (only the ones relevant to this task):**

| Prop | Type | Default | Description |
|---|---|---|---|
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Split direction |
| `defaultLayout` | `number[]` | — | Initial sizes for panels (same order as children). Optional. |
| `disabled` | `boolean` | `false` | Disable all resizing |
| `onLayoutChanged` | `(layout: number[]) => void` | — | Called **after** drag ends. Use this if you ever want to persist sizes. |
| `id` | `string` | auto-generated | Unique group ID (for testing, autoSaveId) |

**`<Panel>` props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `defaultSize` | `number` | auto-assigned | Initial size as percentage (0–100). For 3 panels: ~33.33 each. |
| `minSize` | `number` | — | Minimum size in pixels |
| `id` | `string` | auto-generated | Unique panel ID |

**`<Separator>` props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `disabled` | `boolean` | `false` | Disable this divider |
| `style` | `React.CSSProperties` | — | Custom styling for the handle |
| `className` | `string` | — | CSS class name |

**Note on sizing:** Panel sizes are expressed as **percentages of the parent group's total size**. The library normalizes them so they sum to 100 across all panels in a group. A `defaultSize` of `50` means 50% of the available space. For three equal panels, use `33.34`, `33.33`, `33.33`.

### 4. Changes needed beyond the library swap

#### Task item #1: Remove Show/Hide SDL toggle
- Delete the `supergraphCollapsed` state variable and its setter.
- Remove the `<button onClick={() => setSupergraphCollapsed(...)}` show/hide button.
- Remove the `{!supergraphCollapsed && ...}` conditional wrapper around the SDL content. The SDL content renders unconditionally when `rightTab === "sdl"`.

#### Task item #2: Query Plan default tab
- Change initial state from `"sdl"` to `"plan"`:
  ```tsx
  const [rightTab, setRightTab] = useState<"sdl" | "plan">("plan");
  ```

#### Task item #6: Drag handle visual hover state
- `react-resizable-panels` already provides cursor changes (crosshair on drag). The library's default `index.css` sets appropriate cursor styles. For additional visual indicators, add CSS to the `<Separator>` via `style` or `className`:
  ```css
  .resize-handle {
    width: 4px;
    background: transparent;
    transition: background 0.15s;
  }
  .resize-handle:hover,
  .resize-handle.dragging {
    background: #d1d5db;
  }
  ```
- The library adds a `.rp-Separator` class to separators — target it with CSS for hover state.

### 5. Gotchas

1. **Panel elements must be direct children of Group.** You cannot wrap panels in intermediate `<div>` elements without breaking the layout. Each panel's content should go inside the Panel component directly, or the Panel should wrap a single div (which is fine).

2. **Height management.** The current layout uses CSS grid which automatically distributes height. With `react-resizable-panels`, you must explicitly set heights on the root Group and panels:
   - Root `<Group>` needs `style={{ height: "100vh" }}` or a fixed pixel height.
   - Inner content divs need `minHeight: 0` and `flex: 1` to allow Monaco editors to fill space properly.

3. **Monaco editor in resizable panels.** Monaco requires its container to have an explicit size. The Panel component handles this by setting inline styles on the panel's DOM node, but you should verify that `Editor` from `@monaco-editor/react` receives a proper height prop (currently it does — `height="100%"`). If Monaco doesn't resize during drag, call `editor.layout()` imperatively.

4. **CSS gap replacement.** The current layout uses `gap: 8` on the CSS grid containers for spacing between panels. With `react-resizable-panels`, gaps are handled by the `Separator` component's width. Use a small separator width (2–4px) or add padding inside panels to approximate the 8px gap visually.

5. **Test selectors.** The library adds `data-panel`, `data-group`, and `data-testid` attributes. Existing tests that query for specific divs by class or structure may need updating. The current task has a test selector `data-testid="subgraph-editor"` and `data-testid="query-editor"` on the Monaco editor containers — these should be preserved inside their respective Panels.

6. **No layout persistence needed.** Per the task spec, sizes do not need to persist across page loads, so you can omit the `autoSaveId` prop entirely.

### 6. Test impact assessment

Existing tests in `App.test.tsx` likely query for UI elements by text content or test IDs. The structural change from CSS grid to Panel layout should not break text-based queries (e.g., `getByText("Query Plan")`). However, any tests that select elements by DOM structure (e.g., `querySelectorAll > div:nth-child(2)`) will need updating to account for the new `<Group>`/`<Panel>` wrapper elements.

The `data-testid="subgraph-editor"` and `data-testid="query-editor"` attributes should be preserved on their respective content divs inside Panels to maintain test compatibility.

<!-- SECTION:NOTES:END -->
