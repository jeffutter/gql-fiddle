---
id: TASK-119
title: Real-time collaborative editing (live multi-user sync)
status: Blocked
assignee: []
created_date: '2026-07-23 01:58'
updated_date: '2026-08-08 01:01'
labels:
  - planned
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
### Overview

This is an umbrella/tracking ticket for real-time collaborative editing. All
direct implementation work was delegated to three subtasks, which are now
all Done:

- TASK-119.1 (Live sync backend) — Cloudflare Worker + Durable Object
  (`live-sync/`) using Yjs CRDTs over WebSocket, with D1 persistence
  (`live_sessions` table, migration 0004) and 24h idle cleanup via DO alarm.
  Fully separate from the existing account-based D1/KV sync in `functions/`.
- TASK-119.2 (Client editor integration) — Monaco editors in
  `web/src/App.tsx` wired to the Yjs session via a custom provider
  (`web/src/useLiveSession.ts`) that adapts the DO relay's custom framing to
  the standard Yjs provider API. Awareness (cursors/selections) and a
  connection-status indicator are included; solo editing is unaffected.
- TASK-119.3 (Ephemeral share-link flow) — UI to start/join a live session
  from an open workspace, distinct from the static snapshot share link in
  `web/src/share.ts`; joining requires no account and grants no persistent
  workspace access; stale/host-disconnected sessions are surfaced to
  participants.

### How the pieces fit together

1. A user starts a live session for their open workspace (TASK-119.3 UI),
   which creates a session via the Pages Function in
   `functions/api/live-session/` and obtains a session id (TASK-119.1).
2. The client connects over WebSocket to the Durable Object
   (`live-sync/src/session.ts`) using the custom provider in
   `web/src/useLiveSession.ts` (TASK-119.2), which syncs Monaco editor state
   (subgraph schemas, query tabs, mock config) as a Yjs document.
3. Additional participants join via the ephemeral link (TASK-119.3), connect
   to the same session id, and converge on shared state through Yjs CRDT
   merge — no last-write-wins, no data loss on concurrent edits.
4. None of this touches the existing static snapshot share link
   (`web/src/share.ts`) or the account-based cross-device sync
   (D1 + KV in `functions/`), which remain on their own separate code paths
   and data models.

### Integration / verification steps

- Confirmed `live-sync/src` (Worker + DO) and the web-side wiring
  (`web/src/App.tsx`, `web/src/useLiveSession.ts`, `web/src/store.ts`) exist
  in the tree and reference each other consistently.
- Each subtask's automated tests (15 tests in `live-sync/`, editor sync
  tests against a mocked provider in `web/`) already cover their slice;
  no additional cross-cutting integration tests are introduced by this
  umbrella ticket.
- Parent acceptance criteria are satisfied transitively by the subtasks:
  - AC#1 (simultaneous multi-user edits, real-time) ← TASK-119.1 + TASK-119.2
  - AC#2 (no-account join, no persistent access change) ← TASK-119.3
  - AC#3 (static share link & account sync unchanged) ← all three subtasks
    explicitly scoped to avoid touching `web/src/share.ts` or the
    account-based D1/KV sync

### Remaining work

None captured under this ticket directly — all implementation work is
complete via the three subtasks. This ticket is a pure tracking/epic
ticket and is set to Blocked per convention (e.g. TASK-8) pending a
future pass to promote it to Done now that all children are Done.
<!-- SECTION:PLAN:END -->
