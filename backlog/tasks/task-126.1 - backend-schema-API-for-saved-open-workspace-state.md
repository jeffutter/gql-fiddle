---
id: TASK-126.1
title: 'backend: schema & API for saved / open workspace state'
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-06 22:20'
updated_date: '2026-08-08 00:59'
labels:
  - feature
  - workspaces
  - backend
  - planned
dependencies: []
parent_task_id: TASK-126
priority: medium
type: feature
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Part of TASK-126 (Saved workspaces). Extend the workspace persistence model so each workspace row can carry, in addition to the existing content/version/`deleted_at` fields documented in AGENTS.md's "Workspace API" section:

- Whether the workspace is **Saved** (marked to persist past tab close).
- Whether the workspace is currently **open** as a tab. This is shared/synced state, not per-device local UI state — the whole point is that opening/closing a saved workspace reflects across the user's devices.

This underpins the rest of TASK-126: the sync engine, tab-close behavior, and Saved Workspaces menu all read/write these fields.

Relevant existing code: `migrations/` (numbered sequential SQL migrations — see `0001_initial.sql` for the `workspaces` table), `functions/_lib/db.ts` (data-access helpers), `functions/api/workspaces/index.ts` and `functions/api/workspaces/[id].ts` (REST endpoints), `functions/__tests__/workspaces.test.ts` and `functions/__tests__/d1-mock.ts` (existing test harness).

Existing rows have no saved/open concept today — every non-deleted workspace is implicitly "open" everywhere (see TASK-126's description). Pick defaults for the new columns that preserve that behavior for rows that predate this migration, so no existing workspace unexpectedly disappears from or reappears in a tab bar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new migration adds the saved and open/closed fields to the workspaces table, defaulting existing rows so today's behavior (every non-deleted workspace open everywhere) is preserved until a client explicitly changes them
- [x] #2 PUT /api/workspaces/:id accepts and persists the saved and open/closed fields, subject to the same version/last-write-wins semantics as the rest of the row
- [x] #3 GET /api/workspaces and GET /api/workspaces?since=... responses include the saved and open/closed fields
- [x] #4 functions/__tests__/workspaces.test.ts is extended to cover reading and writing the new fields, including the versioning/409 behavior
- [x] #5 AGENTS.md's Workspace API section documents the new fields and their semantics
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Add two D1 columns (`saved`, `open`) to `workspaces`, defaulted so existing
rows keep today's implicit behavior (every non-deleted workspace open
everywhere, none "saved" in the new sense — so closing one still deletes it
immediately, unchanged). Store them as SQLite INTEGER (0/1, no native
boolean type), but expose them as JS `boolean` at the `WorkspaceRow`/REST
boundary — `functions/_lib/db.ts` is the single place that owns the 0/1
encoding (info-hiding: nothing outside db.ts should know SQLite has no
boolean type).

### 1. Migration `migrations/0005_workspaces_saved_open.sql`

```sql
ALTER TABLE workspaces ADD COLUMN saved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN open INTEGER NOT NULL DEFAULT 1;
```

- `saved` defaults to 0 (false): pre-migration rows have no saved concept,
  so none are "saved" — closing their tab keeps today's immediate-delete
  behavior (TASK-126.3 branches on this flag).
- `open` defaults to 1 (true): every pre-existing non-deleted workspace
  keeps appearing as a tab on every device, exactly as today (TASK-126.2
  will filter the tab bar on this flag).
- Add a short header comment explaining both defaults and pointing at
  `db.ts` as the encoding's owner (follow the style of `0004_live_sessions.sql`'s
  header comment).

### 2. `functions/_lib/db.ts`

- Add an internal (not exported) `RawWorkspaceRow` type mirroring the exact
  SQLite row shape: same fields as `WorkspaceRow` but `saved: number` and
  `open: number`.
- Change the exported `WorkspaceRow` interface: add `saved: boolean;` and
  `open: boolean;`.
- Add an exported `mapWorkspaceRow(raw: RawWorkspaceRow): WorkspaceRow`
  that spreads the raw row and overrides `saved: raw.saved === 1, open:
  raw.open === 1`. Export it — `[id].ts` needs it too (see below).
- `WorkspaceUpsert`: add `saved: boolean; open: boolean;` (both **required**
  in this interface — see the "omitted-field" design note below for why the
  optionality lives in the endpoint layer, not here).
- `listWorkspaces`: change both `.all<WorkspaceRow>()` calls to
  `.all<RawWorkspaceRow>()`, then `.map(mapWorkspaceRow)` before returning
  (both the `since` branch and the full-snapshot branch).
- `upsertWorkspace`:
  - Add `saved, open` to the INSERT column list and `VALUES (..., ?, ?)`,
    binding `row.saved ? 1 : 0` and `row.open ? 1 : 0`.
  - Add `saved = excluded.saved, open = excluded.open` to the `ON CONFLICT
    ... DO UPDATE SET` clause. Leave the existing `WHERE excluded.version >=
    workspaces.version AND workspaces.user_id = excluded.user_id` guard
    untouched — it already gates the whole row, including these two new
    columns.
  - Change the post-write re-read to `.first<RawWorkspaceRow>()` and map
    through `mapWorkspaceRow` before returning as `current`. The rest of the
    accepted/not-accepted logic (`current.version <= row.version`) is
    unaffected.

### 3. `functions/api/workspaces/[id].ts` (PUT handler)

**Design decision — omitted `saved`/`open` must preserve the existing
value, not reset to a default.** TASK-126.1 ships and deploys before
TASK-126.2/126.3 (the frontend that actually sets these fields). Every PUT
issued by the *current* frontend (plain content autosaves) will omit
`saved`/`open` entirely, indefinitely, until 126.2/126.3 ship — and even
after they ship, a stale browser tab running old JS could still PUT without
these fields for a while. If a missing field defaulted to `false`/`true` on
every write, an old client's autosave would silently un-save a workspace
the user had just marked saved from a newer tab/device. So: on PUT,
`undefined` means "leave this column as it is" for an existing row, and
falls back to the migration's defaults only for a genuinely new row.

Implementation:

- Broaden the existing pre-write ownership-check query from `SELECT user_id
  FROM workspaces WHERE id = ?` to `SELECT user_id, saved, open FROM
  workspaces WHERE id = ?`. **Do not** widen it to `SELECT *` — that would
  pull the (up to 1 MB) `payload` column on every single PUT just to
  discard it, a real perf/cost regression. Convert the two extra columns
  inline (`existing.saved === 1`, `existing.open === 1`) rather than
  routing through `mapWorkspaceRow` (which expects the full raw row shape)
  — this is the one place outside db.ts allowed to know the 0/1 encoding,
  justified by avoiding the wasted payload read.
- Extend the request body type to `{ name: string; payload: string;
  version: number; saved?: boolean; open?: boolean }`.
- Validate: if present, `saved`/`open` must be `boolean` — reuse the
  existing 400 pattern (add a check alongside the current
  name/payload/version type check; a `typeof x !== "boolean"` message is
  fine as a separate `if`, doesn't need to merge into the existing combined
  message).
- Compute effective values before calling `upsertWorkspace`:
  ```ts
  const effectiveSaved = body.saved ?? existingSaved ?? false;
  const effectiveOpen = body.open ?? existingOpen ?? true;
  ```
  where `existingSaved`/`existingOpen` come from the broadened ownership
  query above (`undefined` when the row doesn't exist yet — i.e. this is an
  insert, so it falls through to the schema defaults `false`/`true`,
  matching migration 0005).
- Pass `saved: effectiveSaved, open: effectiveOpen` into the
  `upsertWorkspace` call.

### 4. `functions/api/workspaces/index.ts` (GET)

No code change needed — `listWorkspaces` now returns `WorkspaceRow[]` with
real booleans, and the handler already does `Response.json({ workspaces:
rows, cursor })`. Satisfies AC3 (both snapshot and `?since=` delta) for
free.

### 5. `functions/__tests__/workspaces.test.ts`

- Change `migrationSql` to the array+join pattern already used in
  `db.test.ts`/`enc-meta.test.ts`: include `0001_initial.sql` and
  `0005_workspaces_saved_open.sql` (skip 0002-0004, they touch unrelated
  tables — matches how `db.test.ts` only pulls in the migrations relevant
  to what it exercises).
- Add test coverage:
  1. PUT with `{ saved: true, open: false }` on a new workspace persists
     both; response `workspace.saved === true`, `workspace.open === false`.
  2. PUT with `saved`/`open` omitted on a **new** workspace defaults to
     `saved: false, open: true`.
  3. PUT with `saved`/`open` omitted on an **existing** workspace that was
     previously saved (`saved: true`) preserves `saved: true` rather than
     resetting it to `false` — this is the regression test for the
     omitted-field-preserves design decision above; the most important new
     test in this file.
  4. The existing 409 stale-version test: extend its assertions (or add a
     sibling test) to confirm the `current` row in the 409 body includes
     `saved`/`open`.
  5. GET `/api/workspaces` (full snapshot) response includes `saved`/`open`
     as JS booleans (`typeof ws.saved === "boolean"`).
  6. GET `/api/workspaces?since=...` (delta) response includes them too.
  7. 400 when `saved` or `open` is present but not a boolean (e.g.
     `saved: "yes"`).
- Follow the file's existing inline-response-type-casting style (`(await
  res.json()) as { workspace: {...} }`) for the new assertions.

### 6. `AGENTS.md` — Workspace API section

- Update the PUT row: `Body: { name, payload, version, saved?, open? }`.
- Add a short paragraph (near "Last-write-wins") documenting:
  - `saved` (boolean): whether the workspace persists past tab close.
  - `open` (boolean): whether the workspace currently appears as a tab —
    shared/synced state, not local UI state.
  - Both default to `false`/`true` respectively for new rows and for
    pre-migration rows (preserving today's "every non-deleted workspace
    open everywhere" behavior).
  - Omitting either field on PUT leaves its current stored value
    unchanged (does not reset it) — only present when the caller wants to
    change it.
  - GET (snapshot and `?since=`) responses include both fields.

## Verification

- `web/node_modules/.bin/tsc --project functions/tsconfig.json --noEmit`
- `web/node_modules/.bin/tsc --project functions/__tests__/tsconfig.json --noEmit`
- `cd web && pnpm test:functions` (or `pnpm test run
  functions/__tests__/workspaces.test.ts` equivalent) — all workspaces
  tests green, including the new ones.
- `wrangler d1 migrations apply gql-fiddle-db --local` locally to confirm
  the migration applies cleanly on top of 0001-0004.
- Manually confirm via `wrangler pages dev` + `/api/auth/dev-login` that an
  existing pre-migration workspace round-trips through GET with
  `saved: false, open: true`.

## Notes / non-goals

- No web/frontend changes here (sync engine, save toggle, menu are
  TASK-126.2/126.3/126.4).
- No changes to `softDeleteWorkspace` — soft-delete semantics (`deleted_at`)
  are unaffected by `saved`/`open`; a deleted row's flags are irrelevant
  once `deleted_at` is set, and no acceptance criterion asks for a change
  here.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the ticket's plan:

- migrations/0005_workspaces_saved_open.sql adds INTEGER `saved` (default 0)
  and `open` (default 1) columns to workspaces, preserving today's implicit
  "every non-deleted workspace open everywhere, none saved" behavior for
  pre-migration rows.
- functions/_lib/db.ts: added an internal RawWorkspaceRow type + exported
  mapWorkspaceRow() to own the SQLite INTEGER 0/1 <-> JS boolean encoding.
  WorkspaceRow now has boolean saved/open; WorkspaceUpsert requires them.
  listWorkspaces and upsertWorkspace updated to read/write the new columns
  and map through mapWorkspaceRow before returning.
- functions/api/workspaces/[id].ts (PUT): body accepts optional
  saved?/open? booleans with 400 validation. The ownership-check query was
  broadened to `SELECT user_id, saved, open` (not `SELECT *`, to avoid
  pulling the up-to-1MB payload column on every PUT). Omitted saved/open
  preserve the existing stored value for an existing row and fall back to
  the schema defaults (false/true) only for a brand-new row -- this
  protects against old/stale clients that PUT without these fields
  silently resetting a workspace's saved/open state.
- functions/api/workspaces/index.ts (GET): no code change needed --
  listWorkspaces already returns mapped booleans.
- functions/__tests__/workspaces.test.ts: migrationSql switched to the
  array+join pattern (0001 + 0005). Added tests for: new-row explicit
  saved/open, new-row default saved/open, preserving saved/open on update
  when omitted (the key regression test), 400 on non-boolean saved/open,
  and both GET forms (snapshot + delta) exposing saved/open as real JS
  booleans. Extended the existing 409 test to assert saved/open appear on
  the conflict body's `current` row.
- functions/__tests__/db.test.ts: migrationSql extended to include 0005,
  and all upsertWorkspace() call sites updated to pass the now-required
  saved/open fields (WorkspaceUpsert made them required by design, per the
  plan, to push the "what does an omitted field mean" decision into the
  endpoint layer only).
- AGENTS.md's Workspace API section documents the new PUT body shape and a
  new "Saved / open fields" paragraph covering defaults and the
  omitted-field-preserves-value semantics.

Verification run:
- web/node_modules/.bin/tsc --project functions/tsconfig.json --noEmit: clean
- web/node_modules/.bin/tsc --project functions/__tests__/tsconfig.json --noEmit: clean
- cd web && pnpm test:functions: 91/91 passing
- cd web && pnpm lint: clean (2 pre-existing unrelated warnings)
- `wrangler d1 migrations apply --local` could not be exercised in this
  sandbox (missing workerd binary, no network access for a fresh wrangler
  install of the runtime); the equivalent migration SQL is exercised
  directly via better-sqlite3 in db.test.ts/workspaces.test.ts's D1 mock,
  which applies 0001+0005 (and 0001-0003+0005 in db.test.ts) cleanly on
  every test run.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a migration and backend plumbing for per-workspace 'saved' and 'open' boolean flags: new D1 columns with backward-compatible defaults, WorkspaceRow/WorkspaceUpsert typed as booleans with a single 0/1-encoding owner in db.ts, PUT /api/workspaces/:id accepting and last-write-wins-persisting the fields (omitted fields preserve the existing value rather than resetting it), GET responses (snapshot + delta) exposing them, full test coverage including the omitted-field-preserves regression case, and AGENTS.md documentation.
<!-- SECTION:FINAL_SUMMARY:END -->
