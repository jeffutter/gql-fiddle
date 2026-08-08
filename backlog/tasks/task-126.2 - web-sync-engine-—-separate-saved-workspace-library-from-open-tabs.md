---
id: TASK-126.2
title: 'web: sync engine — separate saved-workspace library from open tabs'
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-06 22:20'
updated_date: '2026-08-08 01:20'
labels:
  - feature
  - workspaces
  - sync
  - frontend
  - planned
dependencies:
  - TASK-126.1
parent_task_id: TASK-126
priority: medium
type: feature
ordinal: 160000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Part of TASK-126 (Saved workspaces). Depends on TASK-126.1 (backend saved/open fields).

Today, `mergeWorkspaces` in `web/src/sync.ts` merges every non-deleted remote workspace row into the local tab list — there is no concept of a workspace existing on the server without being an open tab everywhere. Update the sync engine so that:

- A workspace that is saved but marked **closed** (per TASK-126.1's new field) is tracked as part of the user's saved-workspace library but is **not** merged into the tab bar.
- Opening a saved workspace (an action exposed to the UI in later subtasks) sets its shared open state and adds it to the tab bar on this and every other device on next sync.
- Closing a saved workspace's tab sets its shared closed state and removes it from the tab bar everywhere, without deleting it.
- Non-saved workspace behavior is unchanged: closing still soft-deletes immediately (existing behavior), and open/closed state doesn't apply to them.

Relevant existing code: `web/src/sync.ts` (`mergeWorkspaces`, `pullWorkspaces`, the debounced auto-save/delete subscription logic), `web/src/store.ts` (`WorkspaceEntry` type, `removeWorkspace`), and the existing sync test suite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A saved workspace that is closed on one device does not reappear as an open tab the next time another logged-in device syncs
- [x] #2 Opening a saved workspace adds it to the tab bar and is reflected on the user's other devices on their next sync
- [x] #3 Closing a saved workspace's tab removes it from the tab bar everywhere without deleting the workspace
- [x] #4 Non-saved workspace close-to-delete behavior and its existing sync/test coverage is unchanged
- [x] #5 Sync engine unit tests cover: closed-saved workspaces excluded from the merged tab list, and opening a saved workspace re-adds it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Give the sync engine a second partition alongside the tab bar: a **saved
workspace library** holding closed-but-saved workspaces. Every saved
workspace lives in exactly one place at a time — `useWorkspace.workspaces`
(the tab bar) while open, or the new `useSavedWorkspaceLibrary` store while
closed — never both, so there's no drift/staleness to reconcile between two
copies of the same workspace. Non-saved workspaces are untouched: they only
ever live in the tab bar, and closing one still soft-deletes immediately.

`mergeWorkspaces` and a new sibling `mergeSavedLibrary` are the two halves of
this partition: both share one generic by-id LWW reducer
(`mergeById`), parameterized by which rows to exclude. This avoids
duplicating the version-comparison dance for what is otherwise the same
merge shape with a different filter — see step 2.

### 1. `web/src/share.ts` — extend `WorkspaceEntry`

Add two optional fields, mirroring the backend's `WorkspaceRow` (TASK-126.1):

```ts
export interface WorkspaceEntry {
  ...
  /** Marked to persist past tab close. Synced; undefined ≡ false (matches
   *  the server's default for pre-126.1 rows and brand-new local workspaces). */
  saved?: boolean;
  /** Whether this workspace currently appears as a tab, shared/synced across
   *  devices. Undefined ≡ true (matches the server default) — only ever
   *  false for a saved workspace sitting in the closed library. */
  open?: boolean;
}
```

Both stay optional (not defaulted at the type level) so `makeDefaultWorkspace`,
the v5 localStorage migration, and existing share-link encode/decode in this
same file need no changes — every read site treats `undefined` the same as
the server's documented default (`?? false` / `?? true`), exactly like `id`/
`version` are already handled today.

### 2. `web/src/sync.ts` — types, merge, and the saved-library store

**`WorkspaceRow` (client mirror):** add `saved: boolean; open: boolean;` —
matches `functions/_lib/db.ts`'s `WorkspaceRow` after TASK-126.1 (GET always
returns these as real booleans, never omitted).

**`rowToEntry`:** map `saved: row.saved, open: row.open` onto the returned
entry (alongside the existing fields).

**`entryToPayload`:** no change — `saved`/`open` are sibling row columns on
the wire (like `version`), not part of the JSON `payload` blob, exactly as
TASK-126.1 designed the PUT body.

**Generalize the merge reducer.** Replace `mergeWorkspaces`'s body with a
shared helper, then define both merges as thin configs:

```ts
function mergeById(
  local: WorkspaceEntry[],
  remote: WorkspaceRow[],
  excludeRow: (row: WorkspaceRow) => boolean,
): WorkspaceEntry[] {
  const byId = new Map<string, WorkspaceEntry>();
  for (const ws of local) {
    if (ws.id) byId.set(ws.id, ws);
  }
  for (const row of remote) {
    const loc = byId.get(row.id);
    if (row.deleted_at !== null) {
      byId.delete(row.id);
      continue;
    }
    const remoteWins = !loc || row.version > (loc.version ?? 0);
    if (excludeRow(row)) {
      // Remote says this row doesn't belong in this merge target. Only
      // remove an existing entry when the remote row actually wins the LWW
      // race — a not-yet-pushed local change (e.g. just opened/closed here)
      // must survive until it's had a chance to reach the server.
      if (remoteWins) byId.delete(row.id);
      continue;
    }
    if (remoteWins) byId.set(row.id, rowToEntry(row, loc));
    // else: local is same version or newer → local wins, keep as-is.
  }
  return Array.from(byId.values());
}

export function mergeWorkspaces(local: WorkspaceEntry[], remote: WorkspaceRow[]): WorkspaceEntry[] {
  // Tab bar: every remote row except a closed saved workspace.
  return mergeById(local, remote, (row) => row.saved && !row.open);
}

export function mergeSavedLibrary(local: WorkspaceEntry[], remote: WorkspaceRow[]): WorkspaceEntry[] {
  // Library: exactly the complement — only closed saved workspaces.
  return mergeById(local, remote, (row) => !row.saved || row.open);
}
```

Local-only entries (no matching remote row at all, e.g. not yet pushed) are
always kept by both — the caller side (`useWorkspace.workspaces` seeds the
tab-bar merge, `useSavedWorkspaceLibrary`'s own prior entries seed the
library merge) already only ever contains entries that belong there, so no
extra "should I keep this local-only entry" predicate is needed beyond what
`mergeById` already does.

Update existing `mergeWorkspaces` unit tests (none should need behavior
changes — same signature, same non-saved-workspace results) and add new
ones per step 5.

**New saved-library store**, next to `mergeWorkspaces`:

```ts
export const useSavedWorkspaceLibrary = create<{ entries: WorkspaceEntry[] }>(() => ({
  entries: [],
}));
```

Populate it in the same two places `mergeWorkspaces` already runs against a
pull's `rows` — `onLogin` and `deltaRefresh` — immediately after computing
`merged`:

```ts
const library = mergeSavedLibrary(useSavedWorkspaceLibrary.getState().entries, rows);
useSavedWorkspaceLibrary.setState({ entries: library });
```

This is intentionally *not* wrapped in `isSyncing` — nothing subscribes to
`useSavedWorkspaceLibrary`'s changes the way `unsubStore` subscribes to
`useWorkspace`, so there's no feedback loop to guard against.

**Clear the library on logout.** In the existing `unsubAuth` subscription,
add an `else if` branch alongside the login branch:

```ts
} else if (auth.status !== "authed" && prevAuth.status === "authed") {
  useSavedWorkspaceLibrary.setState({ entries: [] });
}
```

Mirrors how `logout()` in `auth.ts` already clears `decryptWarning` and the
cached encryption key — saved-workspace names/content must not leak across
an account switch on a shared device. (Doing this inside `sync.ts`'s own
subscription, rather than in `auth.ts`, avoids a circular import between the
two modules.)

**Always send `saved`/`open` on every PUT.** In `pushWorkspace`, add them to
the request body unconditionally:

```ts
body: JSON.stringify({
  name: encName,
  payload: encPayload,
  version: ws.version ?? 1,
  saved: ws.saved ?? false,
  open: ws.open ?? true,
}),
```

This client always knows the current value of both fields (populated by
`rowToEntry` on every pull, defaulted for brand-new local workspaces), so it
never needs TASK-126.1's "omit to preserve" affordance — that exists to
protect *older* clients that predate these fields, not this one. Sending a
definite value on every push is simpler than threading an "explicit
override vs. preserve" distinction through `pushWorkspace`'s callers.

**Extract `pushEntry` from `autoSave`'s tail**, so the open/close actions
(step 3) can reuse the exact same push/offline-queue/error/LWW-guard logic
instead of duplicating it a third time. Move `offlineQueue`'s declaration
from inside `initSync()` to module scope (alongside `isSyncing`) so both
`autoSave` and the new top-level functions can queue into it:

```ts
// module scope, near `isSyncing`
const offlineQueue = new Map<string, WorkspaceEntry>();

async function pushEntry(ws: WorkspaceEntry): Promise<void> {
  if (!ws.id) return;
  if (!navigator.onLine) {
    offlineQueue.set(ws.id, ws);
    useAuth.getState().setSyncStatus("offline");
    return;
  }
  useAuth.getState().setSyncStatus("saving");
  try {
    const serverRow = await pushWorkspace(ws);
    if (serverRow) {
      isSyncing = true;
      try {
        const workspaces = useWorkspace.getState().workspaces.map((w) => {
          if (w.id !== ws.id) return w;
          if (serverRow.version < (w.version ?? 0)) return w; // stale response guard, unchanged from autoSave
          return rowToEntry(serverRow, w);
        });
        useWorkspace.setState({ workspaces });
      } finally {
        isSyncing = false;
      }
    }
    useAuth.getState().setSyncStatus("synced");
  } catch (err) {
    console.error("Sync: push failed", err);
    offlineQueue.set(ws.id, useWorkspace.getState().workspaces.find((w) => w.id === ws.id) ?? ws);
    useAuth.getState().setSyncStatus(navigator.onLine ? "error" : "offline");
  }
}
```

`autoSave` keeps its version-bump-in-store preamble (unchanged — it's the
one place that must read/bump the *live* store version to avoid the
duplicate-version race the existing comment above it describes), then ends
with `await pushEntry(bumped);` instead of its current inlined tail.

`offlineDeleteQueue` and `debounceTimers` stay closure-local to `initSync()`
— only `autoSave`'s push path is shared with the new functions.

**`flushOfflineQueue`** needs one behavioral branch added: a queued entry
for a workspace that's since been *closed* (removed from
`useWorkspace.workspaces`, not deleted) has nothing fresher to re-read, so
push the queued snapshot directly instead of going through `autoSave` (whose
"deleted concurrently" guard would silently drop it, since it can no longer
distinguish "closed" from "deleted" by absence alone):

```ts
for (const ws of entries) {
  const stillOpen = useWorkspace.getState().workspaces.some((w) => w.id === ws.id);
  if (stillOpen) {
    await autoSave(ws.id!); // re-reads live content — preserves the existing "flush pushes latest, not stale snapshot" guarantee
  } else {
    await pushEntry(ws); // e.g. a closed saved workspace queued while offline — the snapshot IS the final state
  }
}
```

### 3. `web/src/sync.ts` — open/close actions

Two new exported functions, near `deltaRefresh`:

```ts
/**
 * Opens a saved workspace: adds it to the tab bar (or just focuses it if
 * it's already open there — no duplicate tabs) and marks it open so it
 * appears on the user's other devices on their next sync. No-op if `id`
 * isn't a known saved workspace.
 */
export function openSavedWorkspace(id: string): void {
  const workspaces = useWorkspace.getState().workspaces;
  const existingIndex = workspaces.findIndex((w) => w.id === id);
  if (existingIndex !== -1) {
    useWorkspace.setState({ activeWorkspaceIndex: existingIndex });
    return;
  }
  const entry = useSavedWorkspaceLibrary.getState().entries.find((w) => w.id === id);
  if (!entry) {
    console.error(`Sync: openSavedWorkspace(${id}) — not found in saved library`);
    return;
  }
  const opened: WorkspaceEntry = { ...entry, open: true, version: (entry.version ?? 0) + 1 };
  isSyncing = true;
  try {
    const next = [...workspaces, opened];
    useWorkspace.setState({ workspaces: next, activeWorkspaceIndex: next.length - 1 });
    useSavedWorkspaceLibrary.setState({
      entries: useSavedWorkspaceLibrary.getState().entries.filter((w) => w.id !== id),
    });
  } finally {
    isSyncing = false;
  }
  void pushEntry(opened);
}

/**
 * Closes a saved workspace's tab: removes it from the tab bar and marks it
 * closed so it disappears from the tab bar on the user's other devices too
 * — the workspace itself is not deleted, it moves into the saved library.
 * No-op (and logs) if `id` isn't currently an open, saved workspace — this
 * function must never be called for a non-saved workspace, whose close path
 * is the existing immediate-delete behavior in `store.ts`/`App.tsx`.
 */
export function closeSavedWorkspace(id: string): void {
  const workspaces = useWorkspace.getState().workspaces;
  const index = workspaces.findIndex((w) => w.id === id);
  const ws = workspaces[index];
  if (!ws || !ws.saved) {
    console.error(`Sync: closeSavedWorkspace(${id}) — not an open saved workspace`);
    return;
  }
  const closed: WorkspaceEntry = { ...ws, open: false, version: (ws.version ?? 0) + 1 };
  isSyncing = true;
  try {
    useWorkspace.getState().removeWorkspace(index); // reuses store.ts's tested index-clamping / empty-tab-bar fallback
    useSavedWorkspaceLibrary.setState({
      entries: [...useSavedWorkspaceLibrary.getState().entries, closed],
    });
  } finally {
    isSyncing = false;
  }
  void pushEntry(closed);
}
```

Both wrap only the *local* state mutation in `isSyncing` (matching every
other mutator in this file) so `unsubStore`'s change-detection subscriber —
which would otherwise treat the tab-bar removal in `closeSavedWorkspace` as
a delete-worthy event, soft-deleting the workspace — never fires for these
calls. The network push happens outside that guard, same as `autoSave`.

`closeSavedWorkspace` deliberately reuses `useWorkspace.getState().removeWorkspace(index)`
for the local splice rather than reimplementing index-clamping/empty-tab-bar
fallback in `sync.ts` — that logic already exists, is tested, and belongs to
`store.ts`.

A stale debounce timer for `id` from a pending unsaved edit firing after
`closeSavedWorkspace` runs is harmless: `autoSave`'s existing
"deleted concurrently" guard (`if (!ws) return;`) already no-ops when the id
is no longer present in the tab bar, whether that's because it was deleted
or, now, closed.

### 4. `AGENTS.md` — document the split

In the "Sync model" section (`### Sync model`, under "State management"):
- Note that `saved`/`open` are per-workspace synced fields (link to the
  Workspace API section TASK-126.1 already wrote).
- Add a short paragraph: a saved-and-closed workspace is tracked in
  `useSavedWorkspaceLibrary` instead of the tab bar; `mergeWorkspaces` and
  `mergeSavedLibrary` partition every pull's rows between the two stores,
  and a workspace only ever lives in one of them at a time.
- One line each for `openSavedWorkspace`/`closeSavedWorkspace`: what they do
  and that they're the mechanism 126.3/126.4's UI will call into (don't
  re-describe the UI itself — out of scope here).
- Non-saved workspace behavior: unchanged, called out explicitly so a future
  reader doesn't assume the new fields touch that path.

### 5. `web/src/sync.test.ts` — new coverage

Extend `makeRow`'s helper to accept `saved?: boolean; open?: boolean`
(default `false`/`true`, matching the server), so existing tests that don't
care about these fields keep working unchanged.

New tests:
- `mergeWorkspaces`: a remote row with `saved: true, open: false` is
  excluded from the merged tab-bar result, even when it was previously
  present locally (simulates another device closing it).
- `mergeWorkspaces`: a remote row with `saved: true, open: false` but a
  *lower* version than the local (already-newer) copy does not remove the
  local entry — the not-yet-pushed local change wins until it reaches the
  server.
- `mergeSavedLibrary`: a remote row with `saved: true, open: false` is
  included; a remote row with `saved: true, open: true` (currently open
  elsewhere) or `saved: false` is excluded.
- `mergeSavedLibrary`: remote soft-delete (`deleted_at` set) removes a
  previously-known library entry.
- `openSavedWorkspace`: given an entry in `useSavedWorkspaceLibrary`, calling
  it adds the workspace to `useWorkspace.workspaces` (open, focused) and
  removes it from the library; asserts the PUT body includes
  `open: true`.
- `openSavedWorkspace`: called with an id already present in
  `useWorkspace.workspaces` switches `activeWorkspaceIndex` to it and issues
  no PUT (no duplicate tab, AC parity with TASK-126.4's later UI need).
- `closeSavedWorkspace`: removes the workspace from `useWorkspace.workspaces`,
  adds it to `useSavedWorkspaceLibrary`, and does **not** call
  `DELETE /api/workspaces/:id` (the regression this whole ticket exists to
  prevent) while the PUT body includes `open: false`.
- `closeSavedWorkspace` called on a non-saved workspace: no-op, logs, no
  fetch calls of any kind.
- Cross-device simulation via `deltaRefresh` (mirrors this file's existing
  `deltaRefresh`-based tests): a delta pull returning a closed-saved row for
  a workspace currently open locally removes it from the tab bar and adds it
  to the library, without a network delete.
- Offline: `closeSavedWorkspace` while offline queues the closed snapshot;
  reconnect flushes a PUT with `open: false` via the new
  `flushOfflineQueue` branch (not through `autoSave`, since the workspace is
  no longer in the tab bar to re-read).
- Non-saved-workspace regression: closing (removing from the store) a
  workspace with `saved` undefined/false still triggers the existing
  `DELETE` path unchanged — pin this explicitly so a future refactor here
  can't silently change it.

## Verification

- `cd web && pnpm test` (or scoped: `pnpm test run src/sync.test.ts`) — all
  sync tests green, including the new ones.
- `pnpm exec tsc -b --noEmit` (or the project's existing typecheck step) —
  clean, given `WorkspaceEntry`/`WorkspaceRow` gained fields.
- `pnpm lint` — clean.
- Manual sanity check is deferred to TASK-126.3/126.4 once there's UI to
  drive `openSavedWorkspace`/`closeSavedWorkspace` — this ticket has no UI
  surface of its own to click through.

## Notes / non-goals

- No changes to `web/src/store.ts`'s `removeWorkspace`/`App.tsx`'s
  `onRemove` wiring — deciding *when* to call `closeSavedWorkspace` vs. the
  existing delete-on-close path is TASK-126.3's job. This ticket only builds
  the engine primitive it will call.
- No UI (toggle, menu) — TASK-126.3 and TASK-126.4.
- `useSavedWorkspaceLibrary` intentionally holds only *closed* saved
  workspaces, not all saved workspaces — an open saved workspace's live,
  freshest copy is already `useWorkspace.workspaces`; duplicating it into
  the library would immediately go stale between pulls. TASK-126.4's "list
  every saved workspace" menu is expected to combine
  `useWorkspace.workspaces.filter(w => w.saved)` with
  `useSavedWorkspaceLibrary`'s entries — worth calling out to whoever plans
  that ticket, but building that combinator hook now would be speculative
  ahead of seeing the actual component.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented exactly per the plan: `web/src/share.ts` gained optional `saved?`/`open?` on `WorkspaceEntry`. `web/src/sync.ts` gained the `saved`/`open` fields on the client `WorkspaceRow` mirror, mapped them in `rowToEntry`, generalized `mergeWorkspaces` into a shared `mergeById(local, remote, excludeRow)` reducer with `mergeWorkspaces` (excludes closed-saved rows) and a new `mergeSavedLibrary` (keeps only closed-saved rows) as thin wrappers, added the `useSavedWorkspaceLibrary` zustand store populated alongside `mergeWorkspaces` in both `onLogin` and `deltaRefresh`, cleared it on logout via a new `else if` branch in the existing `unsubAuth` subscription, always send `saved`/`open` on every `pushWorkspace` PUT, extracted `pushEntry` (module-scope, alongside a module-scope `offlineQueue`) from `autoSave`'s tail so it's shared with the new actions, added the `flushOfflineQueue` stillOpen/pushEntry branch for a queued entry whose workspace has since closed, and added the two exported actions `openSavedWorkspace`/`closeSavedWorkspace` near `deltaRefresh`. `AGENTS.md`'s Sync model section documents the split. `web/src/sync.test.ts`: extended `makeRow` with `saved?/open?` (defaulting to the server's `false`/`true`), and added 14 new tests across `mergeWorkspaces`, a new `mergeSavedLibrary` describe block, `openSavedWorkspace`, `closeSavedWorkspace` (including the offline-queue and non-saved-workspace no-op cases), a `deltaRefresh` cross-device scenario, and a pinned regression test for the unchanged non-saved close-to-delete path.

Verification: `pnpm test run` — 472/472 tests pass (web). `pnpm exec tsc -b --noEmit` — clean. `pnpm lint` — clean (only 2 pre-existing unrelated warnings in useGraphQLPipeline.ts). `pnpm exec prettier --write` applied to the three touched files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Separated the sync engine's saved-workspace library from the open tab bar per TASK-126.2's plan. `WorkspaceEntry`/the client `WorkspaceRow` mirror gained optional `saved`/`open` fields; `mergeWorkspaces` was generalized into a shared `mergeById` reducer with a new sibling `mergeSavedLibrary`, so every pulled row partitions cleanly between the tab bar and a new `useSavedWorkspaceLibrary` store (closed-saved workspaces never appear as tabs, and never live in both places at once). Two new exported actions, `openSavedWorkspace`/`closeSavedWorkspace`, move a workspace between the two stores and push the state change to the server without ever triggering the existing delete-on-close path — verified by a pinned regression test that non-saved workspaces still soft-delete immediately on close, unchanged. 14 new unit tests cover the merge partition, both actions (including the offline-queue flush path), and a cross-device `deltaRefresh` scenario. `pnpm test run` (472/472), `tsc -b --noEmit`, and `pnpm lint` are all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
