---
id: TASK-71.2
title: Pane visibility toggle controls in tour authoring mode
status: To Do
assignee: []
created_date: '2026-06-21 01:29'
updated_date: '2026-06-21 01:39'
labels:
  - tour
  - authoring
  - ui
  - planned
dependencies:
  - TASK-71.1
parent_task_id: TASK-71
priority: medium
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add UI controls in tour authoring mode that let authors toggle which panes (variables, response, headers, etc.) are visible for the current step. The state set here gets persisted to the tour step data model (introduced in TASK-71.1) and later enforced during playback (TASK-71.3).

The controls should be co-located with the other per-step settings so authors can see and adjust pane visibility while composing each step's content.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each non-schema pane has a toggle (checkbox, switch, or similar) in the step authoring UI
- [ ] #2 Toggle state persists when saving/loading the tour
- [ ] #3 The authoring view itself reflects the visibility state so authors see what viewers will see
- [ ] #4 Toggling a pane in one step does not affect other steps
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Goal
Add a `setStepPaneVisibility` store action and per-step pane toggle UI inside `TourAuthoringPanel` so authors can control which panes are visible for each step. Depends on TASK-71.1 for the `PaneVisibility` type.

### Files to modify
- `web/src/store.ts` — add `setStepPaneVisibility` action to `WorkspaceState`
- `web/src/TourAuthoringPanel.tsx` — add toggle controls in the active-step expanded section

### Step 1 — Add `setStepPaneVisibility` to `store.ts`

In the `WorkspaceState` interface, add after `setStepAnchor`:

```ts
setStepPaneVisibility: (
  stepIndex: number,
  pane: PaneId,
  visible: boolean,
) => void;
```

Import `PaneId` from `./share`.

In the `useWorkspace` create callback, add the implementation:

```ts
setStepPaneVisibility: (stepIndex, pane, visible) =>
  set((state) => {
    if (!state.tourDraft) return state;
    const updatedSteps = state.tourDraft.steps.map((step, i) => {
      if (i !== stepIndex) return step;
      const pv = { ...(step.paneVisibility ?? {}), [pane]: visible };
      return { ...step, paneVisibility: pv };
    });
    return { tourDraft: { ...state.tourDraft, steps: updatedSteps } };
  }),
```

This mirrors the shape of `setStepAnchor` — immutable step update, no mutation of the existing array.

### Step 2 — Add toggles to `TourAuthoringPanel.tsx`

Import `setStepPaneVisibility` from the store, and `PaneId` from `./share`.

Inside the `draft.steps.map(...)` render loop, find the `{isActive && (...)}` section that shows the anchor display and "Save Step" button. Add a new pane-visibility section between the anchor display and the save button:

```tsx
{isActive && (
  <div className="tour-step__pane-visibility">
    <span className="tour-step__pane-visibility-label">Visible panes:</span>
    {(["schema", "plan"] as PaneId[]).map((pane) => {
      const checked = step.paneVisibility?.[pane] !== false; // default = visible
      return (
        <label key={pane} className="tour-step__pane-toggle">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setStepPaneVisibility(i, pane, e.target.checked)}
            aria-label={`Show ${pane} pane for step ${i + 1}`}
          />
          {pane === "schema" ? "Schema" : "Query Plan"}
        </label>
      );
    })}
  </div>
)}
```

**Default logic:** `paneVisibility?.[pane] !== false` — when the flag is `undefined` (not yet set by the author), the checkbox shows checked (visible is the default). Only an explicit `false` hides the pane.

### Step 3 — Wire `setStepPaneVisibility` into component

In the `useWorkspace` destructure at the top of `TourAuthoringPanel`, add `setStepPaneVisibility`.

### Step 4 — CSS (minimal additions)

Add classes `tour-step__pane-visibility`, `tour-step__pane-visibility-label`, and `tour-step__pane-toggle` to the project's CSS file (likely `web/src/index.css` or similar). Layout: a small flex row with a label and two inline checkbox+label pairs, similar to the existing anchor section.

### Step 5 — Verify round-trip

The panel calls `setStepPaneVisibility` which updates `tourDraft` in the store. The store's `partialize` already persists `tourDraft` to localStorage. `encodeTour` serializes the draft. When the tour is shared and decoded, `paneVisibility` survives because it's a plain JSON field. No additional persistence wiring is needed.

### Acceptance criteria mapping
- AC#1 — checkboxes for each non-schema pane (schema editor, query plan) appear in the step UI.
- AC#2 — state persists via `tourDraft` in localStorage and survives share-link encode/decode (tested by TASK-71.1 round-trip tests).
- AC#3 — the authoring view itself does NOT yet reflect visibility (that is TASK-71.3). The authoring panel shows the toggle state, not the live layout change. (Note: reflecting visibility in authoring mode is technically a TASK-71.3 concern — the playback enforcement. If the team decides the authoring view should also hide/show panes live, that can be done in TASK-71.3 by reading `tourDraft.steps[tourActiveStep].paneVisibility` from the store.)
- AC#4 — toggling step 1 does not affect step 2's visibility because each step's `paneVisibility` is independent.

### Verification
Run `npm test` in `web/`. Add a vitest test in `store.test.ts` verifying `setStepPaneVisibility` sets the flag correctly and does not affect adjacent steps.
<!-- SECTION:PLAN:END -->
