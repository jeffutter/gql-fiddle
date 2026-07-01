---
id: TASK-94.1
title: Bump workspace version synchronously on save to prevent lost updates
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
dependencies: []
parent_task_id: TASK-94
priority: high
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/sync.ts (~257, ~329): autoSave computes bumped = {...ws, version:(ws.version ?? 0)+1} but the local store version only advances when the server echo (rowToEntry) returns. Two edits faster than the round-trip both read the old version and send version N+1; the server accepts both (>=) and the second silently clobbers the first with no 409. Fix: bump version in the Zustand store synchronously when a save is scheduled/sent (single source of truth for the monotonic counter); treat the server echo as confirmation only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a burst of N rapid edits produces N distinct monotonic version increments
- [ ] #2 no save silently overwrites a newer local edit (no lost update)
- [ ] #3 a regression test simulates edits faster than the mocked round-trip
<!-- AC:END -->
