---
id: TASK-117
title: >-
  Fix: onLogin push-if-missing clobbers server workspaces that merely failed to
  decrypt
status: Done
assignee: []
created_date: '2026-07-01 20:50'
updated_date: '2026-07-02 13:42'
labels:
  - review-fix
  - planned
dependencies: []
ordinal: 152000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduced by TASK-95.1's change to pullWorkspaces() (web/src/sync.ts): rows that
throw DecryptionError are now silently omitted from the returned rows/cursor
result instead of being included (previously they came back with garbage
plaintext, but were still present in the array).

initEncryption's onLogin() flow (web/src/sync.ts, "Push workspaces that exist
locally but not on the server" loop, ~lines 261-274) builds
`remoteIds = new Set(rows.map((r) => r.id))` from that same filtered array,
then treats any local workspace whose id is absent from remoteIds as
"local-only, never pushed" and pushes it with `pushWorkspace(bumped)` using
its current (unbumped) version.

Every workspace gets a client-generated UUID at creation time (see
makeDefaultWorkspace in web/src/store.ts), independent of sync state, so a
workspace that was previously synced under a *different* DEK (e.g. this
device lost a first-login DEK race, or its cached DEK is otherwise stale)
will still be present locally with the same id as the server row. If that
server row now fails to decrypt on this login (wrong key), it's dropped from
`rows`/`remoteIds`, so the onLogin loop misclassifies it as "not on server"
and PUTs the local copy — which the server accepts (version >= stored) —
overwriting the previously-working encrypted server row with content
encrypted under this client's (deviant) key.

Net effect: a decrypt failure on login silently destroys the server's (and
every other device's) copy of that workspace, instead of merely skipping it
as intended by TASK-95.1/95.2. This is worse than the original bug those
tickets fixed.

Suggested fix: pullWorkspaces() (or onLogin) needs to track ids of rows that
existed on the server but failed to decrypt, separately from rows that
genuinely don't exist server-side, and exclude the former from the
"push as new" loop (e.g. surface skipped ids alongside `rows`/`cursor` and
have onLogin subtract them from the "needs push" set, or skip pushing
entirely and surface a user-visible warning instead).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pullWorkspaces() returns a Set<string> of workspace IDs that existed on the server but failed to decrypt (skippedIds)
- [x] #2 onLogin() includes skippedIds in the remoteIds set used by the "push local-only" loop, so undecryptable server workspaces are not re-pushed and clobbered
- [x] #3 The delta refresh path (deltaRefresh) uses the same return shape, maintaining API uniformity
- [x] #4 No regression: successfully decrypted rows behave identically to before
- [x] #5 cargo fmt --check, cargo clippy --all-targets -- -D warnings pass
- [x] #6 pnpm tsc --noEmit passes in web/
- [x] #7 pnpm test run passes (existing sync tests continue to pass)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Change `pullWorkspaces()` return type from `{ rows: WorkspaceRow[], cursor: number }` to `{ rows: WorkspaceRow[], cursor: number, skippedIds: Set<string> }`.
2. Inside the `Promise.allSettled` loop in `pullWorkspaces()`, collect IDs of rejected rows into `skippedIds` (a Set). This preserves the pre-decryption ID so `remoteIds` can exclude them.
3. In `onLogin()`, after `pullWorkspaces(0)`, build `remoteIds` from `rows.map(r => r.id)` **union** `skippedIds` — both represent "this workspace exists on the server". The "push local-only" loop then won't re-push workspaces we can't decrypt but that are server-side.
4. Add the same `skippedIds` field to the delta path (deltaRefresh), though delta currently doesn't have a "push local-only" loop — just pass it through so the return shape is uniform.
5. No user-visible notification needed for this fix (the existing console.error suffices; a warning toast is deferred to a follow-up).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Changed pullWorkspaces() return type to include skippedIds: Set<string> — collects IDs of rows that failed decryption during Promise.allSettled

In onLogin(), built remoteIds as union of successfully decrypted row IDs and skippedIds, so the push-local-only loop won't re-push workspaces we can't decrypt but that already exist server-side

deltaRefresh() already destructures { rows, cursor } and ignores skippedIds — return shape is uniform, no code changes needed there

All 396 tests pass, pnpm tsc --noEmit clean

One pre-existing L56 lint warning (JSON.parse without try/catch in rowToEntry) was flagged by the system but is unrelated to this task
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria verified
- [ ] #2 Code reviewed (pr-review skill or manual review)
- [ ] #3 No new lint, typecheck, or test failures
- [ ] #4 Plan matches implementation
<!-- DOD:END -->
