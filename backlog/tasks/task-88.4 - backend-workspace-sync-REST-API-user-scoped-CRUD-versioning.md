---
id: TASK-88.4
title: 'backend: workspace sync REST API (user-scoped CRUD + versioning)'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:12'
updated_date: '2026-06-26 23:25'
labels:
  - backend
  - api
  - sync
  - cloudflare
  - planned
dependencies:
  - TASK-88.2
  - TASK-88.3
parent_task_id: TASK-88
priority: high
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

The HTTP surface the frontend sync engine reads and writes (parent TASK-88). Stores and retrieves a user's workspaces with enough metadata for last-write-wins reconciliation across devices.

## Depends on

- TASK-88.2 — `workspaces` table + data-access helpers.
- TASK-88.3 — `requireUser` auth helper + sessions (every endpoint is authenticated and scoped to the session's user).

## Scope

Implement under `/api/workspaces`, all gated by `requireUser` and scoped to the authenticated user:

- `GET /api/workspaces?since=<epochMs>` — return the user's workspaces. Include soft-deleted entries when `since` is provided (so clients learn about deletions); each item: `{ id, name, payload, version, updated_at, deleted_at }`. Without `since`, return only live workspaces (full snapshot).
- `PUT /api/workspaces/:id` — upsert one workspace (body: `{ name, payload, version }`). Server sets `updated_at`. **Last-write-wins**: accept the write if incoming `version` >= stored `version` (or stored row absent); otherwise return `409` with the current server row so the client can reconcile. On accept, bump/persist `version` and return the stored row.
- `DELETE /api/workspaces/:id` — soft-delete (set `deleted_at`, bump `version`).
- Enforce ownership: a user can only read/write their own rows (404, not 403, for rows owned by others to avoid id enumeration).
- Validate payload size against a sane cap (e.g. reject > 1 MB) to protect free-tier limits; return `413`.

## Design notes

- This is a thin REST layer over the TASK-88.2 helpers; keep endpoint code minimal.
- `since`-based delta read keeps cross-device refresh cheap (only changed rows), but a full snapshot on first load is fine.
- Last-write-wins is the intentional, simple conflict policy for this feature; do not build merge logic.

## Tests & docs

- Tests (Functions test harness or unit tests against the data-access helpers with a local D1/sqlite shim): auth required (401), ownership isolation, upsert + version bump, stale-version 409, soft-delete via DELETE then visible in `since` read, payload-size 413.
- Document the endpoints and the last-write-wins contract in AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All /api/workspaces endpoints require a valid session and operate only on the caller's own rows (cross-user access returns 404)
- [x] #2 GET returns the user's workspaces; with ?since it includes soft-deleted rows so clients learn of deletions
- [x] #3 PUT upserts a workspace, sets updated_at server-side, and bumps version; a stale version returns 409 with the current server row
- [x] #4 DELETE soft-deletes (sets deleted_at, bumps version) and the deletion is visible in a subsequent ?since read
- [x] #5 Payloads over the documented size cap are rejected with 413
- [x] #6 Tests cover auth, ownership isolation, upsert/version bump, stale-version 409, soft-delete propagation, and size cap; AGENTS.md documents the endpoints and last-write-wins contract
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Thin REST layer over the TASK-88.2 data helpers, gated by `requireUser` from TASK-88.3. Two changes to `functions/_lib/db.ts` to support `since`-based delta reads and version-bumping soft-delete, then two new endpoint files.

## Step 1 — Extend `functions/_lib/db.ts`

### 1a. Extend `listWorkspaces` to support `since`

Add optional `since?: number` parameter:

```ts
export async function listWorkspaces(
  db: D1Database,
  userId: string,
  since?: number
): Promise<WorkspaceRow[]>
```

- Without `since`: existing query (WHERE deleted_at IS NULL ORDER BY updated_at DESC)
- With `since`: `SELECT * FROM workspaces WHERE user_id = ? AND updated_at > ? ORDER BY updated_at DESC` — includes soft-deleted rows so clients learn of deletions

### 1b. Update `softDeleteWorkspace` to bump version

```sql
UPDATE workspaces
SET deleted_at = ?, version = version + 1, updated_at = ?
WHERE id = ? AND user_id = ?
```

Returns `boolean` (true if row was updated).

### 1c. Update `upsertWorkspace` return type to signal version conflicts

Change return type to `{ accepted: boolean; row: WorkspaceRow }`.

After the INSERT ON CONFLICT, SELECT the current row. If `row.version > incoming version`, the WHERE clause rejected the update: `accepted = false`. The caller uses this to return 409 vs 200.

Also add a user ownership guard to the ON CONFLICT clause:

```sql
ON CONFLICT(id) DO UPDATE SET
  name       = excluded.name,
  payload    = excluded.payload,
  version    = excluded.version,
  updated_at = excluded.updated_at
WHERE excluded.version >= workspaces.version
  AND workspaces.user_id = excluded.user_id
```

After the upsert, if `SELECT` returns a row with a different `user_id` than the request → endpoint returns 404 (no id enumeration).

## Step 2 — `functions/api/workspaces/index.ts` — GET /api/workspaces

```ts
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
  if (result instanceof Response) return result;
  const user = result;
  const sinceParam = new URL(ctx.request.url).searchParams.get("since");
  const since = sinceParam !== null ? Number(sinceParam) : undefined;
  const rows = await listWorkspaces(ctx.env.DB, user.id, since);
  return Response.json({ workspaces: rows });
};
```

## Step 3 — `functions/api/workspaces/[id].ts` — PUT + DELETE

The `[id]` file uses `ctx.params.id` for the workspace id.

**PUT handler:**
1. `requireUser` → 401 if unauthenticated
2. Parse JSON body: `{ name: string; payload: string; version: number }`
3. Validate: if `payload.length > 1_048_576` → 413 `{ error: "Payload too large" }`
4. Check ownership: SELECT existing row; if exists and `row.user_id !== user.id` → 404
5. `upsertWorkspace(db, { id, user_id: user.id, name, payload, version })`
6. If `!accepted` → 409 `{ conflict: true, current: row }`
7. If `accepted` → 200 `{ workspace: row }`

**DELETE handler:**
1. `requireUser` → 401
2. `softDeleteWorkspace(db, id, user.id)`
3. If `false` → 404
4. 204 No Content

## Step 4 — Tests (`functions/__tests__/workspaces.test.ts`)

Reuse D1 mock + migration + inline KV mock pattern from `auth.test.ts`. Seed a user via `getOrCreateUser` and mint a fake session cookie.

Test cases:
1. GET without valid session → 401
2. GET full snapshot — returns only live (non-deleted) workspaces for the user
3. GET ?since=<ts> — returns modified rows including soft-deleted since that timestamp
4. Cross-user isolation: GET only shows caller's own rows
5. PUT new workspace → 200, row returned
6. PUT with higher version → 200, update accepted
7. PUT with stale version → 409 with `{ conflict: true, current: row }`
8. PUT payload > 1 MB → 413
9. PUT with another user's workspace id → 404
10. DELETE live workspace → 204; row now has deleted_at set; visible in ?since query
11. DELETE wrong owner → 404

## Step 5 — AGENTS.md

Add "### Workspace API" under the Backend section:

```
GET  /api/workspaces           Full snapshot (live workspaces only)
GET  /api/workspaces?since=N   Delta since epoch ms (live + soft-deleted rows where updated_at > N)
PUT  /api/workspaces/:id       Upsert. Body: {name, payload, version}. 200 on accept, 409 on stale version
DELETE /api/workspaces/:id     Soft-delete (sets deleted_at, bumps version). 204 on success

Last-write-wins: PUT accepted if incoming version >= stored version. On 409 the response body
includes the current server row so the client can adopt it.
Payload cap: 1 MB per workspace (413 if exceeded).
Cross-user access returns 404 to avoid id enumeration.
```
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented workspace sync REST API: extended `functions/_lib/db.ts` (listWorkspaces with optional `since` param for delta reads, upsertWorkspace returning `{accepted, row}` for version conflict signaling with user ownership guard, softDeleteWorkspace bumping version+updated_at); created `functions/api/workspaces/index.ts` (GET full snapshot + delta); created `functions/api/workspaces/[id].ts` (PUT with LWW + 409 on stale version + 413 on payload >1 MB + 404 on cross-user access; DELETE soft-delete). Added 11 unit tests in `functions/__tests__/workspaces.test.ts`. Updated `AGENTS.md` with Workspace API endpoint table + LWW contract. Updated `functions/__tests__/db.test.ts` for the new upsertWorkspace return type.
<!-- SECTION:FINAL_SUMMARY:END -->
