---
id: TASK-111
title: Delete stale functions/api/health.js that shadows health.ts
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: low
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
functions/api/health.js and health.ts both exist with divergent behavior (.js returns {ok:true} only; its binding 'validation' const _db = ctx.env.DB is a no-op). Pages route resolution between a .js and .ts of the same name is ambiguous. Fix: delete health.js and keep the single .ts handler.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 functions/api/health.js is removed
- [ ] #2 /api/health returns the .ts {ok, bindings} shape
- [ ] #3 typecheck and tests pass
<!-- AC:END -->
