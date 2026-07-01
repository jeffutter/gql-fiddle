---
id: TASK-94.3
title: Flush offline queue from current store state and queue failed deletes
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 16:35'
labels:
  - planned
dependencies:
  - TASK-94.1
parent_task_id: TASK-94
priority: medium
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/sync.ts (~281-288) flushOfflineQueue re-runs autoSave on stale snapshots captured at edit time, re-bumping version and overwriting newer local content on reconnect (LWW >=). Separately deleteWorkspace (~151-156) ignores the response and never queues failed/offline deletes, so deletions can fail to propagate and reappear cross-device. Fix: on flush, re-read the current store entry by id (as the debounce path already does ~329) rather than pushing the captured snapshot; add a tombstone queue for failed/offline deletes, flushed alongside edits on reconnect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 editing a workspace offline then reconnecting pushes the latest content, not the stale snapshot
- [x] #2 a delete issued offline propagates to the server on reconnect
- [x] #3 a failed delete is retried rather than silently dropped
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Current-state correction (important)

TASK-94.1 already landed and changed `autoSave`'s signature from
`autoSave(ws: WorkspaceEntry)` to `autoSave(id: string)`, which re-reads the
*current* store entry by id on every call (web/src/sync.ts ~279-281). It also
updated `flushOfflineQueue` (~332-339) to call `autoSave(ws.id!)` instead of
`autoSave(ws)`. As a result, **AC #1 (flush pushes the latest content, not a
stale snapshot) is already fixed** by TASK-94.1 — flushing now always reads
live store state via the id lookup inside `autoSave`, never the captured
`WorkspaceEntry` snapshot sitting in the `offlineQueue` map. No code change is
needed for AC #1; only a regression test to lock the behavior in (see below),
since none currently exercises the offline-then-reconnect path at all.

The real remaining scope of this ticket is **AC #2 and #3**: deletes issued
offline or that fail on the network are silently dropped today.

## Root cause (deletes)

In `initSync`'s `unsubStore` handler (web/src/sync.ts ~356-363):
```ts
for (const ws of prev) {
  if (ws.id && !currIds.has(ws.id)) {
    void deleteWorkspace(ws.id);
    offlineQueue.delete(ws.id);
  }
}
```
`deleteWorkspace` (~156-161) fires a `DELETE` request and ignores everything
about the result — no check of `res.ok`/status, no catch for a thrown/network
error, and the call is fire-and-forget (`void`). Consequences:
- Offline: `fetch` fails immediately or hangs, and the rejection is
  unhandled — the delete is simply lost; the workspace stays alive on the
  server and reappears on other devices / after next full pull.
- Online but failing (5xx, transient network blip): same — no retry, no
  record that this id still needs to be deleted server-side.

There is no tombstone/delete queue analogous to the edit `offlineQueue`
(Map<string, WorkspaceEntry> at ~217), so there is nothing to flush on
reconnect for deletes.

## Fix

### 1. Make `deleteWorkspace` report failure instead of swallowing it

`functions/api/workspaces/[id].ts`'s `onRequestDelete` returns `204` on
success and `404` if the row doesn't exist / isn't owned by the caller
(web/src/sync.ts's module-level `deleteWorkspace`, ~156). Update it to:
```ts
/**
 * Soft-delete one workspace on the server.
 * Resolves normally on 204 (deleted) and on 404 (already gone — e.g. a
 * retried delete after an earlier attempt succeeded but the client didn't
 * see the response, or the row was already reaped). Throws on any other
 * status or network failure so the caller can queue it for retry — mirrors
 * pushWorkspace's error contract just above.
 */
async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetch(`/api/workspaces/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.ok || res.status === 404) return;
  throw new Error(`Delete failed: ${res.status}`);
}
```
(A thrown `fetch` itself, e.g. offline/network error, propagates the same
way — no extra handling needed here.)

### 2. Add a tombstone queue and a `requestDelete` wrapper inside `initSync`

Alongside the existing `debounceTimers` / `offlineQueue` locals (~216-217),
add:
```ts
const offlineDeleteQueue = new Set<string>(); // ids pending soft-delete
```

Add a nested async function (same pattern/placement as `autoSave`, just
above or below it):
```ts
async function requestDelete(id: string) {
  if (!navigator.onLine) {
    offlineDeleteQueue.add(id);
    useAuth.getState().setSyncStatus("offline");
    return;
  }
  try {
    await deleteWorkspace(id);
    useAuth.getState().setSyncStatus("synced");
  } catch (err) {
    console.error("Sync: delete failed", err);
    offlineDeleteQueue.add(id);
    useAuth.getState().setSyncStatus(navigator.onLine ? "error" : "offline");
  }
}
```
This mirrors `autoSave`'s existing offline/error handling for edits (same
`navigator.onLine` check, same `setSyncStatus` calls, same catch-all —
consistent with the project's existing "aggregate exception handling in one
place" style already used for saves).

### 3. Use `requestDelete` at the deletion-detection call site

Replace the fire-and-forget call in `unsubStore` (~356-363):
```ts
for (const ws of prev) {
  if (ws.id && !currIds.has(ws.id)) {
    void requestDelete(ws.id);
    offlineQueue.delete(ws.id);
  }
}
```
(Keep the existing `offlineQueue.delete(ws.id)` — a delete always
supersedes any pending queued edit for the same id; this line already does
that today.)

### 4. Flush tombstones alongside edits in `flushOfflineQueue`

`flushOfflineQueue` (~332-339) currently only drains `offlineQueue`. Extend
it to also drain `offlineDeleteQueue`, deletes first (a queued delete should
win over ever re-pushing a since-deleted workspace, though in practice the
two queues are already disjoint per id thanks to step 3's
`offlineQueue.delete`):
```ts
async function flushOfflineQueue() {
  if (useAuth.getState().status !== "authed") return;
  const deleteIds = Array.from(offlineDeleteQueue);
  offlineDeleteQueue.clear();
  for (const id of deleteIds) {
    await requestDelete(id);
  }
  const entries = Array.from(offlineQueue.values());
  offlineQueue.clear();
  for (const ws of entries) {
    await autoSave(ws.id!);
  }
}
```
`requestDelete` re-adds to `offlineDeleteQueue` on renewed failure, so a
retry that fails again is simply picked up by the next `online` event or
next login's flush — no change needed to the two existing call sites of
`flushOfflineQueue` (`onLogin` ~259, `onOnline` ~412).

### 5. Update AGENTS.md

In the "Sync model" section (~531-535), update:
- "**Delete:** removing a workspace while logged in calls
  `DELETE /api/workspaces/:id` (soft-delete on the server)." → note that a
  failed or offline delete is queued (tombstoned) in memory and retried on
  the `online` event or next login, same as edits.
- "**Offline fallback:** edits made while offline..." → broaden to "edits
  and deletes made while offline...".

## Regression tests (web/src/sync.test.ts)

Add a new `describe("initSync offline queue")` block (fake timers, same
`resetStores`/`cleanup` pattern as the existing `"initSync auto-save
debounce"` block at ~310). Mock `navigator.onLine` per-test with
`vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false)` (and
`true` to simulate reconnect), restored via `vi.restoreAllMocks()` in
`afterEach` (already present).

1. **AC #1 regression — flush pushes latest content, not the queued
   snapshot:**
   - authed, online; set a workspace in the store.
   - Go offline (`onLine` → false); trigger a store change so the debounced
     `autoSave` fires while offline and captures the entry in
     `offlineQueue`.
   - While still offline, apply a *second* local store change (further
     edit) — this does not go through `autoSave` again since the queue only
     records what's live at flush time; the point is the store now holds
     newer content than whatever the first offline `autoSave` observed.
   - Mock `fetch` to capture PUT bodies, go back online (`onLine` → true),
     call `flushOfflineQueue()` directly (exported for tests, or trigger via
     dispatching a real `online` event on `window` since `initSync` already
     listens for it).
   - Assert the PUT body reflects the *second* (latest) edit's content, not
     the first.

2. **AC #2 — an offline delete propagates on reconnect:**
   - authed, online; workspace `ws-del` present in the store.
   - Go offline; remove `ws-del` from `useWorkspace`'s `workspaces` array
     (simulating the user deleting it) — assert no DELETE fetch was
     attempted while offline.
   - Mock `fetch` for `DELETE` to resolve `204`.
   - Go back online, dispatch `window.dispatchEvent(new Event("online"))`
     (matches the existing `onOnline` listener), `await` a timer flush.
   - Assert a `DELETE /api/workspaces/ws-del` call was made.

3. **AC #3 — a failed delete is retried, not dropped:**
   - authed, online throughout; workspace `ws-fail` present.
   - Mock `fetch` for the first `DELETE` call to reject (network error) or
     resolve `500`; remove `ws-fail` from the store (triggers
     `requestDelete`, which should catch and queue it).
   - Assert exactly one failed DELETE attempt was made and `offlineQueue`'s
     sibling delete queue now holds the id — trigger a second flush (e.g.
     next `online` event, or call `flushOfflineQueue()` again) with `fetch`
     now mocked to succeed, and assert the DELETE is retried and eventually
     succeeds.

Keep all three existing `"initSync auto-save debounce"` tests passing
unchanged — this ticket doesn't touch the edit-path version-bump logic
(that's TASK-94.1, already Done).

## Verification

- `nix develop -c bash -c "cd web && pnpm test -- sync.test.ts"` — new and
  existing sync tests pass.
- `nix develop -c bash -c "cd web && pnpm test"` — full suite green.
- `nix develop -c bash -c "cd web && pnpm typecheck"` (or the project's
  equivalent script per AGENTS.md/package.json).
- `nix develop -c bash -c "cd web && npx eslint src/sync.ts src/sync.test.ts"`
  and `npx prettier --check` on the same files.
- Manually re-read the `web/src/sync.ts` diff to confirm: `offlineQueue` and
  `offlineDeleteQueue` stay disjoint per id, `flushOfflineQueue` drains both
  on every call site (`onLogin`, `onOnline`), and no new unhandled promise
  rejection is introduced at the `void requestDelete(ws.id)` call site (the
  function's own try/catch must swallow all failure paths, same as
  `autoSave`'s).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented the AC #2/#3 tombstone-queue fix (AC #1 was already fixed by
TASK-94.1's autoSave(id) re-read; added a regression test to lock it in).

web/src/sync.ts:
- deleteWorkspace(id) now checks the response: resolves on 204/404, throws
  on any other status or network failure, mirroring pushWorkspace's error
  contract (previously it silently swallowed everything, including offline
  fetch rejections).
- Added `offlineDeleteQueue: Set<string>` alongside the existing edit
  `offlineQueue`, and a `requestDelete(id)` helper that mirrors autoSave's
  offline/error handling: queues the id when offline or when
  deleteWorkspace throws, otherwise clears syncStatus to "synced".
- The unsubStore deletion-detection call site now calls
  `void requestDelete(ws.id)` instead of the old fire-and-forget
  `void deleteWorkspace(ws.id)`.
- flushOfflineQueue drains offlineDeleteQueue (deletes first) before
  draining the edit offlineQueue, so both are retried on "online"/login.
- Updated the module header comment and AGENTS.md's Sync model section to
  describe delete tombstoning.

web/src/sync.test.ts: added `describe("initSync offline queue")` with three
tests — flush-from-live-state regression (AC #1), offline delete propagates
on reconnect (AC #2), and a failed delete is retried on the next flush
(AC #3). Mocks `navigator.onLine` per-test via
`vi.spyOn(window.navigator, "onLine", "get")`.

Verification: `pnpm vitest run sync.test.ts` (23/23 pass), `pnpm test` full
suite (388/388 pass), `npx tsc -b` clean, `npx eslint src/sync.ts
src/sync.test.ts` clean, `npx prettier --check` clean on both files
(AGENTS.md has a pre-existing, unrelated prettier warning that predates this
change).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an offlineDeleteQueue and requestDelete() helper mirroring autoSave's offline/error handling, so a delete issued offline or that fails on the network is tombstoned and retried on reconnect/login instead of silently dropped; deleteWorkspace now surfaces non-2xx/404 failures instead of swallowing them. AC #1 was already fixed by TASK-94.1's autoSave(id) re-read, confirmed with a new regression test.
<!-- SECTION:FINAL_SUMMARY:END -->
