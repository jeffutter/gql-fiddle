---
id: TASK-94
title: Harden cloud sync engine against silent data loss
status: Done
assignee: []
created_date: '2026-07-01 00:25'
updated_date: '2026-07-02 01:23'
labels:
  - review
  - planned
dependencies:
  - TASK-94.1
  - TASK-94.2
  - TASK-94.3
ordinal: 58500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent tracking ticket for sync hardening. The mergeWorkspaces pure function is well-tested, but the imperative orchestration around it in web/src/sync.ts has several data-loss races found in a code review (version-bump lost updates, client-clock delta skew, stale offline-queue flushes, un-queued deletes). Subtasks address each.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Pure tracking ticket — no direct implementation of its own. All three data-loss
races identified in the sync-engine code review are fully delegated to
sub-tickets, each independently testable and shippable:

1. TASK-94.1 (bump version synchronously on save) — must land first. It makes
   the Zustand store the single source of truth for the monotonic version
   counter, which TASK-94.3's re-read-from-current-store-state fix depends on
   (hence TASK-94.3 already declares TASK-94.1 as a dependency).
2. TASK-94.2 (server-provided delta-sync cursor) — independent of the other
   two; touches both functions/_lib/db.ts (server high-water-mark cursor) and
   web/src/sync.ts (pull loop). Can be built and shipped in parallel with
   TASK-94.1/94.3.
3. TASK-94.3 (flush offline queue from live store state + queue failed
   deletes) — depends on TASK-94.1 landing first so flushOfflineQueue can
   re-read the authoritative version/content from the store instead of a
   stale captured snapshot.

Suggested execution order: TASK-94.1 → TASK-94.3, with TASK-94.2 done any time
(no shared code with the other two beyond the general sync.ts file).

Integration/verification once all three are done:
- Re-read web/src/sync.ts end-to-end and confirm the three fixes compose
  cleanly (no duplicate version-bump logic, no orphaned lastPullTs usage,
  tombstone queue wired into the same reconnect flow as the edit queue).
- Run the full web test suite (nix develop -c bash -c "cd web && pnpm test")
  plus any new regression tests added by each sub-ticket (rapid-edit burst,
  clock-skew delta pull, offline edit/delete + reconnect).
- Manually verify via the dev server: rapid edits produce monotonic versions
  with no lost update; a simulated clock-skewed client still receives
  cross-device deltas; an offline edit-then-delete sequence reconciles
  correctly on reconnect.
- No further direct work on TASK-94 itself; close it once all three
  sub-tickets are Done.
<!-- SECTION:PLAN:END -->
