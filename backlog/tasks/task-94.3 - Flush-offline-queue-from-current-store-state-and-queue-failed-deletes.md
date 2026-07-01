---
id: TASK-94.3
title: Flush offline queue from current store state and queue failed deletes
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 00:30'
labels:
  - review
dependencies:
  - TASK-94.1
parent_task_id: TASK-94
priority: medium
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/sync.ts (~281-288) flushOfflineQueue re-runs autoSave on stale snapshots captured at edit time, re-bumping version and overwriting newer local content on reconnect (LWW >=). Separately deleteWorkspace (~151-156) ignores the response and never queues failed/offline deletes, so deletions can fail to propagate and reappear cross-device. Fix: on flush, re-read the current store entry by id (as the debounce path already does ~329) rather than pushing the captured snapshot; add a tombstone queue for failed/offline deletes, flushed alongside edits on reconnect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 editing a workspace offline then reconnecting pushes the latest content, not the stale snapshot
- [ ] #2 a delete issued offline propagates to the server on reconnect
- [ ] #3 a failed delete is retried rather than silently dropped
<!-- AC:END -->
