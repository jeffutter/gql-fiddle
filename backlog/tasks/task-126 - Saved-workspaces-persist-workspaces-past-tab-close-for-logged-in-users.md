---
id: TASK-126
title: 'Saved workspaces: persist workspaces past tab close for logged-in users'
status: Blocked
assignee: []
created_date: '2026-08-06 22:20'
updated_date: '2026-08-08 00:47'
labels:
  - feature
  - workspaces
  - sync
  - frontend
  - backend
  - planned
dependencies:
  - TASK-126.1
  - TASK-126.2
  - TASK-126.3
  - TASK-126.4
documentation:
  - AGENTS.md (Workspace API section)
  - web/src/sync.ts
  - web/src/store.ts
priority: medium
type: feature
ordinal: 158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Today, every workspace synced to a logged-in user's account automatically appears as an open tab on every device (`mergeWorkspaces` in `web/src/sync.ts` merges every non-deleted remote workspace into the local tab list), and closing a tab (`removeWorkspace` in `web/src/store.ts`) immediately soft-deletes the workspace on the server. There is no way to put a workspace aside without permanently losing it, and no way to browse a user's workspaces other than the currently-open tab strip.

## Desired outcome

Introduce a **Saved** state for workspaces, orthogonal to whether a workspace is currently open as a tab:

- A workspace can be marked **Saved**. This is per-workspace state that syncs across the user's devices, the same way workspace content does today.
- Whether a saved workspace is open-as-a-tab is itself shared/synced state (consistent with how the rest of a workspace's state already syncs across devices) — closing it on one device closes it everywhere; opening it opens it everywhere.
- Closing a tab for a **saved** workspace removes it from the tab bar (on all of the user's devices) but keeps it on the server — it can be reopened later.
- Closing a tab for a workspace that is **not saved** keeps today's behavior exactly: the workspace is soft-deleted immediately and cannot be recovered.
- A **Saved Workspaces** menu lets the user navigate every saved workspace regardless of whether it's currently open, open (restore) any of them into the tab bar, rename them, and permanently delete them.
- "Restore" and "open" are the same action — there is no separate undo/trash feature for non-saved workspaces. Deleting a non-saved workspace by closing it remains immediate and permanent, as today.
- This feature applies only to logged-in (cloud-synced) users. Anonymous/offline workspace behavior is unchanged.

This is the parent/umbrella task; implementation work is tracked in subtasks split by layer (backend schema/API, sync engine, and two frontend UI surfaces), mirroring how TASK-88 (cloud workspace sync) was structured.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A logged-in user can mark any open workspace as Saved and unmark it
- [ ] #2 Closing a tab for a saved workspace removes it from the tab bar without deleting it, and this reflects on the user's other logged-in devices
- [ ] #3 Closing a tab for a workspace that is not saved deletes it immediately and permanently, matching current behavior
- [ ] #4 A Saved Workspaces menu lists every saved workspace regardless of whether it is currently open as a tab, including ones closed on another device
- [ ] #5 From the Saved Workspaces menu, the user can open (restore) a saved workspace into the tab bar, rename it, and permanently delete it
- [ ] #6 Anonymous (not logged-in) users see no behavior change and do not see the Saved Workspaces menu
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Orchestration plan

This is a parent/umbrella ticket. All implementation work is delegated to four sub-tickets, split by layer, mirroring the TASK-88 (cloud workspace sync) structure. TASK-126 itself has no direct code changes — it is a tracking ticket that stays blocked until its children complete.

### Sub-ticket breakdown and sequencing

1. **TASK-126.1 — backend: schema & API for saved/open workspace state** (no deps; do first)
   - New migration adds `saved` and `open` (or equivalent open/closed) columns to the `workspaces` table in D1, defaulting existing rows to today's implicit behavior (every non-deleted workspace open everywhere, not saved).
   - `PUT /api/workspaces/:id` accepts and persists the new fields under the existing version/last-write-wins semantics.
   - `GET /api/workspaces` and `GET /api/workspaces?since=...` return the new fields.
   - Test coverage in `functions/__tests__/workspaces.test.ts`, and `AGENTS.md`'s Workspace API section documents the new fields.

2. **TASK-126.2 — web: sync engine — separate saved-workspace library from open tabs** (depends on TASK-126.1)
   - Update `mergeWorkspaces`/`pullWorkspaces` in `web/src/sync.ts` so closed-but-saved workspaces are tracked in a saved-workspace library without being merged into the tab bar.
   - Opening/closing a saved workspace's tab becomes shared state that propagates to all of a user's devices on next sync.
   - Non-saved workspace behavior (immediate soft-delete on close) is untouched.

3. **TASK-126.3 — web: save toggle & non-destructive close for saved workspaces** (depends on TASK-126.2)
   - Adds the Saved toggle (tab or workspace header menu) with a visible indicator.
   - Updates `removeWorkspace` (`web/src/store.ts`) / `onRemove` wiring (`web/src/App.tsx`) so closing a saved workspace's tab only clears its open state (via TASK-126.2), while closing a non-saved workspace keeps today's immediate-delete behavior.

4. **TASK-126.4 — web: Saved Workspaces menu — open, rename, delete** (depends on TASK-126.2; can run in parallel with TASK-126.3, no ordering dependency between them)
   - New menu, logged-in users only, listing all saved workspaces regardless of open/closed state.
   - Open (restore)/focus-existing-tab, rename (reuses `renameWorkspace`), and permanent delete-with-confirmation actions.

### Integration & verification

- Execution order: TASK-126.1 → TASK-126.2 → (TASK-126.3 and TASK-126.4 in parallel).
- After all four land, manually verify the full flow end-to-end: mark a workspace Saved, close its tab (confirm it survives, doesn't appear as deleted), reopen it from the Saved Workspaces menu, confirm cross-device sync behavior (simulate via a second sync pull), rename and permanently delete a saved workspace from the menu, and confirm anonymous/offline users see no UI changes and no Saved Workspaces menu.
- Confirm all six of TASK-126's acceptance criteria are satisfied by the combination of the four sub-tickets — no gaps: AC1/AC3 saved toggle + close semantics (126.3), AC2 cross-device close sync (126.2), AC4/AC5 Saved Workspaces menu (126.4), AC6 anonymous no-op (126.3/126.4), all resting on the schema/API foundation (126.1).
- No work remains outside the four sub-tickets; TASK-126 completes automatically once all children are Done.
<!-- SECTION:PLAN:END -->
