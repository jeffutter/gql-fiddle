---
id: TASK-88.4
title: 'backend: workspace sync REST API (user-scoped CRUD + versioning)'
status: To Do
assignee: []
created_date: '2026-06-26 12:12'
updated_date: '2026-06-26 21:14'
labels:
  - backend
  - api
  - sync
  - cloudflare
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
- [ ] #1 All /api/workspaces endpoints require a valid session and operate only on the caller's own rows (cross-user access returns 404)
- [ ] #2 GET returns the user's workspaces; with ?since it includes soft-deleted rows so clients learn of deletions
- [ ] #3 PUT upserts a workspace, sets updated_at server-side, and bumps version; a stale version returns 409 with the current server row
- [ ] #4 DELETE soft-deletes (sets deleted_at, bumps version) and the deletion is visible in a subsequent ?since read
- [ ] #5 Payloads over the documented size cap are rejected with 413
- [ ] #6 Tests cover auth, ownership isolation, upsert/version bump, stale-version 409, soft-delete propagation, and size cap; AGENTS.md documents the endpoints and last-write-wins contract
<!-- AC:END -->
