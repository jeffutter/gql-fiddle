---
id: TASK-94.1
title: Bump workspace version synchronously on save to prevent lost updates
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 16:11'
labels:
  - review
  - planned
dependencies: []
parent_task_id: TASK-94
priority: high
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/sync.ts (~257, ~329): autoSave computes bumped = {...ws, version:(ws.version ?? 0)+1} but the local store version only advances when the server echo (rowToEntry) returns. Two edits faster than the round-trip both read the old version and send version N+1; the server accepts both (>=) and the second silently clobbers the first with no 409. Fix: bump version in the Zustand store synchronously when a save is scheduled/sent (single source of truth for the monotonic counter); treat the server echo as confirmation only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a burst of N rapid edits produces N distinct monotonic version increments
- [x] #2 no save silently overwrites a newer local edit (no lost update)
- [x] #3 a regression test simulates edits faster than the mocked round-trip
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

web/src/sync.ts autoSave() computes `bumped = {...ws, version: (ws.version ?? 0) + 1}`
as a local-only object and sends it to the server, but never writes the bumped
version back into the Zustand store until the server echo (`rowToEntry`)
arrives. The store's `version` field is only ever advanced by that echo. Two
edits to the same workspace fired faster than one round-trip (the debounce
timer fires, then a further edit resets/fires a second timer before the first
request resolves — this can happen because the in-flight request is not
tracked or serialized) both read the *same* stale store version N and both
compute N+1. The server's upsert (`functions/_lib/db.ts` WHERE
`excluded.version >= workspaces.version`) accepts version >= stored, so an
equal version is accepted, not rejected with 409 — the second push silently
clobbers the first with no conflict signal.

A second, related bug: today, when the server echo comes back and the code
does `workspaces.map(w => w.id === ws.id ? rowToEntry(serverRow, w) : w)`,
it blindly overwrites the *entire* local entry (content included) with
whatever the server returned — even if a newer edit already advanced the
local version past what this particular request's response reflects (e.g. a
stale 409 for an in-flight older request resolving after a newer request's
response already updated the store). That must be guarded too, or fixing the
version-bump race just moves the lost-update bug into the echo-application
step. AC #2 ("no save silently overwrites a newer local edit") covers this
case explicitly.

## Fix

Make the Zustand store (`useWorkspace`) the single source of truth for the
monotonic version counter. Refactor `autoSave` in `web/src/sync.ts` (~250-279)
to:

1. Change its signature from `autoSave(ws: WorkspaceEntry)` to
   `autoSave(id: string)`. All version/content reads happen inside the
   function against the live store, not a snapshot passed in by the caller.
   (This also gives TASK-94.3 — which depends on this ticket — a natural seam
   to re-read current store state instead of a stale offline-queue snapshot.)

2. On entry, look up the current entry by id in `useWorkspace.getState()`.
   If it's gone (deleted concurrently), no-op.

3. If offline: put the *current* store entry into `offlineQueue` (not a
   possibly-stale param) and return, as today.

4. If online: synchronously bump the version **in the store** before
   sending, guarded by `isSyncing = true/false` (matching the existing
   pattern around the other two `useWorkspace.setState` calls in this file
   so the store-subscribe handler's `if (isSyncing) return;` ignores this
   write and it doesn't re-trigger its own debounce). Use the post-bump
   entry (which includes the latest content, since it's read at fire time)
   as the payload sent to `pushWorkspace`.

   This is the crux of the fix: because every call to `autoSave` reads
   whatever version is *currently* in the store and bumps it right before
   sending, two overlapping in-flight saves for the same workspace can never
   compute the same "next" version — each bump is atomic against the last
   committed store state, so N rapid edits/fires produce N distinct
   monotonically increasing versions (AC #1), regardless of network
   ordering.

5. After `pushWorkspace` resolves (whether 200 or 409-with-current-row),
   apply the server row back to the store only if it is not stale:
   `if (serverRow.version >= (current local w.version ?? 0)) apply
   rowToEntry(serverRow, w); else leave local as-is`. This prevents a
   late-arriving response for an older in-flight request from rolling back
   a newer edit/version that a later request (or a later local edit) has
   already advanced the store past. Wrap in the existing `isSyncing`
   true/false pattern.

6. Preserve existing error handling: on a thrown error (network failure),
   re-read the current store entry by id and push it into `offlineQueue`
   (not the stale param), then set sync status per `navigator.onLine`.

## Call-site updates

- The debounce `setTimeout` callback (~325-332) currently does:
  ```
  const current = useWorkspace.getState().workspaces.find(w => w.id === id);
  if (current) void autoSave(current);
  ```
  Simplify to `void autoSave(id);` since autoSave now does its own lookup.

- `flushOfflineQueue` (~281-288) currently calls `autoSave(ws)` for each
  queued snapshot. Change the call to `autoSave(ws.id!)` to match the new
  signature. Note: this ticket does NOT attempt the deeper "re-derive queued
  edits from current store state vs. captured snapshot" semantics for the
  offline queue itself — that is explicitly TASK-94.3's scope (it depends on
  this ticket landing first). Just keep the call compiling against the new
  signature; TASK-94.3 will revisit `flushOfflineQueue`'s internals.

- `onLogin`'s one-time "push local-only workspaces after login merge" path
  (~217-230) calls `pushWorkspace` directly, not `autoSave`, and bumps with
  `ws.version ?? 1` (not `+1`) as a one-time initial publish before the
  autosave subscription is live for that workspace. This path is not part of
  the rapid-edit race described in this ticket and is left unchanged.

## Regression test (web/src/sync.test.ts)

Add a test in the `initSync auto-save debounce` (or a new) describe block
that simulates two edits firing faster than the mocked round-trip:

1. `initSync()`, authed, workspace at version 1.
2. Mock `fetch` PUT so the first call's Promise doesn't resolve immediately
   (e.g. resolve it manually via a held resolver, or use two sequential
   `mockImplementationOnce` calls where the first is delayed past the
   second's dispatch using `vi.advanceTimersByTimeAsync` staged in two
   steps) — the key behavior to assert is that the *bodies* sent to the two
   PUT calls carry distinct, increasing `version` values (e.g. 2 then 3),
   not the same value.
3. Trigger a store change, advance timers past the 2 s debounce so the
   first autoSave fires and its PUT is sent (but not yet resolved).
4. Trigger a second store change while the first request is still pending,
   advance timers past another 2 s debounce so the second autoSave fires
   and sends its own PUT.
5. Resolve both mocked responses (in either order) and assert:
   - Both PUT request bodies had strictly increasing `version` fields
     (AC #1).
   - The store's final `version` and content reflect the later edit, not
     clobbered back to the earlier one regardless of response resolution
     order (AC #2).
6. Keep the existing "three rapid store updates produce at most one fetch
   PUT after 300 ms" debounce test passing unchanged — that test covers
   coalescing edits *within* one debounce window, which this change does not
   affect (only one timer is ever live per id; the new race is between a
   fired-and-in-flight request and a subsequent debounce firing).

## Verification

- `nix develop -c bash -c "cd web && pnpm test -- sync.test.ts"` — all
  existing sync tests plus the new regression test pass.
- `nix develop -c bash -c "cd web && pnpm test"` — full suite green (confirm
  no regression in store.test.ts or sync-encryption.integration.test.ts,
  which also exercise `useWorkspace`/`autoSave` indirectly).
- `nix develop -c bash -c "cd web && pnpm typecheck"` (or equivalent project
  command — check AGENTS.md/package.json scripts) since the `autoSave`
  signature change touches all call sites.
- Manually re-read the full diff of `web/src/sync.ts` to confirm no
  duplicate version-bump logic remains and the `isSyncing` guard is applied
  consistently around every new `useWorkspace.setState` call this change
  introduces.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in web/src/sync.ts:

- Changed autoSave's signature from autoSave(ws: WorkspaceEntry) to
  autoSave(id: string). It now looks up the live entry from
  useWorkspace.getState() itself (no-op if the workspace was deleted
  concurrently), instead of trusting a version/content snapshot handed to it
  by a caller.
- The version bump is now applied synchronously to the Zustand store (guarded
  by the existing isSyncing pattern so it doesn't re-trigger the store
  subscription's own debounce) before the PUT is sent, and the post-bump
  entry is used as the request payload. The store is the single source of
  truth for the monotonic counter, so two overlapping autoSave calls for the
  same workspace id can never compute the same "next" version.
- When the server response (200 or 409) comes back, it's only applied to the
  store if serverRow.version >= the store's current version for that id --
  this stops a late-arriving response for an older in-flight request from
  rolling back a newer edit that a subsequent save has already advanced the
  store past.
- Updated call sites: the debounce timer callback now calls autoSave(id)
  directly (no more separate store lookup before the call), and
  flushOfflineQueue calls autoSave(ws.id!). onLogin's one-time
  local-only-workspace push (which calls pushWorkspace directly, not
  autoSave, with version ?? 1) is unchanged per the plan -- it's a one-time
  initial publish before the autosave subscription is live, not part of the
  rapid-edit race.

Added a regression test in web/src/sync.test.ts ("two edits faster than the
mocked round-trip get distinct increasing versions and never lose the newer
edit") that holds the first PUT's response unresolved, fires a second edit
while it's in flight, asserts the two PUT bodies carry versions 2 and 3 (not
2 and 2), then resolves the responses out of order and asserts the store
ends up at version 3 / "Edit 2" regardless of resolution order.

Verification:
- pnpm test (full suite): 18 files / 383 tests passed.
- npx tsc -b --noEmit: no errors.
- npx eslint src/sync.ts src/sync.test.ts: clean.
- npx prettier --check: clean (ran --write once to fix new test formatting).
- Manually re-read the sync.ts diff to confirm a single version-bump path and
  consistent isSyncing guarding around every useWorkspace.setState call.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the Zustand workspace store the single source of truth for each
workspace's monotonic version counter: autoSave(id) now bumps the version
in the store synchronously before sending the PUT (instead of computing a
local-only "N+1" from a possibly-stale snapshot), so overlapping saves for
the same workspace can never send the same version twice, and a stale
server echo can no longer roll back a newer edit. Added a regression test
covering two edits that fire faster than a mocked round-trip.
<!-- SECTION:FINAL_SUMMARY:END -->
