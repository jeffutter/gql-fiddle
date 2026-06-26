---
id: TASK-87.4
title: >-
  Update shared URL handling for multi-workspace (#w= append vs replace, #t=
  open-in-workspace)
status: Done
assignee: []
created_date: '2026-06-26 13:09'
updated_date: '2026-06-26 17:54'
labels:
  - task
dependencies:
  - TASK-87.2
parent_task_id: TASK-87
priority: high
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the URL hash restore logic in `App.tsx` to handle multi-workspace semantics, and wire up the "Open in workspace" action for tour playback.

**#w= workspace links:**
- Current behavior: always replaces the entire store state with the decoded payload
- New behavior:
  - If `workspaces` is empty / no localStorage data → replace (first visit)
  - If workspaces exist → append decoded payload as a new `WorkspaceEntry` named "Workspace N" (next available number) and switch to it
- Change is in the `useEffect` mount handler in `App.tsx` (lines ~299–327)

**#t= tour links:**
- Add a new store action (in TASK-87.2's store, or wire here) that:
  1. Creates a new workspace from `tour.base`
  2. Pre-populates `tourDraft` with the full tour
  3. Sets `activeWorkspaceIndex` to the new workspace
- Wire this action into the `App.tsx` mount handler and pass it as `onOpenInWorkspace` prop to `TourPlayback` (see TASK-87.5 for the TourPlayback prop)

**Files changed:** `web/src/App.tsx` (URL mount effect, TourPlayback prop wiring)
<!-- SECTION:DESCRIPTION:END -->
