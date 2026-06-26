---
id: TASK-88.7
title: >-
  web: cross-device auto-refresh (pull on focus/visibility + sync status
  indicator)
status: Backlog
assignee: []
created_date: '2026-06-26 12:13'
labels:
  - web
  - sync
  - ux
dependencies:
  - TASK-88.6
parent_task_id: TASK-88
priority: medium
ordinal: 103000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Delivers the "auto-sync between devices" expectation (parent TASK-88) without any server push: when a user returns to a tab/device, it pulls the latest changes. Cheap, free-tier friendly, and good enough for a fiddle tool.

## Depends on

TASK-88.6 — the sync engine, merge/reconciliation, and `version`/`updated_at` plumbing this builds on.

## Scope

- **Pull on focus/visibility**: when the window regains focus or `visibilitychange` → visible (and `status === 'authed'`), do a delta `GET /api/workspaces?since=<lastPullTs>` and reconcile via the existing merge logic. Throttle to avoid hammering (e.g. at most once per N seconds).
- **Lightweight polling (optional, behind a small interval)**: only while the tab is visible and focused, optionally poll on a relaxed interval (e.g. 30–60 s). Keep it conservative to respect free-tier KV/D1 limits; document the chosen cadence. Real-time push is intentionally out of scope (tracked separately as the optional Durable Objects follow-up).
- **Sync status indicator**: a small, unobtrusive indicator in the header (using existing theme tokens/classes) reflecting `synced / saving / offline / error`. No layout disruption; consistent with the IDE aesthetic.
- Ensure an incoming pull that changes the active workspace triggers recompose (the app already recomputes the supergraph from subgraphs on change — confirm the derived/session-only state refreshes).

## Tests & docs

- Test that a focus/visibility event while authed issues a `since` pull and merges results.
- Test the throttle (rapid focus events do not produce a burst of requests).
- Test the indicator reflects saving/synced/offline/error transitions.
- Document the refresh strategy and cadence in AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Regaining focus or tab visibility while authenticated triggers a throttled delta GET ?since pull that reconciles changes from other devices
- [ ] #2 Rapid focus/visibility events are throttled to at most one pull per documented interval
- [ ] #3 Any optional visible-tab polling uses a conservative documented cadence and is disabled when the tab is hidden
- [ ] #4 A header sync status indicator reflects synced/saving/offline/error using existing theme tokens (no hardcoded colors, no layout shift)
- [ ] #5 A pull that changes the active workspace refreshes derived/session-only state (recompose runs)
- [ ] #6 Tests cover focus-triggered pull, throttling, and indicator state transitions; AGENTS.md documents the refresh strategy
<!-- AC:END -->
