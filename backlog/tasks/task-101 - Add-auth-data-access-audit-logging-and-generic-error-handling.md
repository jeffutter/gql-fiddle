---
id: TASK-101
title: Add auth/data-access audit logging and generic error handling
status: Backlog
assignee: []
created_date: '2026-07-01 00:27'
labels:
  - review
dependencies: []
priority: medium
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-LOG-1.00, SEC-ERR-1.00, SEC-DAT-1.00. functions/ has zero structured logging for security events (login success/failure, session mint, logout, state-validation failures, cross-user 404s, wrapped-DEK writes) and no top-level error handling — unhandled D1 errors/throws (db.ts:64,141 include ids in messages) can surface as default Workers 500 pages leaking internals; error shapes are inconsistent (plain-text OAuth vs JSON {error} elsewhere). Fix: emit structured JSON logs for auth/permission/DEK-write events (user_id only, never tokens/payloads/KWK/wrapped_dek), add a shared try/catch wrapper returning a generic {error:'Internal error'} 500, and standardize the JSON error shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 auth events emit structured logs containing no tokens, payloads, KWK, or wrapped_dek
- [ ] #2 unexpected errors return a generic 500 without internal detail
- [ ] #3 error responses use one consistent JSON shape across endpoints
<!-- AC:END -->
