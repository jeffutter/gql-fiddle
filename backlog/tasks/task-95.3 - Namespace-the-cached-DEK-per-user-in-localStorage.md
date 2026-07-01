---
id: TASK-95.3
title: Namespace the cached DEK per user in localStorage
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
dependencies: []
parent_task_id: TASK-95
priority: medium
ordinal: 140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/encryption.ts:16 caches the plaintext DEK under a single localStorage key (gql-fiddle-dek) shared by the anonymous/offline key and every authenticated user. Two users on one browser profile collide on one DEK entry; an anonymous-mode key can be silently adopted as the server DEK; logout does not clear it. Fix: namespace the cache key by user id (gql-fiddle-dek:<userId>), clear it on logout, and document the localStorage tradeoff in the file header (weakens the guarantee only against a local/XSS attacker, not the server).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 two users on one browser keep distinct cached DEKs
- [ ] #2 logout clears the current user's cached DEK
- [ ] #3 the anonymous key no longer collides with an authenticated DEK
<!-- AC:END -->
