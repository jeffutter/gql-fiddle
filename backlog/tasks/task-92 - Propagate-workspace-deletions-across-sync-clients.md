---
id: TASK-92
title: Propagate workspace deletions across sync clients
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-27 20:31'
updated_date: '2026-06-28 04:48'
labels:
  - planned
dependencies: []
modified_files:
  - web/src/sync.ts
  - web/src/store.ts
  - web/src/sync.test.ts
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently when a workspace is deleted on one client (DELETE /api/workspaces/:id), the soft-delete and version bump are persisted server-side, but other connected clients don't learn about the deletion during sync. Deleted workspaces get recreated by other clients pulling stale data.

The delta sync endpoint (`GET /api/workspaces?since=<epochMs>`) already returns soft-deleted rows so clients can learn about deletions — but the client-side sync engine doesn't act on them. It needs to:

1. Honor `deleted_at` in delta responses by removing those workspaces from the local Zustand store
2. Remove deleted workspaces during full snapshot pulls on login
3. Ensure local-only deleted workspaces are properly cleaned up (no orphaned entries)

Server-side: soft-delete already works (migration 0001, `softDeleteWorkspace` in `db.ts`, DELETE endpoint). The delta query already includes deleted rows.

Client-side: `web/src/sync.ts` needs to filter out deleted workspaces during merge operations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When client B logs in after client A deleted workspace X before the login, workspace X is absent from client B's Zustand store after login sync completes.
- [x] #2 When client B has workspace Y that was never synced to the server (local-only, created offline), Y is pushed to the server during login sync.
- [x] #3 When client A deletes workspace Z while client B is online, client B's next deltaRefresh removes workspace Z from its store.
- [x] #4 The store always has at least one workspace after any sync operation (no empty workspaces array).
- [x] #5 activeWorkspaceIndex is always a valid index into the workspaces array after sync operations.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root Cause

`onLogin` in `web/src/sync.ts` calls `pullWorkspaces()` (no `?since` parameter), which uses `listWorkspaces(db, userId)` on the server — a query filtered to `WHERE deleted_at IS NULL`. Soft-deleted workspaces are excluded from the response.

When a workspace was deleted by another client before this login:
1. The full snapshot doesn't include the deleted workspace.
2. `mergeWorkspaces(local, rows)` treats the local copy as "local-only" and preserves it.
3. The push loop tries to re-upload it to the server (rejected by version check — server has a higher version from the soft-delete bump — but the return value is ignored).
4. `useWorkspace.setState({ workspaces: merged })` stores the zombie workspace locally.
5. Because `lastPullTs` is set to `Date.now()` after the full-snapshot pull, subsequent delta calls use a `since` timestamp that post-dates the deletion, so they never surface it either.

The delta path (`deltaRefresh`) is already correct: `pullWorkspaces(since)` uses the `?since=` endpoint which returns deleted rows, and `mergeWorkspaces` already handles `deleted_at !== null` by removing those entries from the result. The bug is only in `onLogin`.

## Fix in `web/src/sync.ts`

### 1. Change `onLogin` to pull with `since=0`

Replace:
```typescript
const rows = await pullWorkspaces();
```
with:
```typescript
const rows = await pullWorkspaces(0);
```

`pullWorkspaces(0)` hits `GET /api/workspaces?since=0`, which runs `WHERE user_id = ? AND updated_at > 0` — effectively returning all workspace rows ever created for the user, including soft-deleted ones. `mergeWorkspaces` already handles `deleted_at !== null` by calling `byId.delete(row.id)`, so the zombie workspace will be cleanly removed from the merged result. The push loop will also find the deleted workspace in `remoteIds` and skip it.

### 2. Clamp `activeWorkspaceIndex` after merge (in both `onLogin` and `deltaRefresh`)

When workspaces are removed by a merge, `activeWorkspaceIndex` can become out-of-bounds. Update both merge+setState sites to clamp and guard against an empty result:

```typescript
// After computing `merged`:
const safeMerged = merged.length > 0 ? merged : [makeDefaultWorkspace("Workspace 1")];
const currIdx = useWorkspace.getState().activeWorkspaceIndex;
const safeIdx = Math.min(currIdx, safeMerged.length - 1);
useWorkspace.setState({ workspaces: safeMerged, activeWorkspaceIndex: safeIdx });
```

Apply this pattern in:
- `onLogin` (replace the existing `useWorkspace.setState({ workspaces: merged })`)
- `deltaRefresh` (replace the existing `useWorkspace.setState({ workspaces: merged })`)

Note: `makeDefaultWorkspace` is defined in `store.ts` (exported) so `sync.ts` can import it, or the guard can be inlined with a direct import. Check whether `makeDefaultWorkspace` is exported; if not, export it or inline a single-workspace fallback.

### 3. Handle ignored push-loop return values (nice-to-have, low-risk)

The push loop in `onLogin` currently ignores `pushWorkspace` return values. After the fix in step 1 this loop will no longer push deleted workspaces, but it still ignores success/conflict responses for new workspaces. Update the loop to adopt the server row on a successful push (mirrors `autoSave`), so local workspaces get their server-assigned version immediately after login. This prevents version mismatches on the first autosave.

## Tests to Add in `web/src/sync.test.ts`

Add a new `describe("initSync onLogin")` block:

1. **Deleted workspace is removed on login:** Set up local store with workspace A (previously synced, version 2). Mock `fetch` to return `pullWorkspaces(0)` result with workspace A having `deleted_at` set. After auth status → "authed", verify workspace A is absent from the store.

2. **Local-only workspace is pushed on login:** Set up local store with workspace B that has never been on the server. Mock `fetch` to return an empty list from `pullWorkspaces(0)` and accept the PUT. After login, verify a PUT was made for workspace B.

3. **`activeWorkspaceIndex` is clamped after deletion:** Set up 2 workspaces, `activeWorkspaceIndex = 1`. Mock delta response deleting the second workspace. After delta refresh, verify `activeWorkspaceIndex = 0` and no index out-of-bounds.

## Files Modified

- `web/src/sync.ts` — `onLogin` (1-line fix + setState update), `deltaRefresh` (setState update)
- `web/src/sync.test.ts` — new describe block with 3 tests

## No Server Changes Required

The `?since=0` endpoint already works correctly on the server (returns all rows including soft-deleted ones). No migration or server-side changes needed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation

Fixed `web/src/sync.ts` with three targeted changes and exported a helper from `store.ts`.

**1. `onLogin`: change `pullWorkspaces()` to `pullWorkspaces(0)`**
The full-snapshot endpoint (`/api/workspaces` without `?since=`) filters `deleted_at IS NULL`, so soft-deleted workspaces are invisible and get re-created locally as zombie entries. Passing `since=0` hits the delta endpoint which returns all rows including soft-deleted ones. `mergeWorkspaces` already removes entries with `deleted_at !== null`.

**2. Clamp `activeWorkspaceIndex` after merge (both `onLogin` and `deltaRefresh`)**
When a merge removes workspaces, the active index can become out-of-bounds. Both sites now compute `safeMerged` (with a default-workspace fallback if the merged result is empty) and `safeIdx = Math.min(currIdx, safeMerged.length - 1)` before the `setState` call.

**3. Adopt server row after push in `onLogin`**
The push loop now captures the `pushWorkspace` return value and updates the local entry with the server-assigned version, mirroring `autoSave`, so subsequent saves don't cause version mismatches.

**4. Export `makeDefaultWorkspace` from `store.ts`**
Required by the empty-result guard in `sync.ts`.

**5. Tests in `web/src/sync.test.ts`**
New `describe("initSync onLogin")` block with 3 tests covering AC#1 (deleted workspace removed on login), AC#2 (local-only workspace pushed on login), and AC#3 (activeWorkspaceIndex clamped when deltaRefresh removes a workspace). Also added `initEncryption: () => Promise.resolve()` to the encryption vi.mock — it was previously unmocked, causing the real `crypto.subtle.importKey` to stall under fake timers.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Changed `onLogin` in `web/src/sync.ts` to use `pullWorkspaces(0)` instead of `pullWorkspaces()`, so the login sync hits the delta endpoint (which returns soft-deleted rows) rather than the full-snapshot endpoint (which filters them out). Added `activeWorkspaceIndex` clamping in both `onLogin` and `deltaRefresh` to prevent out-of-bounds access when deletions shrink the workspace list, with a fallback to a new default workspace if the merged result is empty. Updated the `onLogin` push loop to adopt the server row on success (mirrors autoSave). Exported `makeDefaultWorkspace` from `store.ts`. Added 3 regression tests covering all three scenarios and added `initEncryption` to the encryption vi.mock. All 376 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
