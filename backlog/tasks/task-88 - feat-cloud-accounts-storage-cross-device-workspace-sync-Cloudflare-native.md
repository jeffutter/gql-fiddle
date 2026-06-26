---
id: TASK-88
title: >-
  feat: cloud accounts, storage & cross-device workspace sync
  (Cloudflare-native)
status: Backlog
assignee: []
created_date: '2026-06-26 12:11'
updated_date: '2026-06-26 12:11'
labels:
  - feature
  - storage
  - backend
  - auth
  - sync
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
- [ ] #1 A logged-in user's workspaces persist to the cloud and reappear after clearing localStorage or on another device
- [ ] #2 Auto-save requires no explicit save action and does not block editing
- [ ] #3 Editing on device A and then focusing the app on device B reflects A's changes (last-write-wins)
- [ ] #4 Anonymous (logged-out) users retain full localStorage-only behavior with no regressions
- [ ] #5 Entire backend runs on Cloudflare Pages Functions + D1 + KV with no servers to maintain
- [ ] #6 All components stay within Cloudflare free-tier limits at expected usage; limits documented in AGENTS.md
<!-- AC:END -->
