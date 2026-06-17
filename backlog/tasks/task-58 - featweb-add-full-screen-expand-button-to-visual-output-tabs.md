---
id: TASK-58
title: 'feat(web): add full-screen expand button to visual output tabs'
status: To Do
assignee: []
created_date: '2026-06-17 01:22'
labels:
  - web
  - ux
  - visualization
dependencies: []
priority: medium
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The embedded output panel is too small for the visual tabs (Timeline, Schema Graph, Entity Ownership Graph, etc.). Add a small expand icon in the top-right corner of each visual tab that opens the content in a full-screen modal overlay, giving users more room to explore complex visualizations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each visual output tab (Timeline, Schema Graph, Entity Ownership Graph, and any future visual tabs) has a small expand/fullscreen icon in its top-right corner
- [ ] #2 Clicking the icon opens the tab content in a modal overlay that fills most of the viewport
- [ ] #3 The modal has a close button (X or Escape key) to return to the normal panel view
- [ ] #4 The modal renders the same component/visualization as the embedded tab with no loss of interactivity
- [ ] #5 The icon is unobtrusive and does not interfere with existing tab content or controls
<!-- AC:END -->
