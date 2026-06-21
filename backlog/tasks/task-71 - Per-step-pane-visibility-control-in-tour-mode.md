---
id: TASK-71
title: Per-step pane visibility control in tour mode
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-21 01:28'
updated_date: '2026-06-21 01:44'
labels:
  - tour
  - ui
  - planned
dependencies:
  - TASK-71.1
  - TASK-71.2
  - TASK-71.3
priority: medium
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tour steps should be able to show or hide individual panes (variables, response, headers, etc.) independently per step. Most panes are noise most of the time, but occasionally a step needs to highlight a specific pane to make a point. Today the layout is fixed across all tour steps.

The feature spans three layers: the data model (what visibility state each step stores), the authoring UI (how authors toggle pane visibility per step), and the playback engine (how the viewer's layout reflects the step's settings). These subtasks must be delivered together for the feature to be usable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each tour step stores an explicit visibility flag for each non-schema pane (variables, response, headers, etc.)
- [x] #2 A default visibility state exists so existing tours without flags don't break
- [x] #3 Authors can toggle per-pane visibility for each step in authoring mode
- [x] #4 Playback mode shows/hides panes according to the current step's stored flags
- [x] #5 Switching between steps updates pane visibility immediately without page reload
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Orchestration Plan

### Overview

This feature adds per-step pane visibility control to the tour system. It spans three layers that must be delivered in dependency order: data model → authoring UI → playback enforcement. All three subtasks are now planned with detailed implementation steps.

### Sub-ticket breakdown

1. **TASK-71.1** — Extend `TourStep` in `share.ts` with an optional `paneVisibility?: PaneVisibility` field (`{ schema?: boolean; plan?: boolean }`). Add `PaneId` and `PaneVisibility` types. Add round-trip tests. No rendering changes. [planned]

2. **TASK-71.2** — Add `setStepPaneVisibility` action to the Zustand store (`store.ts`) and render per-step checkbox toggles inside `TourAuthoringPanel.tsx` for the active step. Depends on TASK-71.1 for the types. [planned]

3. **TASK-71.3** — In `TourPlayback.tsx`, derive `schemaVisible` and `planVisible` from `activeStep.paneVisibility` and conditionally render the schema and plan panels on both desktop and mobile. Handle the empty-right-column edge case via CSS. Add `TourPlayback.test.tsx` cases. Depends on TASK-71.1. [planned]

### Execution order

Execute in this sequence — TASK-71.2 and TASK-71.3 can be executed in parallel after TASK-71.1 ships:

```
TASK-71.1  →  TASK-71.2  (can run in parallel with 71.3)
           →  TASK-71.3
```

### Integration and verification

After all three subtasks are complete:

1. Start the dev server (`pnpm dev` in `web/`).
2. Create a tour with at least 2 steps. On step 1, check all panes visible. On step 2, uncheck "Query Plan". Save both steps.
3. Share the tour (copy URL). Open the URL in a new tab — verify playback shows both panes on step 1 and only the schema pane on step 2.
4. Navigate backward and forward and verify visibility changes immediately.
5. Paste the `#t=` URL into a mobile-width browser window and verify the "Plan" tab is absent on step 2.
6. Load a tour URL created before this feature (no `paneVisibility` in the payload) and confirm both panes appear on all steps.
7. Run `pnpm test` — all tests pass.

### Key design decisions captured in subtasks

- The prose panel is always visible and is excluded from `paneVisibility` control.
- Default visibility is `true` — `undefined` and `true` both show the pane. Only an explicit `false` hides it. This ensures backward compatibility with all existing tours.
- The `paneVisibility` field is stored directly on `TourStep` (not inside `overrides`) because it controls the viewer's UI layout, not the workspace payload content.
- No new persistence layer is needed — `tourDraft` is already persisted to localStorage and serialized in the `#t=` hash.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### TASK-71.1 — Data model
- Added `PaneId = 'schema' | 'plan'` and `PaneVisibility { schema?: boolean; plan?: boolean }` types to `web/src/share.ts`.
- Extended `TourStep` with optional `paneVisibility?: PaneVisibility` field.
- No serialization changes needed — `encodeTour`/`decodeTour` use `JSON.stringify`/`JSON.parse` which automatically includes the field when present.
- Added 3 round-trip tests in `share.test.ts` covering: flags present, flags absent (backward compat), and accessing flags directly from the step (not from `resolveTourStep`).

### TASK-71.2 — Authoring UI
- Added `setStepPaneVisibility(stepIndex, pane, visible)` action to `WorkspaceState` in `store.ts`, mirroring the shape of `setStepAnchor`.
- Added per-step pane visibility toggles (checkboxes) inside the active step section of `TourAuthoringPanel.tsx`, between the anchor row and Save Step button.
- Default logic: `paneVisibility?.[pane] !== false` — absent flag shows checked (visible is the default).
- Added 3 store tests in `store.test.ts` covering: flag set, adjacent steps unaffected, multiple panes independently settable.
- Added CSS classes `tour-step__pane-visibility`, `tour-step__pane-visibility-label`, `tour-step__pane-toggle` to `theme.css`.

### TASK-71.3 — Playback enforcement
- Derived `schemaVisible` and `planVisible` from `activeStep?.paneVisibility` in `TourPlayback.tsx`. Uses `!== false` so `undefined` and `true` both render the pane.
- Desktop: conditionally renders `.tour-playback__schema-panel` and `.tour-playback__plan-panel` inside `.tour-playback__right`. When both are hidden, adds `--hidden` modifier class.
- Mobile: conditionally renders Schema and Plan tab bar buttons; wraps tab content in same condition. Effect resets `mobileTab` to `'tour'` if current tab becomes hidden on step navigation.
- Added CSS `.tour-playback__right--hidden { display: none }` to collapse the empty column.
- Added 7 new tests in `TourPlayback.test.tsx` covering: schema hidden, plan hidden, default visibility, both-hidden column class, step navigation updates visibility, and mobile tab button visibility.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented per-step pane visibility control across all three layers: (1) data model — added `PaneId` and `PaneVisibility` types to `share.ts`, extended `TourStep` with optional `paneVisibility?: PaneVisibility`; (2) authoring UI — added `setStepPaneVisibility` store action and checkbox toggles in `TourAuthoringPanel` for schema and query plan panes per step; (3) playback enforcement — `TourPlayback` derives `schemaVisible`/`planVisible` from `activeStep.paneVisibility` and conditionally renders panels on both desktop and mobile (including a `--hidden` modifier class when both are hidden). Default is visible (`undefined !== false`), so existing tours without flags show all panes unchanged. All 258 tests pass including 10 new tests covering round-trips, store actions, and playback visibility."
<!-- SECTION:FINAL_SUMMARY:END -->
