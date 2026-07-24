---
id: TASK-119
title: Real-time collaborative editing (live multi-user sync)
status: Backlog
assignee: []
created_date: '2026-07-23 01:58'
labels: []
dependencies: []
type: feature
ordinal: 154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Workspaces currently support a static, snapshot-based share link (URL-encoded, see `web/src/share.ts`) and account-based cross-device sync (D1 + KV backend), but no way for two people to edit the same workspace at the same time. Add live, real-time collaborative editing so multiple users can simultaneously edit a workspace's subgraph schemas, query tabs, and mock config, with changes appearing for all participants as they happen.

Access to a live session is via an ephemeral share link: anyone with the link can join the live session directly in the browser. No account is required to join, and joining does not grant the joining user any persistent ownership of or access to the host's saved workspace after the session ends. This is distinct from, and does not replace, the existing static snapshot share link or the account-based cross-device sync.

This is an umbrella task; see subtasks for the sync backend, editor integration, and share-link/session flow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two or more users with the live session link can edit the same workspace at the same time and see each other's changes in real time
- [ ] #2 Joining a live session requires no account and does not persistently change ownership/access of the underlying workspace
- [ ] #3 The existing static snapshot share link and account-based cross-device sync continue to work unchanged
<!-- AC:END -->
