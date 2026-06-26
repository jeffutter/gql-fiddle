---
id: TASK-88.6
title: >-
  web: cloud sync engine — pull-on-login, debounced auto-save, last-write-wins,
  offline fallback
status: To Do
assignee: []
created_date: '2026-06-26 12:13'
updated_date: '2026-06-26 21:14'
labels:
  - web
  - sync
  - storage
dependencies:
  - TASK-88.4
  - TASK-88.5
  - TASK-87
parent_task_id: TASK-88
priority: high
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

The core of the feature (parent TASK-88): when a user is logged in, their workspaces auto-save to the cloud and load on any device, with localStorage as a seamless fallback when logged out or offline.

## Depends on

- TASK-88.4 — workspace REST API (`GET/PUT/DELETE /api/workspaces`, versioning, soft-delete).
- TASK-88.5 — auth state (`{ user, status }`) and auth client.
- **TASK-87** — the multi-workspace data model (`WorkspaceEntry[]`, `activeWorkspaceIndex`, store v4) that this syncs. Each `WorkspaceEntry` already has a stable identity slot; this task adds/uses a per-workspace `id` (uuid) and `version` for sync.

## Scope

Build a sync layer (e.g. `web/src/sync.ts`) wired into the Zustand store (`web/src/store.ts`):

- **Workspace identity**: ensure each `WorkspaceEntry` carries a stable client-generated `id` (uuid) and a `version` counter. Add a store-version migration to backfill ids/versions for existing local workspaces. (Coordinate with TASK-87's `WorkspaceEntry` shape.)
- **On login** (auth status → authed):
  1. `GET /api/workspaces` (full snapshot).
  2. **Merge** local + remote by `id`: per id keep the higher `version` (ties → higher `updated_at`); honor remote soft-deletes; local-only workspaces (e.g. created while anonymous) are pushed up.
  3. Replace the store's `workspaces` with the merged set.
- **Auto-save**: subscribe to store changes; debounce (reuse the ~300 ms pattern already in the app) per workspace; on change `PUT /api/workspaces/:id` with `{ name, payload, version }`, bumping local `version`. On `409` (stale), adopt the server row (last-write-wins) and surface it.
- **Delete**: when a workspace is removed locally while authed, call `DELETE /api/workspaces/:id`.
- **Offline / logged-out fallback**: localStorage persistence remains the source of truth when `status !== 'authed'`. Queue writes made while offline and flush on reconnect/login. Network failures must never lose local data or block editing.
- Keep cloud sync strictly additive: anonymous behavior is byte-for-byte the current behavior.

## Design notes

- Last-write-wins is the deliberate conflict policy (matches TASK-88.4). No field-level merge.
- Do not sync session-only/global fields that TASK-87 keeps outside `WorkspaceEntry` (e.g. `vimMode` is global; `supergraphSdl` etc. are derived/session-only).
- Be careful not to create a feedback loop: a store update caused by a pull must not immediately re-trigger a push.

## Tests & docs

- Unit tests for the merge/reconciliation function: local-newer, remote-newer, remote-deleted, local-only-pushed, version-tie tiebreak.
- Tests that auto-save debounces and that a 409 adopts the server row.
- Test offline queue flush on reconnect and that anonymous mode never calls the API.
- Document the sync model in AGENTS.md (extend the "State management" / "URL sharing" sections).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each WorkspaceEntry has a stable client-generated id and a version; a store migration backfills them for existing local data
- [ ] #2 On login, local and remote workspaces merge by id using higher version (then updated_at) and honor remote soft-deletes; local-only workspaces are pushed to the server
- [ ] #3 Edits auto-save via debounced PUT with no explicit save action and without blocking the editor
- [ ] #4 A stale-version 409 causes the client to adopt the server row (last-write-wins)
- [ ] #5 Deleting a workspace while logged in soft-deletes it server-side
- [ ] #6 When logged out or offline, localStorage remains authoritative, edits are never lost, and queued writes flush on reconnect/login; anonymous mode makes no API calls
- [ ] #7 Pull-triggered store updates do not re-trigger a push (no sync loop)
- [ ] #8 Unit tests cover the merge function (all cases), debounced save, 409 adoption, and offline flush; AGENTS.md documents the sync model
<!-- AC:END -->
