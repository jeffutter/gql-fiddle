---
id: TASK-94
title: Harden cloud sync engine against silent data loss
status: Backlog
assignee: []
created_date: '2026-07-01 00:25'
labels:
  - review
dependencies: []
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent tracking ticket for sync hardening. The mergeWorkspaces pure function is well-tested, but the imperative orchestration around it in web/src/sync.ts has several data-loss races found in a code review (version-bump lost updates, client-clock delta skew, stale offline-queue flushes, un-queued deletes). Subtasks address each.
<!-- SECTION:DESCRIPTION:END -->
