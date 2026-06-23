---
id: TASK-82
title: >-
  fix(tours): autosave current step on navigation and remove unsaved-changes
  confirm dialog
status: To Do
assignee: []
created_date: '2026-06-23 19:16'
labels:
  - fix
  - tours
  - web
dependencies: []
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
- [ ] #1 Switching between steps in the authoring panel never shows a confirm dialog
- [ ] #2 The current step's workspace is automatically snapshotted before the new step loads (same effect as clicking Save Step)
- [ ] #3 loadTourStep restores mockConfig so step loads are fully symmetric with snapshotCurrentToStep
- [ ] #4 hasUnsavedChanges is deleted — no dead code remains
<!-- AC:END -->
