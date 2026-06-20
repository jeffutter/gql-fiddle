---
id: TASK-66
title: 'feat(web): tour authoring panel — create, edit, and manage steps'
status: To Do
assignee: []
created_date: '2026-06-20 03:13'
labels:
  - feat
  - web
  - tour
dependencies:
  - TASK-64
priority: high
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a tour authoring panel to the normal fiddle UI that lets an author build a guided tour from their current workspace.

**Design decisions from planning session:**
- A "Create Tour" button in the global header converts the current workspace into the tour `base` and opens the authoring panel alongside the normal fiddle (no full mode switch — the fiddle remains fully functional).
- The author adds steps by editing the schema/query as desired, then clicking "Add Step" to snapshot the current workspace. Each step stores only `overrides` (what differs from `base`), not the full payload.
- The author can navigate Prev/Next through existing steps; when on a step, the workspace reflects that step's resolved state (base + overrides). Clicking "Save Step" re-snapshots the current workspace into the active step's overrides.
- Step management: up/down arrows to reorder, trash button to delete. No drag-and-drop in v1.
- A "Share Tour" button (only visible when a tour draft exists) encodes the tour to `#t=` and copies the URL — replaces the normal "Share" button while authoring.
- The tour draft persists in localStorage (wired up in TASK-64).

**Key behaviours:**
- `resolveTourStep(tour, stepIndex)` (from TASK-64) drives what workspace is loaded when navigating to a step.
- "Add Step" snapshots current workspace: computes `overrides` as the diff of current subgraphs/queryTabs/seed against `base`, stores only changed top-level keys.
- "Save Step" does the same but updates the existing step rather than appending.
- Navigating away from a step with unsaved changes should warn or auto-save (decision left to implementer — warn is simpler).
- The panel is collapsible (toggle button). When collapsed, the full fiddle layout is restored.

**Files likely touched:** `web/src/App.tsx`, `web/src/store.ts`, `web/src/share.ts`, new `web/src/TourAuthoringPanel.tsx`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 'Create Tour' button appears in the global header when no tour draft exists
- [ ] #2 Clicking 'Create Tour' stores the current workspace as tour.base in tourDraft (localStorage-persisted)
- [ ] #3 The authoring panel appears alongside the fiddle (collapsible)
- [ ] #4 Tour title is editable in the panel
- [ ] #5 'Add Step' appends a new step with a label input and prose textarea; the step captures overrides vs base
- [ ] #6 Prev/Next navigation loads the resolved workspace for that step into the editors
- [ ] #7 'Save Step' updates the active step's overrides to match the current workspace state
- [ ] #8 Up/Down arrow buttons reorder steps correctly
- [ ] #9 Delete button removes a step (with confirmation if it has prose)
- [ ] #10 'Share Tour' encodes the tour draft to a #t= URL and copies it to the clipboard
- [ ] #11 'Exit Tour' or closing the panel clears the draft after confirmation
- [ ] #12 All step management actions are reflected in localStorage immediately
<!-- AC:END -->
