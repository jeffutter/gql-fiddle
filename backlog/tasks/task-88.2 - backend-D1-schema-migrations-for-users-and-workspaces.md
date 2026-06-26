---
id: TASK-88.2
title: 'backend: D1 schema & migrations for users and workspaces'
status: To Do
assignee: []
created_date: '2026-06-26 12:11'
updated_date: '2026-06-26 21:14'
labels:
  - backend
  - database
  - cloudflare
dependencies:
  - TASK-88.1
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
- [ ] #1 Migration files create users and workspaces tables with the documented columns and indexes
- [ ] #2 `wrangler d1 migrations apply` runs cleanly against local and remote D1
- [ ] #3 Data-access helper module exposes typed functions for get/create user, list workspaces by user, upsert workspace, and soft-delete
- [ ] #4 Workspace ids are client-generated uuids; deletes are soft (deleted_at) so other devices observe them
- [ ] #5 Tests verify schema creation and helper round-trip; AGENTS.md documents the migration commands
<!-- AC:END -->
