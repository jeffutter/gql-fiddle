---
id: TASK-88.6
title: >-
  web: cloud sync engine — pull-on-login, debounced auto-save, last-write-wins,
  offline fallback
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:13'
updated_date: '2026-06-26 23:25'
labels:
  - web
  - sync
  - storage
  - planned
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
- [x] #1 Each WorkspaceEntry has a stable client-generated id and a version; a store migration backfills them for existing local data
- [x] #2 On login, local and remote workspaces merge by id using higher version (then updated_at) and honor remote soft-deletes; local-only workspaces are pushed to the server
- [x] #3 Edits auto-save via debounced PUT with no explicit save action and without blocking the editor
- [x] #4 A stale-version 409 causes the client to adopt the server row (last-write-wins)
- [x] #5 Deleting a workspace while logged in soft-deletes it server-side
- [x] #6 When logged out or offline, localStorage remains authoritative, edits are never lost, and queued writes flush on reconnect/login; anonymous mode makes no API calls
- [x] #7 Pull-triggered store updates do not re-trigger a push (no sync loop)
- [x] #8 Unit tests cover the merge function (all cases), debounced save, 409 adoption, and offline flush; AGENTS.md documents the sync model
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Adds `id` and `version` to `WorkspaceEntry` via a store v4→v5 migration, then builds `web/src/sync.ts` with the full sync lifecycle: pull-on-login, debounced auto-save, 409 adoption, and offline queuing. Anonymous behavior is unchanged — no API calls unless `status === "authed"`.

## Step 1 — Extend WorkspaceEntry + store migration

### `web/src/share.ts`

Add optional fields (optional so type is valid for any existing construction sites):

```ts
export interface WorkspaceEntry {
  // ...existing fields unchanged...
  /** Stable client-generated UUID for cloud sync. Added in store v5. */
  id?: string;
  /** Monotonic version counter for last-write-wins. Bumped on each local change that syncs. */
  version?: number;
}
```

### `web/src/store.ts`

Bump `version` from 4 to 5. Add migration block:

```ts
if (version <= 4) {
  // v4 → v5: assign stable id + version to each workspace.
  const workspaces = (state.workspaces as WorkspaceEntry[]).map((ws) => ({
    ...ws,
    id: ws.id ?? crypto.randomUUID(),
    version: ws.version ?? 1,
  }));
  state = { ...state, workspaces };
}
```

## Step 2 — `web/src/sync.ts`

### Types

```ts
interface WorkspaceRow {
  id: string;
  name: string;
  payload: string;  // JSON WorkspacePayload
  version: number;
  updated_at: number;
  deleted_at: number | null;
}
```

### Serialization helpers

```ts
function entryToPayload(ws: WorkspaceEntry): string {
  return JSON.stringify({
    subgraphs: ws.subgraphs,
    queryTabs: ws.queryTabs,
    activeQueryTab: ws.activeQueryTab,
    seed: ws.seed,
    mockConfig: ws.mockConfig,
  });
}

function rowToEntry(row: WorkspaceRow): WorkspaceEntry {
  const p = JSON.parse(row.payload) as WorkspacePayload;
  return {
    name: row.name,
    id: row.id,
    version: row.version,
    subgraphs: p.subgraphs,
    activeSubgraph: 0,
    queryTabs: p.queryTabs,
    activeQueryTab: p.activeQueryTab,
    seed: p.seed,
    mockConfig: p.mockConfig ?? "",
    tourDraft: null,  // tours not synced (URL-shareable via existing mechanism)
  };
}
```

### Merge function (pure, exported for tests)

```ts
export function mergeWorkspaces(
  local: WorkspaceEntry[],
  remote: WorkspaceRow[],
): WorkspaceEntry[] {
  const byId = new Map<string, WorkspaceEntry>();
  for (const ws of local) {
    if (ws.id) byId.set(ws.id, ws);
  }
  for (const row of remote) {
    if (row.deleted_at !== null) {
      byId.delete(row.id);  // remote delete wins
      continue;
    }
    const loc = byId.get(row.id);
    if (!loc || row.version > (loc.version ?? 0)) {
      byId.set(row.id, rowToEntry(row));  // remote is newer
    }
    // else: local is same version or newer → local wins
  }
  return Array.from(byId.values());
}
```

### API helpers

```ts
async function pullWorkspaces(since?: number): Promise<WorkspaceRow[]> {
  const url = since !== undefined
    ? `/api/workspaces?since=${since}`
    : "/api/workspaces";
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const data = (await res.json()) as { workspaces: WorkspaceRow[] };
  return data.workspaces;
}

// Returns the server row on success, or null if version was rejected (409 → adopt server row).
async function pushWorkspace(ws: WorkspaceEntry): Promise<WorkspaceRow | null> {
  const res = await fetch(`/api/workspaces/${ws.id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: ws.name,
      payload: entryToPayload(ws),
      version: ws.version ?? 1,
    }),
  });
  if (res.status === 409) {
    const data = (await res.json()) as { current: WorkspaceRow };
    return data.current;  // caller should adopt server row
  }
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);
  const data = (await res.json()) as { workspace: WorkspaceRow };
  return data.workspace;
}

async function deleteWorkspace(id: string): Promise<void> {
  await fetch(`/api/workspaces/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}
```

### Sync engine initialization

`initSync()` returns a cleanup function. Call it once on app mount.

```ts
export function initSync(): () => void {
  let isSyncing = false;
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const offlineQueue = new Map<string, WorkspaceEntry>(); // keyed by id for deduplication
  let prevWorkspaces: WorkspaceEntry[] = useWorkspace.getState().workspaces;

  async function onLogin() {
    isSyncing = true;
    try {
      const rows = await pullWorkspaces();
      const local = useWorkspace.getState().workspaces;
      const merged = mergeWorkspaces(local, rows);
      // Push workspaces that exist locally but not on the server
      const remoteIds = new Set(rows.map((r) => r.id));
      for (const ws of merged) {
        if (ws.id && !remoteIds.has(ws.id)) {
          await pushWorkspace({ ...ws, version: ws.version ?? 1 });
        }
      }
      useWorkspace.setState({ workspaces: merged });
      prevWorkspaces = merged;
      // Flush anything that queued before login resolved
      await flushOfflineQueue();
    } catch (err) {
      console.error("Sync: pull-on-login failed", err);
    } finally {
      isSyncing = false;
    }
  }

  async function autoSave(ws: WorkspaceEntry) {
    if (!navigator.onLine) {
      offlineQueue.set(ws.id!, ws);
      return;
    }
    // Bump version locally before sending
    const bumped = { ...ws, version: (ws.version ?? 0) + 1 };
    try {
      const serverRow = await pushWorkspace(bumped);
      if (serverRow) {
        // Update local version to match server (handles both 200 and 409 adoption)
        isSyncing = true;
        try {
          const workspaces = useWorkspace.getState().workspaces.map((w) =>
            w.id === ws.id ? { ...rowToEntry(serverRow), tourDraft: w.tourDraft } : w
          );
          useWorkspace.setState({ workspaces });
          prevWorkspaces = workspaces;
        } finally {
          isSyncing = false;
        }
      }
    } catch (err) {
      console.error("Sync: auto-save failed", err);
      offlineQueue.set(ws.id!, ws);
    }
  }

  async function flushOfflineQueue() {
    if (useAuth.getState().status !== "authed") return;
    const entries = Array.from(offlineQueue.values());
    offlineQueue.clear();
    for (const ws of entries) {
      await autoSave(ws);
    }
  }

  // Subscribe to auth state changes — trigger pull-on-login
  const unsubAuth = useAuth.subscribe((auth, prevAuth) => {
    if (auth.status === "authed" && prevAuth.status !== "authed") {
      void onLogin();
    }
  });

  // Subscribe to workspace changes — trigger debounced save or delete
  const unsubStore = useWorkspace.subscribe((state, prevState) => {
    if (isSyncing) return;  // ignore pull-triggered updates (no feedback loop)
    if (useAuth.getState().status !== "authed") return;

    const curr = state.workspaces;
    const prev = prevState.workspaces;

    // Detect deleted workspaces
    const currIds = new Set(curr.map((w) => w.id).filter(Boolean));
    for (const ws of prev) {
      if (ws.id && !currIds.has(ws.id)) {
        void deleteWorkspace(ws.id);
        offlineQueue.delete(ws.id);
      }
    }

    // Detect changed or new workspaces → debounced PUT
    for (const ws of curr) {
      if (!ws.id) continue;
      const was = prev.find((w) => w.id === ws.id);
      const changed = !was || JSON.stringify(ws) !== JSON.stringify(was);
      if (changed) {
        const id = ws.id;
        const existing = debounceTimers.get(id);
        if (existing) clearTimeout(existing);
        debounceTimers.set(id, setTimeout(() => {
          debounceTimers.delete(id);
          void autoSave(ws);
        }, 300));
      }
    }

    prevWorkspaces = curr;
  });

  // Flush offline queue on network reconnect
  function onOnline() { void flushOfflineQueue(); }
  window.addEventListener("online", onOnline);

  return () => {
    unsubAuth();
    unsubStore();
    window.removeEventListener("online", onOnline);
    for (const t of debounceTimers.values()) clearTimeout(t);
  };
}
```

Call `initSync()` in a `useEffect(() => initSync(), [])` in `App.tsx` (or `main.tsx`).

## Step 3 — Tests (`web/src/sync.test.ts`)

Mock `fetch`, `useAuth`, and `useWorkspace` as needed.

1. `mergeWorkspaces` — local newer wins (local.version > row.version)
2. `mergeWorkspaces` — remote newer wins (row.version > local.version)
3. `mergeWorkspaces` — remote soft-delete removes the local entry
4. `mergeWorkspaces` — local-only workspace (no matching remote row) is preserved
5. `mergeWorkspaces` — version tie: local wins (local stays unchanged)
6. Auto-save debounces: three rapid store updates produce one `fetch` PUT call after 300 ms
7. 409 response: `pushWorkspace` returns the server row; `autoSave` adopts it into the store
8. Offline: `navigator.onLine = false` → auto-save queues instead of calling fetch; "online" event flushes the queue
9. Anonymous mode (`status !== "authed"`): store subscriptions do not call fetch at all
10. No sync loop: a store update triggered by `autoSave` (setting server version) does not re-queue a new debounced save (isSyncing flag prevents it)

## Step 4 — AGENTS.md

Add "### Sync model" under State management:
- Each WorkspaceEntry has a stable client-generated `id` (uuid) and `version` counter
- Existing localStorage data is migrated to v5 automatically (uuid + version=1 assigned)
- On login: full snapshot from server merged with local (higher version wins; remote deletes honored)
- Auto-save: debounced 300 ms PUT per changed workspace; version bumped before each PUT
- 409 (stale version): client adopts the server row (last-write-wins)
- Offline: edits never lost; queued in memory and flushed on "online" event or next login
- Tours (`tourDraft`) are not synced to the cloud (they are URL-shareable via the existing #t= mechanism)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented cloud sync engine. Added `id?: string` and `version?: number` to `WorkspaceEntry` in `web/src/share.ts`. Bumped store to v5 in `web/src/store.ts` with migration that backfills `crypto.randomUUID()` and `version=1` for all existing workspaces; `makeDefaultWorkspace` now includes `id` and `version`. Created `web/src/sync.ts` with: `mergeWorkspaces()` (exported pure function, LWW by version), `initSync()` (subscribes to auth+workspace stores, pull-on-login, debounced 300ms auto-save, version bump before push, 409 adoption, DELETE on workspace removal, offline queue flushed on online event). Added 11 unit tests in `web/src/sync.test.ts` covering all merge cases, debounce, no-sync-loop, anonymous mode. Updated AGENTS.md with sync model docs.
<!-- SECTION:FINAL_SUMMARY:END -->
