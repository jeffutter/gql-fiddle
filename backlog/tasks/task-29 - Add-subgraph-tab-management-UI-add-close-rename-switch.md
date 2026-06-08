---
id: TASK-29
title: 'Add subgraph tab management UI (add, close, rename, switch)'
status: Done
assignee:
  - developer
created_date: '2026-06-08 03:37'
updated_date: '2026-06-08 16:46'
labels:
  - subgraph-editor
  - ui
milestone: m-1
dependencies:
  - TASK-8
documentation:
  - backlog/docs/doc-1 - GraphQL-Playground-Design.md
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 8500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The subgraph editor currently shows tab buttons for each subgraph and lets you switch between them, but there's no way to add a new subgraph, close an existing one, or rename a tab from the UI. The Zustand store already has `addSubgraph()` but it's never called from the UI.

Add:
1. A `[+]` button at the end of the tab bar that calls `addSubgraph("subgraph-N")` with an auto-generated name (e.g. "subgraph-1", "subgraph-2").
2. A close/remove button (×) on each subgraph tab so users can remove a subgraph. Need a `removeSubgraph(index)` store action.
3. Ensure the tab switching works fluidly after add/remove (auto-select the right tab, handle removal of the active tab).
4. Styling polish: make the tab bar look like typical editor tabs (active tab highlighted, close button on hover).

The design doc shows the concept: `[products][users][+]`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A [+] button at the end of the tab bar creates a new subgraph with a unique auto-generated name, selects it, and focuses the editor
- [x] #2 Each subgraph tab has a close (×) button that removes the subgraph; removing the active tab selects the nearest neighbor
- [x] #3 Tab switching is smooth and the editor shows the correct subgraph's SDL at all times
- [x] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Subgraph Tab Management UI - Implementation Plan

## Overview

Add a [+] button, close (x) buttons on tabs, and polish tab bar styling to the subgraph editor. The store already has `addSubgraph()` but it is never called from the UI, and there is no `removeSubguardraph()` action yet.

## Key Files

### Modify
1. **`web/src/store.ts`** - Add `removeSubgraph(index)` store action; keep existing `addSubgraph(name)` as-is.
2. **`web/src/App.tsx`** - Replace the inline tab `<nav>` block (lines ~75-86) with proper tab components: [+] add button, close (x) on each tab, styling polish.

### No new files needed.
The tab bar is small enough to remain inline in `App.tsx`. Extracting a separate component would be premature abstraction for 3 buttons inside `App.tsx`.

## Changes by Acceptance Criterion

### AC#1: [+] button creates new subgraph with auto-generated name, selects it, focuses editor

**Store change (`store.ts`):**
- `addSubgraph(name)` already does exactly this: appends `{name, sdl: ""}` to the subgraphs array and sets `activeSubgraph` to the new index.
- Call it with an auto-generated name like `subgraph-{N}` where N = current subgraph count + 1 (e.g., if there are already `products`, we add `subgraph-2`).

**UI change (`App.tsx`):**
- Add an `<AddSubgraphButton>` handler in the tab nav that calls:
  ```ts
  const { subgraphs, addSubgraph } = useWorkspace();
  const handleAdd = () => addSubgraph(`subgraph-${subgraphs.length + 1}`);
  ```
- Place it as a `button` with `+` label at the end of the `<nav>` flex container.
- After adding, `activeSubgraph` is automatically set to the new subgraph (store handles this). The Monaco editor re-renders because `value={subgraphs[activeSubgraph]?.sdl}` changes. Optionally call `editor?.focus()` via `useEffect` on `activeSubgraph` change.

### AC#2: Close (x) button on each tab; removing active tab selects nearest neighbor

**Store change (`store.ts`):**
- Add a new action:
  ```ts
  removeSubgraph: (index: number) => void;
  ```
- Implementation logic:
  - Filter out the subgraph at `index`.
  - Set `activeSubgraph` to `min(index, remainingCount - 1)` so if we close the last tab, it selects the one before; if we close a middle tab, it shifts down (the next tab slides into that index).
  - Minimum: keep at least 1 subgraph (do not allow removing the last one).
  ```ts
  removeSubgraph: (index) =>
    set((state) => {
      const remaining = state.subgraphs.filter((_, i) => i !== index);
      if (remaining.length === 0) return state; // keep at least 1
      const newActive = Math.min(index, remaining.length - 1);
      return { subgraphs: remaining, activeSubgraph: newActive };
    }),
  ```

**UI change (`App.tsx`):**
- Render an `<x>` button inside each tab button (or beside it).
- Use `onClick` with `e.stopPropagation()` so clicking close doesn't also activate that tab.
- Call `removeSubgraph(i)` from the handler.

### AC#3: Smooth tab switching, editor shows correct SDL at all times

**Existing behavior:**
- `activeSubgraph` change triggers re-render of Monaco `Editor` because `value={subgraphs[activeSubgraph]?.sdl ?? ""}` is a derived prop. This already works.
- After remove: `activeSubgraph` is set to nearest neighbor in the store, so the editor immediately shows the correct SDL. No additional work needed beyond correct store logic.

**Verification:** The existing validation effect (`useEffect` on `[editor, monacoInstance, activeSubgraph, subgraphs]`) will re-run and validate the new active subgraph's SDL automatically.

### AC#4: `pnpm tsc --noEmit` and `pnpm lint` pass

- All new code typed with existing types (`WorkspaceState` interface extended for `removeSubgraph`).
- No external dependencies added. Standard React patterns only.

## Styling Polish (AC implicit)

Replace the current plain `<button>` tabs with CSS that looks like editor tabs:
- Active tab: solid bottom border or background highlight, distinct color.
- Inactive tabs: muted background, no border-bottom.
- Close button: hidden by default, shown on hover of its parent tab via CSS `:hover .close-btn` selector.
- [+] button: slightly different style (no close button, maybe a distinct icon or outlined look).

Since this is inline styles in `App.tsx`, use a small `<style>` block or Tailwind-style class names if available. Given the project uses inline styles currently, add CSS classes via a `<style>` tag at top of `App.tsx` using a unique class prefix (e.g., `.sg-tab-...`) to avoid global bleed.

## Store API Summary

| Action | Existing? | Signature | Purpose |
|--------|-----------|-----------|---------|
| `addSubgraph(name: string)` | Yes | Already in store | Append new subgraph, auto-select it |
| `removeSubgraph(index: number)` | **New** | Add to store | Remove by index, select neighbor, min 1 |
| `setActiveSubgraph(index: number)` | Yes | Already in store | Select tab by index |

## Risks & Prerequisites

1. **TASK-8 dependency:** This task depends on TASK-8 (the base subgraph editor). The tab `<nav>` already exists and works, so no blocker.
2. **Monaco editor re-mounting:** Changing `path` prop forces Monaco to treat it as a new model. Current code uses `path={"sg-" + activeSubgraph}` which is stable per-subgraph index. After removing a subgraph, remaining indices shift - the next tab might get a different path string. **Mitigation:** The `key` on `<Editor>` should be based on `activeSubgraph` (already done via `path`). The editor will re-render correctly; worst case Monaco does a soft reset of the model which is acceptable.
3. **No rename UI in scope:** The task title mentions "rename" but the description and ACs do not require it. Skip rename for now; it can be a follow-up ticket.

## Implementation Order

1. Add `removeSubgraph` to the Zustand store (`store.ts`) with tests in `store.test.ts`.
2. Modify `App.tsx` tab nav: add [+] button, close (x) buttons, styling CSS classes.
3. Verify `pnpm tsc --noEmit` and `pnpm lint` pass.
4. Optional: add a snapshot-style test in `App.test.tsx` or `store.test.ts` for remove-edge-cases.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added subgraph tab management UI: a [+] button at end of tab bar that auto-generates names (subgraph-N), close (x) buttons on each tab with nearest-neighbor selection when active tab is removed, and minimum-one-subgraph protection. Store gained removeSubgraph(index) action. All 4 acceptance criteria met; store tests (10) and App tests (14 relevant) pass cleanly.
<!-- SECTION:FINAL_SUMMARY:END -->
