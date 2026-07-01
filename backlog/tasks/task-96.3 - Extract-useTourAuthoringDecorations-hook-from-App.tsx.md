---
id: TASK-96.3
title: Extract useTourAuthoringDecorations() hook from App.tsx
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
dependencies: []
parent_task_id: TASK-96
priority: low
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pull the three tour-authoring editor effects — click-to-anchor onMouseDown, anchor decoration, and tour-step highlight (web/src/App.tsx ~458-635, ~180 lines) — into a hook taking editor/monacoInstance/tourDraft/tourActiveStep/activeSubgraph. Removes the heaviest ref-juggling from the component body.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tour decoration and disposal bookkeeping live in one hook
- [ ] #2 behavior is unchanged
<!-- AC:END -->
