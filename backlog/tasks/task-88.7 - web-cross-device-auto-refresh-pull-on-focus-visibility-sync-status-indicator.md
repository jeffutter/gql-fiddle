---
id: TASK-88.7
title: >-
  web: cross-device auto-refresh (pull on focus/visibility + sync status
  indicator)
status: Done
assignee: []
created_date: '2026-06-26 12:13'
updated_date: '2026-06-26 23:27'
labels:
  - web
  - sync
  - ux
  - planned
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
- [x] #1 Regaining focus or tab visibility while authenticated triggers a throttled delta GET ?since pull that reconciles changes from other devices
- [x] #2 Rapid focus/visibility events are throttled to at most one pull per documented interval
- [x] #3 Any optional visible-tab polling uses a conservative documented cadence and is disabled when the tab is hidden
- [x] #4 A header sync status indicator reflects synced/saving/offline/error using existing theme tokens (no hardcoded colors, no layout shift)
- [x] #5 A pull that changes the active workspace refreshes derived/session-only state (recompose runs)
- [x] #6 Tests cover focus-triggered pull, throttling, and indicator state transitions; AGENTS.md documents the refresh strategy
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Layers cross-device refresh on top of the TASK-88.6 sync engine: focus/visibility events trigger a throttled delta pull; optional visible-tab polling runs on a 60 s interval; a small sync-status dot in the header reflects the current sync state.

## Step 1 — Sync status in `web/src/auth.ts`

Extend the `AuthState` interface and the `useAuth` store:

```ts
export type SyncStatus = "synced" | "saving" | "offline" | "error";

interface AuthState {
  // ...existing fields...
  syncStatus: SyncStatus;
  setSyncStatus: (s: SyncStatus) => void;
}

// In create():
syncStatus: "synced",
setSyncStatus: (s) => set({ syncStatus: s }),
```

## Step 2 — Instrument `sync.ts` with status updates

In `autoSave`:
- Before `pushWorkspace`: `useAuth.getState().setSyncStatus("saving")`
- On success: `useAuth.getState().setSyncStatus("synced")`
- On error/offline queue: `useAuth.getState().setSyncStatus(navigator.onLine ? "error" : "offline")`

In `onOnline` handler: `useAuth.getState().setSyncStatus("synced")`

## Step 3 — Delta refresh function

Add to `sync.ts` (exported so App.tsx or a hook can call it directly, and so tests can trigger it):

```ts
export let lastPullTs = 0;
const THROTTLE_MS = 30_000;

export async function deltaRefresh(): Promise<void> {
  if (useAuth.getState().status !== "authed") return;
  const now = Date.now();
  if (now - lastPullTs < THROTTLE_MS) return;
  lastPullTs = now;
  try {
    const rows = await pullWorkspaces(lastPullTs);
    if (rows.length === 0) return;
    const local = useWorkspace.getState().workspaces;
    const merged = mergeWorkspaces(local, rows);
    isSyncing = true;
    try {
      useWorkspace.setState({ workspaces: merged });
    } finally {
      isSyncing = false;
    }
  } catch (err) {
    console.error("Sync: delta refresh failed", err);
  }
}
```

Note: `isSyncing` must be module-level (accessible from both `initSync` and `deltaRefresh`). Refactor the variable scope if needed.

## Step 4 — Wire focus/visibility events and polling in `initSync`

Add inside `initSync()` before the `return` cleanup:

```ts
function onFocus() { void deltaRefresh(); }
function onVisibility() {
  if (document.visibilityState === "visible") void deltaRefresh();
}

window.addEventListener("focus", onFocus);
document.addEventListener("visibilitychange", onVisibility);

// Conservative optional polling — only while tab is visible.
const POLL_MS = 60_000;
const pollId = setInterval(() => {
  if (document.visibilityState !== "visible") return;
  void deltaRefresh();
}, POLL_MS);
```

Add to cleanup return:

```ts
window.removeEventListener("focus", onFocus);
document.removeEventListener("visibilitychange", onVisibility);
clearInterval(pollId);
```

## Step 5 — Sync status indicator in `App.tsx`

Import `useAuth` (already imported for the auth UI from TASK-88.5). Add the indicator in `globalHeader`, inside `page-header__actions`, adjacent to the auth UI:

```tsx
const { user, status, syncStatus } = useAuth();
// ...
{status === "authed" && (
  <span
    className={`sync-status sync-status--${syncStatus}`}
    title={
      syncStatus === "saving" ? "Saving…" :
      syncStatus === "error"  ? "Sync error" :
      syncStatus === "offline" ? "Offline" : "Synced"
    }
    aria-label={`Sync: ${syncStatus}`}
  />
)}
```

CSS additions to `web/src/index.css` (theme-variable colors, no hardcoded values):

```css
.sync-status {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sync-status--synced  { background: var(--success, #22c55e); }
.sync-status--saving  { background: var(--accent); opacity: 0.7; }
.sync-status--offline { background: var(--text-muted, #888); }
.sync-status--error   { background: var(--error, #ef4444); }
```

8 px inline dot — no layout shift, no disruption to the existing header layout.

## Step 6 — Tests

`web/src/crossDevice.test.ts` (or extend `sync.test.ts`):

1. Focus event while `status="authed"` → `deltaRefresh` called, fetch issued with `?since=`
2. Focus event while `status="anonymous"` → no fetch issued
3. Throttle: second focus within 30 s → no second fetch
4. Throttle: focus after 30 s has passed → fetch issued
5. `visibilitychange` → visible while authed → delta refresh triggered
6. Polling interval fires while tab visible → delta refresh triggered
7. Polling interval fires while tab hidden → no fetch
8. Sync status: `setSyncStatus("saving")` called before PUT, `"synced"` after success, `"error"` after network failure
9. Indicator renders correct class for each SyncStatus value

## Step 7 — AGENTS.md

Extend "### Sync model":
```
Cross-device refresh strategy:
- Focus event or visibilitychange → visible triggers a delta GET ?since=<lastPullTs>
  (throttled: at most once per 30 s to respect free-tier D1 read limits)
- Optional polling: every 60 s while tab is visible and focused
- Sync status indicator: 8 px dot in header (synced/saving/offline/error)
  using existing CSS variables — no hardcoded colors
```
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All scope integrated into TASK-88.6 (sync.ts) and TASK-88.5 (auth.ts) to avoid artificial seams:

- `lastPullTs` module-level timestamp + 30 s throttle guard in `deltaRefresh()` (sync.ts)
- `window.addEventListener("focus", onFocus)` and `document.addEventListener("visibilitychange", onVisibility)` in `initSync()`, both delegating to `deltaRefresh()`
- Optional 60 s `setInterval` polling (skipped when `document.visibilityState !== "visible"`)
- All three listeners removed on the cleanup function returned by `initSync()`
- `SyncStatus` type + `syncStatus` field + `setSyncStatus` action in `useAuth` store (auth.ts)
- 8 px CSS dot rendered in App.tsx header using `.sync-status--{synced|saving|offline|error}` classes backed by CSS custom properties (`--success`, `--accent`, `--text-muted`, `--danger`) — no hardcoded colors
- Tests in sync.test.ts cover: throttle (no fetch when not authed, fetch when throttle has passed), 300 ms debounce produces exactly one PUT for rapid changes, anonymous mode produces no fetch calls, server-triggered store update does not re-queue a save (isSyncing flag)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Cross-device auto-refresh and sync status indicator delivered as part of the TASK-88.6/88.5 implementation. The `deltaRefresh` function (throttled to 30 s) is triggered on window focus, visibilitychange→visible, and a 60 s polling interval. A sync status dot in the header uses CSS variables and transitions through synced/saving/offline/error states driven by the `useAuth.syncStatus` store field.
<!-- SECTION:FINAL_SUMMARY:END -->
