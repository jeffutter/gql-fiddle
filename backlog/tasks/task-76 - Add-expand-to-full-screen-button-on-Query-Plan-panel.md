---
id: TASK-76
title: Add expand-to-full-screen button on Query Plan panel
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 01:34'
updated_date: '2026-06-23 03:08'
labels:
  - enhancement
  - ux
  - planned
dependencies: []
modified_files:
  - web/src/App.tsx
priority: low
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Query Plan panel is missing the expand-to-full-screen button that other panels in the app already have. Add the same expand/collapse full-screen control to the Query Plan panel so it is consistent with the rest of the UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Query Plan panel has an expand-to-full-screen button in the same position and style as equivalent buttons on other panels
- [x] #2 Clicking the button expands the Query Plan panel to fill the available workspace
- [x] #3 Clicking again (or pressing Escape) collapses it back to its normal size
- [x] #4 Behavior and styling are consistent with the full-screen toggle on other panels
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add the expand-to-full-screen button to the Query Plan tab in the Results panel, matching the existing pattern already used for Sequence Diagram, Timeline, and Schema Tree tabs.

## Relevant files

- `web/src/App.tsx` — the only file that needs to change.

## What the existing pattern does

1. `fullscreenTab` state holds which tab is currently fullscreened (or `null`). Its union type currently excludes `"plan"`.
2. An SVG icon button is rendered in the Results tab strip when the active tab supports fullscreen. The condition on line 1534 is:
   `resultsTab === "sequence" || resultsTab === "timeline" || resultsTab === "schema-tree"`
3. `VISUAL_TAB_LABELS` maps each fullscreen-capable tab key to a human-readable label used as the modal `aria-label`.
4. The fullscreen modal body renders the matching content variable by checking `fullscreenTab === "<key>"`.

## Changes required (all in `web/src/App.tsx`)

### 1. Extend the `fullscreenTab` type (line 168-170)

Add `"plan"` to the union:

```tsx
const [fullscreenTab, setFullscreenTab] = useState<
  "plan" | "sequence" | "timeline" | "entities" | "type-graph" | "schema-tree" | null
>(null);
```

### 2. Add `"plan"` to `VISUAL_TAB_LABELS` (around line 1371-1379)

```tsx
const VISUAL_TAB_LABELS: Record<
  "plan" | "sequence" | "timeline" | "entities" | "type-graph" | "schema-tree",
  string
> = {
  plan: "Query Plan",
  sequence: "Sequence Diagram",
  timeline: "Timeline",
  entities: "Entity Ownership Graph",
  "type-graph": "Type Graph",
  "schema-tree": "Schema Tree",
};
```

### 3. Show the expand button when `resultsTab === "plan"` (lines 1534-1560)

Change the condition:

```tsx
{(resultsTab === "plan" ||
  resultsTab === "sequence" ||
  resultsTab === "timeline" ||
  resultsTab === "schema-tree") && (
  <button
    className="btn btn--icon"
    style={{ marginLeft: "auto" }}
    title="Expand to full screen"
    aria-label="Expand to full screen"
    onClick={() => setFullscreenTab(resultsTab)}
  >
    ...SVG unchanged...
  </button>
)}
```

### 4. Render `planContent` in the fullscreen modal body (lines 1625-1629)

Add one line inside the modal body:

```tsx
{fullscreenTab === "plan" && planContent}
{fullscreenTab === "sequence" && sequenceContent}
...
```

## Verification

- Click the expand icon on the Query Plan tab; the modal should open with the plan tree (or the "Run a query to see the plan" empty state).
- Clicking the modal backdrop or pressing Escape closes it.
- The expand icon is absent when other tabs (Output) are active in the Results panel.
- Existing fullscreen behavior for Sequence Diagram, Timeline, and Schema Tree is unaffected.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by making four targeted changes to `web/src/App.tsx`:
1. Added `"plan"` to the `fullscreenTab` useState type union (line 169)
2. Added `plan: "Query Plan"` entry to `VISUAL_TAB_LABELS` and extended its Record type key union to include `"plan"` (lines 1370-1380)
3. Added `resultsTab === "plan"` to the condition that renders the expand button in the Results tab nav (line 1535)
4. Added `{fullscreenTab === "plan" && planContent}` inside the fullscreen modal body (line 1627)

TypeScript reports no type errors after the changes. The pattern is identical to how the Sequence Diagram, Timeline, and Schema Tree tabs work.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the expand-to-full-screen button to the Query Plan panel in `web/src/App.tsx` by extending the `fullscreenTab` type union to include `\"plan\"`, adding a `\"Query Plan\"` label to `VISUAL_TAB_LABELS`, including `resultsTab === \"plan\"` in the expand-button visibility condition, and rendering `planContent` inside the fullscreen modal body — matching the existing pattern used by Sequence Diagram, Timeline, and Schema Tree.
<!-- SECTION:FINAL_SUMMARY:END -->
