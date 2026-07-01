---
id: TASK-98
title: Scope the 409 conflict row read by user_id to prevent cross-user leak
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:27'
updated_date: '2026-07-01 23:28'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-ACC-1.00, SEC-DAT-1.00. functions/_lib/db.ts:136-139 upsertWorkspace re-reads the conflicting row with SELECT * WHERE id = ? (unscoped) and functions/api/workspaces/[id].ts:69 returns it in the 409 body as {conflict, current}. Reachable only via a deliberate UUID-collision race (the handler pre-check at [id].ts:51-58 catches existing cross-user rows), but if hit it leaks another user's full payload and user_id. Fix: scope the post-upsert re-read by user_id (WHERE id = ? AND user_id = ?); if no row, treat as not-accepted/404; never return a row whose user_id \!= caller.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a PUT that conflicts on another user's row never returns that row's payload or user_id
- [x] #2 a normal same-user stale-version 409 still returns the caller's current row
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

`upsertWorkspace` (functions/_lib/db.ts:126-150) writes with an owner-safe
`ON CONFLICT ... WHERE excluded.version >= workspaces.version AND
workspaces.user_id = excluded.user_id` guard, but then re-reads the row with
an **unscoped** `SELECT * FROM workspaces WHERE id = ?`. If the id already
belongs to another user (only reachable via a UUID-collision race, since
`[id].ts:51-58` pre-checks and 404s the normal case), the guarded UPDATE is a
no-op but the unscoped re-read still returns that other user's full row,
which `[id].ts:69` echoes back to the caller in the 409 body
(`{conflict: true, current: row}`) — leaking payload + user_id cross-user.

`softDeleteWorkspace` (db.ts:213-228) already scopes its statement by
`user_id` — this fix brings `upsertWorkspace` in line with that existing
pattern.

## Fix

1. **functions/_lib/db.ts — `upsertWorkspace`**
   - Change the post-upsert re-read to scope by both id and the caller's
     `user_id`:
     `SELECT * FROM workspaces WHERE id = ? AND user_id = ?` bound to
     `(row.id, row.user_id)`.
   - Change the return type to
     `Promise<{ accepted: boolean; row: WorkspaceRow | null }>`.
   - When the scoped read returns no row, it means either (a) the id
     collided with another user's row (the ON CONFLICT guard rejected the
     write) or (b) some other unexpected state — both cases must be
     treated identically as "not accepted, no row to leak": return
     `{ accepted: false, row: null }`. Do NOT throw in this branch (remove
     the old `if (!current) throw ...`) — the caller decides how to
     respond (404), and no cross-user data ever crosses the function
     boundary.
   - When the scoped read does return a row (the normal, same-user case,
     including ordinary stale-version conflicts), keep existing behavior:
     `accepted = current.version <= row.version` (the `user_id` equality
     check in the old code becomes redundant since the query is now scoped,
     but leaving it is harmless — prefer removing it since it can never be
     false).
   - Update the JSDoc comment above the function to describe the new
     null-row-on-cross-user-collision behavior.

2. **functions/api/workspaces/[id].ts — `onRequestPut`**
   - After `const { accepted, row } = await upsertWorkspace(...)`, handle
     the three cases explicitly:
     - `accepted === true` → existing success path (`{ workspace: row }`,
       row is guaranteed non-null here).
     - `accepted === false && row === null` → return
       `Response.json({ error: "Not found" }, { status: 404 })` (mirrors
       the existing pre-check 404 a few lines above, for consistency).
     - `accepted === false && row !== null` → existing conflict path
       (`{ conflict: true, current: row }`, 409).

3. **Tests**
   - `functions/__tests__/db.test.ts`: add a case under the
     `upsertWorkspace and listWorkspaces` describe block that:
     - Creates two users (A and B).
     - Inserts a workspace row owned by user A via `upsertWorkspace`.
     - Calls `upsertWorkspace` again with the **same id** but
       `user_id: userB.id` (this directly exercises the ON CONFLICT
       owner guard without needing to bypass the HTTP-layer pre-check).
     - Asserts `accepted === false` and `row === null` — proving no
       cross-user payload/user_id is ever returned.
     - Keep/adjust the existing "last-write-wins: lower version does not
       overwrite" test to confirm the same-user stale case still returns
       `accepted === false` with the caller's own current row (non-null).
   - `functions/__tests__/workspaces.test.ts`: the existing test at line
     ~334 ("returns 409 with the current server row when version is
     stale") must keep passing unchanged — it's the same-user path and
     confirms acceptance criteria #2. No new HTTP-level test for the
     cross-user race is required since it can't be triggered through the
     handler without bypassing its own pre-check by design; the db.ts
     unit test above is the correct level to prove the guard.

## Verification

- `pnpm test` (or the project's configured test runner for `functions/`)
  covering `functions/__tests__/db.test.ts` and
  `functions/__tests__/workspaces.test.ts`.
- Manually re-read the diff to confirm no code path can construct a 409
  (or 200) response body containing a row whose `user_id` differs from the
  authenticated caller.

## Acceptance criteria mapping

- #1 (cross-user conflict never leaks payload/user_id): satisfied by the
  scoped re-read + `row: null` + 404 branch in `[id].ts`.
- #2 (same-user stale-version 409 still returns caller's current row):
  satisfied because the scoped query still matches when `user_id` equals
  the caller's own id — unchanged from today for the normal case.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scoped the post-upsert re-read in upsertWorkspace (functions/_lib/db.ts) to WHERE id = ? AND user_id = ?, changing the return type to { accepted: boolean; row: WorkspaceRow | null }. When the scoped read finds nothing (cross-user id collision rejected by the ON CONFLICT owner guard), it now returns { accepted: false, row: null } instead of throwing or leaking another user's row. functions/api/workspaces/[id].ts onRequestPut now branches on row === null to return 404, otherwise keeps the existing 409 conflict/200 success paths. Added a unit test in functions/__tests__/db.test.ts proving a same-id write from a different user returns accepted=false, row=null, and strengthened the existing stale-version test to assert the same-user 409 path still returns the caller's own row. pnpm test:functions (58 tests) and tsc --project functions/__tests__/tsconfig.json pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Scoped the post-upsert re-read in upsertWorkspace to id+user_id so a cross-user id collision can never leak another user's row/user_id through the 409 body; onRequestPut now returns 404 when the scoped read finds nothing, and existing same-user conflict/success behavior is unchanged. Verified with new/updated unit tests, full functions test suite, and typecheck.
<!-- SECTION:FINAL_SUMMARY:END -->
