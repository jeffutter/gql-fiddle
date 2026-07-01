---
id: TASK-94.2
title: Use a server-provided cursor for delta sync instead of client wall-clock
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 16:26'
labels:
  - review
  - planned
dependencies: []
parent_task_id: TASK-94
priority: high
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/sync.ts (~173, ~213) sets 'since' from the client's Date.now(), but the server (functions/_lib/db.ts ~120, ~188) filters updated_at > since using its own clock. A client clock ahead of the server means newer server rows are never delivered until a full re-login (missed cross-device edits and deletes). Also lastPullTs stamped at request start can miss writes committed during the in-flight pull. Fix: return a server high-water-mark cursor in each pull response and feed that back as 'since'; prefer >= with dedup over > to close the in-flight gap. Server + client change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a cross-device edit propagates with the client clock skewed +10 minutes
- [x] #2 no delta is missed when a write commits during an in-flight pull
- [x] #3 the server cursor contract is documented in AGENTS.md
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

`web/src/sync.ts` treats `since`/`lastPullTs` as a client wall-clock value:
`deltaRefresh` sets `lastPullTs = Date.now()` (client clock) before the pull
even resolves, and `onLogin` sets `lastPullTs = Date.now()` after the initial
pull. The server (`functions/_lib/db.ts` `listWorkspaces`) filters
`updated_at > since` using its OWN clock. Any client/server clock skew (client
ahead) causes `since` to jump past rows the server hasn't written yet —
those rows are silently never delivered until a full re-login (since=0).
Additionally, stamping the cursor from `Date.now()` rather than a value tied
to the actual query execution instant leaves a race window where a write
committing around the same moment as a pull could be skipped by the strict
`>` comparison.

## Fix — server-owned high-water-mark cursor, `>=` comparison, idempotent re-delivery

**Server (`functions/api/workspaces/index.ts` + `functions/_lib/db.ts`):**
1. In `onRequestGet` (functions/api/workspaces/index.ts), capture
   `const cursor = Date.now();` on the server, immediately before calling
   `listWorkspaces(...)` (i.e. right before the DB query, not derived from
   the result rows — an empty result set must still yield a usable cursor).
   Return `Response.json({ workspaces: rows, cursor })` for both the full
   snapshot and `?since=` branches, so the client always has a fresh cursor
   to persist regardless of which endpoint variant it called.
2. In `functions/_lib/db.ts`, change the delta-filter SQL in `listWorkspaces`
   from `WHERE user_id = ? AND updated_at > ?` to
   `WHERE user_id = ? AND updated_at >= ?` (inclusive). Update the function's
   doc comment to explain the inclusive boundary is intentional: it trades a
   small amount of duplicate row re-delivery (safe — see below) for closing
   the race window where a row's `updated_at` lands exactly on a previously
   issued cursor value.
   - No signature/shape change needed for `listWorkspaces` itself — it still
     returns `WorkspaceRow[]`; the cursor lives entirely in the route
     handler. This keeps `functions/__tests__/db.test.ts` call sites
     (`listWorkspaces(db, user.id)` / `(db, user.id, since)`) unchanged
     except for one new boundary test (below).

**Client (`web/src/sync.ts`):**
3. Change `pullWorkspaces` to return `{ rows: WorkspaceRow[]; cursor: number }`
   (decrypt `data.workspaces` as today, pass `data.cursor` straight through —
   no client-side interpretation of its value beyond storing/echoing it).
   Since `pullWorkspaces` is never actually invoked without a `since` value
   in current code (`onLogin` always passes `0`; `deltaRefresh` always passes
   the stored cursor), simplify its signature to a required `since: number`
   parameter and always hit `/api/workspaces?since=${since}` — this removes
   the now-dead "since === undefined → bare `/api/workspaces`" branch/URL
   instead of adding an unused code path to maintain.
4. Split the single `lastPullTs` variable into two, since it was overloaded
   for two different jobs:
   - `syncCursor` (module-level, initial `0`) — the server-provided
     high-water-mark, sent as `since` on the next pull. Only ever assigned
     from a server response's `cursor` field, never from `Date.now()`.
   - `lastPullAttemptTs` (module-level, initial `0`) — pure client-side
     wall-clock bookkeeping used only for the 15 s throttle window in
     `deltaRefresh`. Wall-clock is fine here since it only rate-limits local
     calls and never crosses the network as data.
5. `deltaRefresh`: throttle check/update uses `lastPullAttemptTs`; the pull
   itself uses `since = syncCursor`, and on response
   `syncCursor = cursor` is set unconditionally (before the `rows.length ===
   0` early return), so the cursor advances even when nothing changed.
6. `onLogin`: after `const { rows, cursor } = await pullWorkspaces(0);`, set
   `syncCursor = cursor` (not `Date.now()`) and `lastPullAttemptTs =
   Date.now()` (keeps the existing "don't immediately re-poll right after
   login" throttle behavior).
7. Update the module comment block (top of file, ~line 11) and the
   `deltaRefresh`/cursor-related comments to describe the new cursor
   contract instead of "client clock" / "lastPullTs".

**Why re-delivery from `>=` is safe:** `mergeWorkspaces` already compares
`version` per workspace id (`local wins unless remote.version >
local.version`), so re-receiving an already-applied row is a no-op — no new
dedup logic needed client-side beyond the existing merge.

## Tests to add/update

- `functions/__tests__/workspaces.test.ts`: assert `GET /api/workspaces` and
  `GET /api/workspaces?since=` responses both include a numeric `cursor`
  field. Add a boundary test: create a workspace, capture its exact
  `updated_at`, call the delta endpoint with `since=<that exact value>`, and
  assert the row IS returned (proves the `>=` fix; would have been excluded
  under the old `>` comparison).
- `functions/__tests__/db.test.ts`: add a `listWorkspaces` unit test for the
  same `>=` boundary directly against the DB helper.
- `web/src/sync.test.ts`:
  - Update all mocked `GET` fetch responses (`{ workspaces: [...] }`) to
    also include a `cursor` value, since `pullWorkspaces` now destructures
    it.
  - New test (AC #1 — clock skew): mock a server response with
    `cursor: <serverNow>`, then advance the client's fake system clock far
    ahead (e.g. +10 min) before the next `deltaRefresh()` call; assert the
    `since=` query param sent equals the previously-returned server
    `cursor`, not any client-derived timestamp — i.e. skew has zero effect
    on what's requested.
  - New test (AC #2 — in-flight write): simulate two sequential pulls where
    the second mock's `since` param received matches exactly the first
    mock's returned `cursor` (including the boundary-equal case), and that a
    row whose mocked `updated_at` equals that cursor is still merged in
    (proxying the server-side inclusive-boundary guarantee through the
    client flow).
  - Confirm the existing throttle test and rapid-edit/debounce tests still
    pass with the split `syncCursor`/`lastPullAttemptTs` variables.

## Documentation (AC #3)

Update `AGENTS.md`:
- Workspace API table (~line 251): reword the `?since=<epochMs>` row to
  clarify `since` is the last server-issued `cursor`, not a client
  timestamp, and note the response now includes `cursor`.
- Add a new "Cursor contract (delta sync)" subsection near "Cross-device
  refresh strategy" (~line 540) documenting: `cursor` is captured
  server-side before the query runs (not derived from result rows); clients
  must echo it back verbatim, never substitute wall-clock time; the filter
  is inclusive (`>=`) and duplicate delivery is expected/safe due to
  `mergeWorkspaces` idempotency; and the known residual limitation (this
  narrows but doesn't perfectly eliminate sub-millisecond races within
  D1/SQLite's serialized write path).

## Verification

- `nix develop -c bash -c "cd web && pnpm test"` and
  `nix develop -c bash -c "cd functions && pnpm test"` (or repo's combined
  test command per AGENTS.md) — all sync/workspaces/db tests green.
- Manual/dev-server check: set the browser clock forward (or mock
  `Date.now`) by 10+ minutes, perform a cross-device edit from a second
  session, and confirm the skewed client still picks up the delta via
  `deltaRefresh`/polling.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation:

Server:
- functions/api/workspaces/index.ts: capture cursor = Date.now() immediately
  before calling listWorkspaces (not derived from result rows), returning
  { workspaces, cursor } for both the snapshot and delta branches.
- functions/_lib/db.ts: listWorkspaces delta filter changed from
  `updated_at > ?` to `updated_at >= ?` (inclusive), with doc comment
  explaining the race this closes and why duplicate re-delivery is safe
  (mergeWorkspaces is version-idempotent).

Client (web/src/sync.ts):
- pullWorkspaces now takes a required `since: number` and returns
  { rows, cursor } instead of a bare WorkspaceRow[] (removed the dead
  since-undefined branch, since callers always pass a value).
- Split the overloaded lastPullTs into two module-level variables:
  syncCursor (server-issued high-water-mark, only ever assigned from a
  response's cursor field) and lastPullAttemptTs (pure client wall-clock,
  used only for the 15s deltaRefresh throttle).
- deltaRefresh: pulls with since=syncCursor, then sets
  syncCursor = cursor unconditionally (even when rows is empty) before the
  early return, so the cursor advances even on a no-op pull.
- onLogin: adopts cursor from the initial pullWorkspaces(0) response instead
  of stamping Date.now().

Tests:
- functions/__tests__/workspaces.test.ts: asserts both the full-snapshot and
  delta GET responses include a numeric `cursor`; added a boundary test
  proving since=<exact updated_at> still returns the row (would have been
  excluded under the old `>` comparison).
- functions/__tests__/db.test.ts: added a listWorkspaces unit test for the
  same >= boundary directly against the DB helper.
- web/src/sync.test.ts: updated all mocked GET responses to include cursor;
  added two new tests under "deltaRefresh server cursor contract" —
  AC #1 proves a +10 minute client clock skew has zero effect on the since=
  param sent (it always echoes the previously returned server cursor), and
  AC #2 proves a row landing exactly on the previous cursor is still merged
  in on the next pull.

Docs (AGENTS.md):
- Reworded the workspaces API table row for ?since=<cursor> to describe the
  cursor contract instead of an epoch-ms client timestamp.
- Added a "Cursor contract (delta sync)" subsection documenting: server-side
  capture before the query runs, clients must echo verbatim (never
  substitute wall-clock time), inclusive >= filter with safe duplicate
  re-delivery via mergeWorkspaces idempotency, and the known residual
  sub-millisecond race limitation.
- Fixed a second stale ?since=<epochMs> reference in the functions/ layout
  section.

Verification: `pnpm test run` (web, 385 passed), `pnpm test:functions` (56
passed), tsc --noEmit clean for web + functions + functions test project,
eslint clean (pre-existing unrelated warnings only), prettier --write applied
to touched files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced client-clock-derived delta sync cursor with a server-owned, monotonic high-water-mark: the /api/workspaces endpoint now captures cursor=Date.now() before querying and returns it in every response, listWorkspaces filters updated_at >= since (inclusive) instead of >, and the client echoes the server cursor back verbatim (split into syncCursor vs. a purely-local lastPullAttemptTs throttle timer) instead of stamping its own wall clock. Documented the cursor contract in AGENTS.md and added tests covering +10min client clock skew and the in-flight-write boundary case.
<!-- SECTION:FINAL_SUMMARY:END -->
