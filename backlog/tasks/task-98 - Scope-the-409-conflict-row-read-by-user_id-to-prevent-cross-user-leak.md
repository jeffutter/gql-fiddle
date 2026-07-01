---
id: TASK-98
title: Scope the 409 conflict row read by user_id to prevent cross-user leak
status: Backlog
assignee: []
created_date: '2026-07-01 00:27'
labels:
  - review
dependencies: []
priority: medium
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-ACC-1.00, SEC-DAT-1.00. functions/_lib/db.ts:136-139 upsertWorkspace re-reads the conflicting row with SELECT * WHERE id = ? (unscoped) and functions/api/workspaces/[id].ts:69 returns it in the 409 body as {conflict, current}. Reachable only via a deliberate UUID-collision race (the handler pre-check at [id].ts:51-58 catches existing cross-user rows), but if hit it leaks another user's full payload and user_id. Fix: scope the post-upsert re-read by user_id (WHERE id = ? AND user_id = ?); if no row, treat as not-accepted/404; never return a row whose user_id \!= caller.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a PUT that conflicts on another user's row never returns that row's payload or user_id
- [ ] #2 a normal same-user stale-version 409 still returns the caller's current row
<!-- AC:END -->
