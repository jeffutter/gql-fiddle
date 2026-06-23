---
id: TASK-82
title: >-
  fix(tours): autosave current step on navigation and remove unsaved-changes
  confirm dialog
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 19:16'
updated_date: '2026-06-23 20:00'
labels:
  - fix
  - tours
  - web
  - planned
dependencies: []
modified_files:
  - web/src/store.ts
  - web/src/TourAuthoringPanel.tsx
priority: medium
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When switching between steps in the tour authoring panel, a `window.confirm("You have unsaved changes to this step. Navigate away?")` dialog fires even when the author has not touched the workspace. This is partly a UX mismatch (the expected behaviour is autosave, not an explicit Save Step action) and partly a false-positive bug.

## False-positive root cause

`loadTourStep` restores `subgraphs`, `queryTabs`, `activeQueryTab`, and `seed` from the resolved step — but does **not** restore `mockConfig` (`store.ts` line ~192). Meanwhile `hasUnsavedChanges` calls `computeOverrides(resolvedStep, currentWorkspace)`, which compares `mockConfig` as well. If the live store's `mockConfig` differs from what the resolved step would produce (e.g. `""` vs `undefined`), the diff is non-empty and the confirm fires for a change the author never made.

## Fix

In `TourAuthoringPanel.tsx`, replace the confirm-or-abort pattern in `navigateToStep` with an unconditional autosave:

```ts
function navigateToStep(targetIndex: number) {
  // Autosave current step before switching, mirroring the "Save Step" button.
  if (tourActiveStep !== null) {
    snapshotCurrentToStep(tourActiveStep);
  }
  loadTourStep(targetIndex);
  setTourActiveStep(targetIndex);
  setEditingStepIndex(targetIndex);
}
```

Delete `hasUnsavedChanges` — it is only used in `navigateToStep` and is no longer needed.

Also fix `loadTourStep` in `store.ts` to restore `mockConfig` alongside the other workspace fields, so step loads are fully symmetric with saves:

```ts
loadTourStep: (stepIndex) =>
  set((state) => {
    if (!state.tourDraft) return state;
    const payload = resolveTourStep(state.tourDraft, stepIndex);
    return {
      subgraphs: payload.subgraphs,
      queryTabs: payload.queryTabs,
      activeQueryTab: payload.activeQueryTab,
      seed: payload.seed,
      mockConfig: payload.mockConfig ?? "",   // add this
    };
  }),
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Switching between steps in the authoring panel never shows a confirm dialog
- [x] #2 The current step's workspace is automatically snapshotted before the new step loads (same effect as clicking Save Step)
- [x] #3 loadTourStep restores mockConfig so step loads are fully symmetric with snapshotCurrentToStep
- [x] #4 hasUnsavedChanges is deleted — no dead code remains
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

This is a two-file fix:
1. `web/src/store.ts` — restore `mockConfig` in `loadTourStep` so step loads are fully symmetric with `snapshotCurrentToStep`.
2. `web/src/TourAuthoringPanel.tsx` — replace the confirm-or-abort pattern in `navigateToStep` with an unconditional autosave, and delete the now-unused `hasUnsavedChanges` function.

No sub-tickets are needed — the changes are small, tightly coupled, and must ship together (the store fix removes the false positive that triggers the dialog; the panel fix removes the dialog).

## Step 1: Fix `loadTourStep` in `store.ts`

File: `web/src/store.ts`, lines ~189–199.

Add `mockConfig: payload.mockConfig ?? ""` to the object returned inside the `set` callback of `loadTourStep`:

```ts
loadTourStep: (stepIndex) =>
  set((state) => {
    if (!state.tourDraft) return state;
    const payload = resolveTourStep(state.tourDraft, stepIndex);
    return {
      subgraphs: payload.subgraphs,
      queryTabs: payload.queryTabs,
      activeQueryTab: payload.activeQueryTab,
      seed: payload.seed,
      mockConfig: payload.mockConfig ?? "",   // ← add this line
    };
  }),
```

`resolveTourStep` returns a `WorkspacePayload` which already carries `mockConfig` (it's the field that `snapshotCurrentToStep` stores in `overrides`). The `?? ""` guards against steps whose overrides predate the `mockConfig` field (stored as `undefined`), matching the empty-string default used elsewhere in the store.

## Step 2: Rewrite `navigateToStep` in `TourAuthoringPanel.tsx`

File: `web/src/TourAuthoringPanel.tsx`, lines ~47–62.

Delete the `hasUnsavedChanges` function entirely (lines 47–52) and replace `navigateToStep` (lines 55–62) with the autosave version:

```ts
/** Navigate to a step, autosaving the current step first. */
function navigateToStep(targetIndex: number) {
  if (tourActiveStep !== null) {
    snapshotCurrentToStep(tourActiveStep);
  }
  loadTourStep(targetIndex);
  setTourActiveStep(targetIndex);
  setEditingStepIndex(targetIndex);
}
```

The `computeOverrides` import from `./store` (line 6) is only used by `hasUnsavedChanges`. Once that function is deleted, remove that import too.

## Step 3: Verify

- Run `pnpm --filter web test` (or equivalent) to ensure existing tests pass.
- Manually switch between steps in the authoring panel and confirm no confirm dialog appears.
- Verify the workspace (including MockConfig YAML) updates correctly when switching steps.
- Confirm that after navigating away from a step, the step's stored overrides reflect what the workspace looked like before the switch (autosave working).

## Files to modify

- `web/src/store.ts` — one line added inside `loadTourStep`
- `web/src/TourAuthoringPanel.tsx` — `hasUnsavedChanges` deleted, `navigateToStep` rewritten, unused `computeOverrides` import removed
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete. Two files modified:

1. web/src/store.ts: Added  to the return object in , making step loads fully symmetric with .

2. web/src/TourAuthoringPanel.tsx:
   - Removed  function entirely.
   - Replaced  confirm-or-abort pattern with unconditional autosave via  before loading the new step.
   - Removed unused  import from .
   - Removed unused  type import from .
   - Removed unused , , ,  destructured from  (they were only needed by ).

TypeScript check passes with zero errors.

Implementation complete. Two files modified:

1. web/src/store.ts: Added `mockConfig: payload.mockConfig ?? ""` to the return object in `loadTourStep`, making step loads fully symmetric with `snapshotCurrentToStep`.

2. web/src/TourAuthoringPanel.tsx:
   - Removed `hasUnsavedChanges` function entirely.
   - Replaced `navigateToStep` confirm-or-abort pattern with unconditional autosave via `snapshotCurrentToStep` before loading the new step.
   - Removed unused `computeOverrides` import from `./store`.
   - Removed unused `WorkspacePayload` type import from `./share`.
   - Removed unused `subgraphs`, `queryTabs`, `activeQueryTab`, `seed` destructured from `useWorkspace()` (they were only needed by `hasUnsavedChanges`).

TypeScript check passes with zero errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the confirm-or-abort navigation pattern in TourAuthoringPanel with unconditional autosave: `navigateToStep` now calls `snapshotCurrentToStep` before loading the new step, eliminating the dialog entirely. Also fixed `loadTourStep` in `store.ts` to restore `mockConfig` alongside other workspace fields, closing the false-positive diff that could trigger the dialog even when the author had made no changes. Dead code (`hasUnsavedChanges`, unused imports/destructured vars) was removed. TypeScript passes cleanly.
<!-- SECTION:FINAL_SUMMARY:END -->
