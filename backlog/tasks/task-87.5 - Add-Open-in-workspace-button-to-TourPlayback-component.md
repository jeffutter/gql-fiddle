---
id: TASK-87.5
title: Add "Open in workspace" button to TourPlayback component
status: Done
assignee: []
created_date: '2026-06-26 13:09'
updated_date: '2026-06-26 17:54'
labels:
  - task
  - planned
dependencies:
  - TASK-87.4
parent_task_id: TASK-87
priority: medium
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend `TourPlayback.tsx` with an optional `onOpenInWorkspace` prop that renders an "Open in workspace" button in the playback UI.

**Changes in `web/src/TourPlayback.tsx`:**
- Add optional prop: `onOpenInWorkspace?: () => void`
- When provided, render an "Open in workspace" button in the playback toolbar/header
- Clicking the button calls `onOpenInWorkspace()` — the callback is responsible for creating the new workspace and exiting playback mode

**Wiring in `web/src/App.tsx`** (coordinate with TASK-87.4):
- The `onOpenInWorkspace` callback:
  1. Calls the store action that creates a workspace from `tour.base` + sets `tourDraft`
  2. Sets `playbackTour` to `null` to exit playback mode

This is a well-defined, bounded change. The TourPlayback component currently accepts `tour`, `initialStepIndex`, and `onExitPreview` props — this adds one more optional prop.
<!-- SECTION:DESCRIPTION:END -->
