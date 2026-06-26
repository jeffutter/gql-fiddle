---
id: TASK-88
title: >-
  feat: cloud accounts, storage & cross-device workspace sync
  (Cloudflare-native)
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:11'
updated_date: '2026-06-26 23:27'
labels:
  - feature
  - storage
  - backend
  - auth
  - sync
  - planned
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Today gql-fiddle is browser-only: workspaces live in `localStorage` (see AGENTS.md "State management" and `web/src/store.ts`) and are shared via `#w=` URL fragments. Users now want **accounts** so they can **save workspaces to the cloud**, **auto-save**, and **auto-sync between devices** — all without us running or maintaining servers, and staying on free tiers.

This is the umbrella/parent task. Discrete units of work are tracked as subtasks; see dependency ordering on each.

## Chosen architecture (serverless, $0)

The app is deployed via **Cloudflare Pages** (`pages deploy web/dist`, see `.github/workflows/ci.yml`). The backend is therefore built as **Cloudflare Pages Functions** (a `functions/` directory in the Pages project) rather than a separate Worker:

- **Same origin** as the static site → no CORS, session cookies work natively.
- **D1** (serverless SQLite) stores `users` + `workspaces` rows. Free tier: 5GB, 5M reads/day, 100k writes/day.
- **KV** stores opaque session tokens → user id. Free tier: 100k reads/day, 1k writes/day.
- **GitHub OAuth** for login — the audience is developers who already have GitHub accounts; no third-party auth SaaS, no extra cost.
- **Sync model**: debounced auto-save (PUT per workspace) + pull-on-login + pull-on-focus, with **last-write-wins** conflict resolution keyed on an `updated_at` / version stamp. Real-time push (Durable Objects WebSocket) is an optional, low-priority follow-up.
- Anonymous users keep working exactly as today (localStorage); cloud is purely additive and opt-in via login.

## Free-tier sustainability

At Cloudflare free limits (100k Functions requests/day, 5M/100k D1 read/write, 100k/1k KV read/write) the costs are $0 for any realistic usage of a developer fiddle tool. Debounced auto-save means roughly one write per edit-burst per active user.

## Dependency on existing work

The frontend sync work builds on the **multi-workspace data model** introduced by TASK-87 (`WorkspaceEntry[]` in the store). The cloud sync subtask depends on TASK-87 landing first.

## Subtask map

1. Infra scaffolding — Pages Functions + wrangler config + D1/KV bindings + CI deploy
2. D1 schema & migrations (users, workspaces)
3. GitHub OAuth + KV-backed sessions
4. Workspace sync REST API (user-scoped CRUD + versioning)
5. Frontend auth client & login/logout UI
6. Frontend sync engine (pull-on-login, debounced auto-save, last-write-wins, offline fallback)
7. Cross-device auto-refresh (pull on focus/visibility + sync status indicator)
8. (Optional, low priority) Real-time sync via Durable Object WebSocket
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A logged-in user's workspaces persist to the cloud and reappear after clearing localStorage or on another device
- [x] #2 Auto-save requires no explicit save action and does not block editing
- [x] #3 Editing on device A and then focusing the app on device B reflects A's changes (last-write-wins)
- [x] #4 Anonymous (logged-out) users retain full localStorage-only behavior with no regressions
- [x] #5 Entire backend runs on Cloudflare Pages Functions + D1 + KV with no servers to maintain
- [x] #6 All components stay within Cloudflare free-tier limits at expected usage; limits documented in AGENTS.md
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

TASK-88 is a parent feature ticket. All implementation work lives in its subtasks. This plan documents the execution order, integration steps, and verification checklist.

## Subtask status summary

Done (no action needed):
- TASK-88.1 — Cloudflare Pages Functions scaffold (functions/, wrangler.jsonc, health endpoint)
- TASK-88.2 — D1 schema + migrations (users, workspaces tables) + typed db helpers
- TASK-88.3 — GitHub OAuth flow + KV-backed sessions + requireUser helper

Planned and ready to execute:
- TASK-88.9 — dev-mode auth bypass (login.ts + dev-login.ts + .dev.vars.example)
- TASK-88.4 — workspace sync REST API (GET/PUT/DELETE /api/workspaces + db.ts extensions)
- TASK-88.5 — web auth client + login/logout UI (auth.ts + useAuth store + header UI)
- TASK-88.6 — cloud sync engine (WorkspaceEntry id+version, store v5 migration, sync.ts)
- TASK-88.7 — cross-device auto-refresh (focus/visibility delta pull + sync status indicator)

Unplanned (optional, low priority — plan and execute only if demand justifies it):
- TASK-88.8 — real-time sync via Durable Object WebSocket

## Execution order

```
TASK-88.9 ─┐
            ├─► TASK-88.5 ─┐
TASK-88.4 ─┘               ├─► TASK-88.6 ─► TASK-88.7 ─► [TASK-88.8 optional]
```

TASK-88.9 and TASK-88.4 have no dependency on each other and can be worked in parallel. TASK-88.5 depends on both. TASK-88.6 depends on TASK-88.4 and TASK-88.5. TASK-88.7 depends on TASK-88.6.

## Integration verification (after all required subtasks are done)

Run locally with `wrangler pages dev web/dist`:

1. Sign in via dev bypass (`/api/auth/dev-login`). Confirm `/api/auth/me` returns the user and the header shows the avatar + username.
2. Create a workspace, edit it — verify auto-save fires (check via `wrangler d1 execute gql-fiddle-db --local --command "SELECT * FROM workspaces"`).
3. Open a second browser profile → sign in → verify the workspace from profile 1 appears.
4. Edit in profile 1. Switch to profile 2, regain focus → verify delta pull merges the change.
5. Disconnect network (browser DevTools) → edit a workspace → reconnect → verify the offline write flushes.
6. Sign out → verify localStorage-only behavior (no API calls in Network tab).
7. Clear localStorage → reload → workspaces restore from the server GET /api/workspaces.
8. Deploy to Cloudflare Pages and run the same test with real GitHub OAuth.

## Free-tier sustainability

- D1: debounced auto-save means ~1 write per edit-burst per active user, far below the 100k writes/day free limit
- KV: 1 read per request (session lookup), 1 write per login — well within 100k reads/1k writes per day
- Functions: 1 invocation per request; expected usage of a developer fiddle tool is orders of magnitude below the 100k requests/day free limit
- The optional 60 s polling (TASK-88.7) adds ~1,440 D1 reads/day per active user — negligible

## Remaining work not in subtasks

- Update the "Free-tier limits" table in AGENTS.md with per-operation estimates once real traffic data is available post-launch (not blocking for launch)
- TASK-88.8 (Durable Objects) is deferred — run the pull-based strategy first and only escalate if cross-device latency proves unacceptable in practice
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All required subtasks implemented and tested:

**TASK-88.9** — `functions/api/auth/login.ts` (unified redirect to GitHub or dev bypass) + `functions/api/auth/dev-login.ts` (mints real KV session for synthetic user, returns 404 in production) + `.dev.vars.example` template.

**TASK-88.4** — `functions/api/workspaces/index.ts` (GET with optional `?since=` delta filter) + `functions/api/workspaces/[id].ts` (PUT upsert with 1 MB cap + 409 on stale version; DELETE soft-delete). `functions/_lib/db.ts` extended: `listWorkspaces` gains optional `since` param; `upsertWorkspace` returns `{ accepted, row }` with ownership guard; `softDeleteWorkspace` bumps version.

**TASK-88.5** — `web/src/auth.ts`: User type, AuthStatus/SyncStatus types, useAuth Zustand store, `fetchCurrentUser()`, `login()`, `logout()`. App.tsx wired to bootstrap auth on mount and show avatar/username + login/logout button in header.

**TASK-88.6** — `web/src/share.ts` extended with `id?` + `version?` on WorkspaceEntry. `web/src/store.ts` bumped to v5 with migration backfilling id/version. `web/src/sync.ts`: `mergeWorkspaces` (last-write-wins pure function), `deltaRefresh` (throttled 30 s delta pull), `initSync` (full lifecycle: pull-on-login, 300 ms debounced auto-save, offline queue + flush, focus/visibility events, 60 s polling, cleanup).

**TASK-88.7** — Integrated into TASK-88.6 (sync.ts) and TASK-88.5 (auth.ts): 30 s throttled delta refresh on focus/visibilitychange/60 s poll; 8 px sync-status dot in header using CSS custom properties.

Test counts: 8 backend function tests (dev-auth) + 11 backend function tests (workspaces) + backend db tests + 8 auth.ts unit tests + 11 sync.ts unit tests = 394 total passing.

AGENTS.md updated with: backend file layout, dev auth bypass, workspace API endpoint table + LWW contract, store v5 migration, sync model + cross-device refresh strategy + free-tier sustainability notes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the complete cloud accounts + cross-device workspace sync feature on top of the existing Cloudflare Pages Functions scaffold (TASK-88.1–88.3). Added: dev-mode auth bypass with real KV sessions; workspace REST API (GET/PUT/DELETE) with last-write-wins versioning and soft-delete; frontend auth client (useAuth store, fetchCurrentUser, login, logout); store v5 migration backfilling id+version on existing workspaces; full sync engine (debounced auto-save, offline queue, pull-on-login, delta refresh on focus/visibility, 60 s polling, isSyncing loop guard); sync status dot in the header. All components stay on Cloudflare free tier. Anonymous users retain unchanged localStorage-only behavior.
<!-- SECTION:FINAL_SUMMARY:END -->
