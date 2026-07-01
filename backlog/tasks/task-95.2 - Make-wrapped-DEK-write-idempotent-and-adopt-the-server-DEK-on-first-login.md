---
id: TASK-95.2
title: Make wrapped-DEK write idempotent and adopt the server DEK on first login
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 00:30'
labels:
  - review
dependencies:
  - TASK-95.1
parent_task_id: TASK-95
priority: high
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/encryption.ts:96-111 persists the freshly-generated wrapped DEK via a fire-and-forget PUT /api/auth/enc-meta whose response is never checked. Two devices racing first-login each generate a different DEK; the loser keeps encrypting under a DEK the server no longer maps, producing permanently undecryptable workspaces (compounded by the silent-plaintext bug in ENC.1). Fix: make the server enc-meta PUT idempotent (only set wrapped_dek if currently null, otherwise return the existing wrapped_dek), and have the client adopt the server's returned wrapped DEK rather than assuming its own won. Server (functions/api/auth/enc-meta.ts) + client change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 two simulated first-login devices converge on a single DEK
- [ ] #2 the losing device adopts the winner's wrapped DEK and can decrypt prior uploads
- [ ] #3 the enc-meta PUT is idempotent server-side (only sets wrapped_dek when null)
<!-- AC:END -->
