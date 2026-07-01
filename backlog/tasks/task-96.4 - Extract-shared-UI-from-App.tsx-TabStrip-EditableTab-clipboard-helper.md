---
id: TASK-96.4
title: 'Extract shared UI from App.tsx: TabStrip, EditableTab, clipboard helper'
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
dependencies: []
parent_task_id: TASK-96
priority: low
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/App.tsx duplicates the tab strip + content switch 3-4x (desktop output ~2152, desktop results ~2288, mobile ~1950, fullscreen ~2402); the rename-on-double-click + close editable-tab pattern 3x (subgraph/query/workspace, 6 state var pairs); and the clipboard fallback block 4x (copyError, copyForLLM, copyShareUrl, copyTourShareUrl — all sharing one 'copied' state). Extract a <TabStrip>, an <EditableTab>, and a copyText()/useCopyToClipboard() helper (~400 lines of mechanical dedup).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 one TabStrip, one EditableTab, and one clipboard helper replace the duplicates
- [ ] #2 independent copy buttons show their 'Copied\!' state independently
- [ ] #3 behavior is unchanged
<!-- AC:END -->
