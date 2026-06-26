---
id: TASK-88.2
title: 'backend: D1 schema & migrations for users and workspaces'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:11'
updated_date: '2026-06-26 22:48'
labels:
  - backend
  - database
  - cloudflare
  - planned
dependencies:
  - TASK-88.1
modified_files:
  - migrations/0001_initial.sql
  - functions/_lib/db.ts
  - functions/__tests__/d1-mock.ts
  - functions/__tests__/db.test.ts
  - functions/__tests__/tsconfig.json
  - functions/tsconfig.json
  - web/vitest.functions.config.ts
  - wrangler.jsonc
  - web/package.json
  - web/pnpm-lock.yaml
  - web/pnpm-workspace.yaml
  - AGENTS.md
parent_task_id: TASK-88
priority: high
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Defines the persistent storage shape for accounts and saved workspaces (parent TASK-88). Everything auth and sync builds on these tables.

## Depends on

TASK-88.1 — provides the D1 binding (`DB`) and Functions environment.

## Scope

Create a migrations mechanism (Wrangler D1 migrations: `migrations/*.sql` applied via `wrangler d1 migrations apply`) and the initial schema:

```sql
CREATE TABLE users (
  id           TEXT PRIMARY KEY,        -- internal uuid
  github_id    INTEGER UNIQUE NOT NULL,
  login        TEXT NOT NULL,
  name         TEXT,
  avatar_url   TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE workspaces (
  id           TEXT PRIMARY KEY,        -- client-generated uuid (stable across devices)
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  payload      TEXT NOT NULL,           -- JSON of WorkspaceEntry (subgraphs, queryTabs, seed, mockConfig, tourDraft)
  version      INTEGER NOT NULL DEFAULT 1,  -- monotonic, for last-write-wins
  updated_at   INTEGER NOT NULL,        -- epoch ms, set server-side
  deleted_at   INTEGER                  -- soft delete (null = live); lets other devices learn about deletions
);
CREATE INDEX idx_workspaces_user ON workspaces(user_id);
```

Design decisions to honor:
- Workspace **id is client-generated** (uuid) so the same logical workspace has a stable id across devices and offline creation.
- `payload` stores the serialized `WorkspaceEntry` (the per-workspace shape from TASK-87) as JSON — schema-flexible, mirrors the existing localStorage payload approach.
- **Soft delete** (`deleted_at`) so a delete on device A propagates to device B on next pull rather than the workspace silently reappearing.
- `version` + `updated_at` support last-write-wins reconciliation used by the sync engine.

Provide a small typed data-access helper module in `functions/` (e.g. `functions/_lib/db.ts`) wrapping the common queries (upsert workspace, list by user, soft-delete, get/create user) so endpoint code stays thin.

## Tests & docs

- Add a test that applies migrations to a local D1 (or better-sqlite3 shim) and asserts the tables/indexes exist and the data-access helpers round-trip a workspace.
- Document the migration commands in AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration files create users and workspaces tables with the documented columns and indexes
- [x] #2 `wrangler d1 migrations apply` runs cleanly against local and remote D1
- [x] #3 Data-access helper module exposes typed functions for get/create user, list workspaces by user, upsert workspace, and soft-delete
- [x] #4 Workspace ids are client-generated uuids; deletes are soft (deleted_at) so other devices observe them
- [x] #5 Tests verify schema creation and helper round-trip; AGENTS.md documents the migration commands
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Atomic task — all work ships together. No sub-tickets: migrations define the schema, `db.ts` wraps it, and the test validates both in sequence. Breaking them up creates artificial seams.

## Step 1 — Add `migrations_dir` to `wrangler.toml`

In the existing `[[d1_databases]]` block add:
```toml
migrations_dir = "migrations"
```
This tells wrangler where to find migration files and enables `wrangler d1 migrations apply`.

## Step 2 — Create `migrations/0001_initial.sql`

Create directory `migrations/` at the project root and add the file with the exact DDL from the ticket description:

```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  github_id  INTEGER UNIQUE NOT NULL,
  login      TEXT NOT NULL,
  name       TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_workspaces_user ON workspaces(user_id);
```

No data-seeding or additional statements.

## Step 3 — Create `functions/_lib/db.ts`

Create the `functions/_lib/` directory and `db.ts` module. Export:

### Types

```ts
export interface UserRow {
  id: string;           // uuid
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: number;   // epoch ms
}

export interface WorkspaceRow {
  id: string;           // client-generated uuid
  user_id: string;
  name: string;
  payload: string;      // JSON of WorkspaceEntry
  version: number;
  updated_at: number;   // epoch ms, set server-side
  deleted_at: number | null;
}
```

### Functions

**`getOrCreateUser(db, github)`**
- `github: { github_id: number; login: string; name: string | null; avatar_url: string | null }`
- Uses `INSERT INTO users ... ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, name=excluded.name, avatar_url=excluded.avatar_url` then immediately `SELECT * FROM users WHERE github_id = ?`
- Always returns a `UserRow` (never null)

**`listWorkspaces(db, userId)`**
- `SELECT * FROM workspaces WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`
- Returns `WorkspaceRow[]`

**`upsertWorkspace(db, row)`**
- `row: { id: string; user_id: string; name: string; payload: string; version: number }`
- Uses `INSERT INTO workspaces (id, user_id, name, payload, version, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at WHERE excluded.version >= workspaces.version`
- Server sets `updated_at = Date.now()` before the query
- Returns the resulting `WorkspaceRow` via a follow-up SELECT

**`softDeleteWorkspace(db, id, userId)`**
- `UPDATE workspaces SET deleted_at = ? WHERE id = ? AND user_id = ?`
- Returns `boolean` (true if a row was updated, false if not found / wrong owner)

Keep all SQL in this module. Endpoint files import from `../_lib/db` and stay thin.

## Step 4 — Tests

Create `functions/__tests__/db.test.ts`. Use `@cloudflare/vitest-pool-workers` for a real in-process D1 instance so the tests execute actual SQLite queries without network access.

**vitest pool workers config approach:**
- Add a `vitest.config.ts` (or `vitest.config.functions.ts`) at the project root (or `functions/`) using the `@cloudflare/vitest-pool-workers` pool, pointing at `wrangler.toml` for bindings.
- In test setup (`beforeAll`), read `migrations/0001_initial.sql` and execute it via `env.DB.exec(sql)` to bootstrap the schema.

**Test cases:**
1. Schema assertion — `SELECT name FROM sqlite_master WHERE type='table'` returns `users` and `workspaces`; index `idx_workspaces_user` exists.
2. `getOrCreateUser` — creates a user, returns the row with a uuid `id`; calling again with same `github_id` returns the same `id` (idempotent).
3. `upsertWorkspace` — inserts a workspace with client-supplied uuid, `listWorkspaces` returns it.
4. `listWorkspaces` — excludes soft-deleted rows.
5. `softDeleteWorkspace` — sets `deleted_at`; workspace disappears from `listWorkspaces` but row still exists in the table.
6. Last-write-wins guard — upsert with a lower `version` than the stored row does not overwrite.

Add a `"test:functions"` script to `web/package.json` (or a root-level runner) so CI can invoke function tests separately from the frontend vitest suite.

## Step 5 — Update AGENTS.md

Under the "Backend" section, add a "### Migrations" subsection:

```sh
# Apply migrations to local D1 (creates SQLite state under .wrangler/)
wrangler d1 migrations apply gql-fiddle-db --local

# Apply migrations to production D1
wrangler d1 migrations apply gql-fiddle-db --remote

# Check pending migrations
wrangler d1 migrations list gql-fiddle-db
```

Also update the Backend layout diagram to list the new paths:
```
functions/
  _lib/
    db.ts           Typed data-access helpers (users + workspaces)
  api/
    health.ts       GET /api/health (liveness probe)
migrations/
  0001_initial.sql  users + workspaces tables + index
```

## Files to create / modify

- `wrangler.toml` — add `migrations_dir = "migrations"` to `[[d1_databases]]`
- `migrations/0001_initial.sql` — new
- `functions/_lib/db.ts` — new
- `functions/__tests__/db.test.ts` — new
- `functions/vitest.config.ts` (or project-root config) — new, uses `@cloudflare/vitest-pool-workers`
- `AGENTS.md` — add Migrations subsection and layout update

## Integration notes

- TASK-88.3 (GitHub OAuth + sessions) will call `getOrCreateUser` from `db.ts`. The interface here must be stable before that task ships.
- TASK-88.4 (workspace sync REST API) will call `listWorkspaces`, `upsertWorkspace`, and `softDeleteWorkspace`.
- No web-layer changes in this task — `payload` format mirrors the existing `WorkspaceEntry` from `web/src/share.ts` but is stored as JSON text; the sync engine (TASK-88.6) is responsible for serializing/deserializing.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented D1 schema & migrations for users and workspaces.

**Created files:**
- `migrations/0001_initial.sql` — users + workspaces tables + idx_workspaces_user index; soft-delete via deleted_at; last-write-wins via version
- `functions/_lib/db.ts` — typed helpers: getOrCreateUser, listWorkspaces, upsertWorkspace (INSERT ON CONFLICT with version guard), softDeleteWorkspace
- `functions/__tests__/d1-mock.ts` — better-sqlite3-backed D1Database shim (workerd binary incompatible with Nix; better-sqlite3 explicitly allowed by task)
- `functions/__tests__/db.test.ts` — 8 tests covering schema creation, user idempotency, workspace CRUD, last-write-wins, soft delete, and wrong-owner guard
- `functions/__tests__/tsconfig.json` — separate tsconfig for test files adding node + better-sqlite3 types without polluting production Workers typecheck
- `web/vitest.functions.config.ts` — vitest config for functions tests (node environment)

**Modified files:**
- `wrangler.jsonc` — added migrations_dir to D1 binding
- `functions/tsconfig.json` — excludes __tests__ directory (production code only)
- `web/package.json` — added test:functions script, @types/better-sqlite3, @types/node, better-sqlite3, @cloudflare/workers-types devDeps
- `web/pnpm-workspace.yaml` — added better-sqlite3 to allowBuilds
- `AGENTS.md` — added Migrations section with wrangler commands; updated Backend layout diagram; added functions tests row to Testing table

All 8 tests pass. Production and test typechecks both clean (exit 0).
<!-- SECTION:FINAL_SUMMARY:END -->
