---
id: TASK-94.2
title: Use a server-provided cursor for delta sync instead of client wall-clock
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
dependencies: []
parent_task_id: TASK-94
priority: high
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/sync.ts (~173, ~213) sets 'since' from the client's Date.now(), but the server (functions/_lib/db.ts ~120, ~188) filters updated_at > since using its own clock. A client clock ahead of the server means newer server rows are never delivered until a full re-login (missed cross-device edits and deletes). Also lastPullTs stamped at request start can miss writes committed during the in-flight pull. Fix: return a server high-water-mark cursor in each pull response and feed that back as 'since'; prefer >= with dedup over > to close the in-flight gap. Server + client change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a cross-device edit propagates with the client clock skewed +10 minutes
- [ ] #2 no delta is missed when a write commits during an in-flight pull
- [ ] #3 the server cursor contract is documented in AGENTS.md
<!-- AC:END -->
