---
id: TASK-126.4
title: 'web: Saved Workspaces menu — open, rename, delete'
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-06 22:21'
updated_date: '2026-08-08 01:55'
labels:
  - feature
  - workspaces
  - frontend
  - planned
dependencies:
  - TASK-126.2
parent_task_id: TASK-126
priority: medium
type: feature
ordinal: 162000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Part of TASK-126 (Saved workspaces). Depends on TASK-126.2 (sync engine support for saved/open state). Can be built in parallel with TASK-126.3 — both depend on TASK-126.2, not on each other.

Add a **Saved Workspaces** menu (e.g. from the existing workspace header menu in `web/src/App.tsx`) available only to logged-in users, that lists every workspace the user has marked Saved — whether or not it's currently open as a tab, including ones closed on another device. From this menu the user can:

- **Open** a closed saved workspace, adding it to the tab bar (via TASK-126.2's open action). If it's already open, switch to its existing tab instead of opening a duplicate.
- **Rename** a saved workspace (reuse the existing rename capability from `web/src/EditableTab.tsx` / `renameWorkspace` in `web/src/store.ts`).
- **Permanently delete** a saved workspace — this is destructive and, unlike closing, removes it from Saved Workspaces (and the tab bar, if open) for good, so it should require confirmation.

Relevant existing code: `web/src/App.tsx` (existing header menu patterns, e.g. the workspace/share menus), `web/src/store.ts` (`renameWorkspace`), `web/src/sync.ts` (source of the saved-workspace list from TASK-126.2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The menu lists all of the logged-in user's saved workspaces, including ones not currently open in the tab bar
- [x] #2 Selecting a closed saved workspace from the menu opens it as a tab
- [x] #3 Selecting an already-open saved workspace from the menu switches to its existing tab instead of opening a duplicate
- [x] #4 The user can rename a saved workspace from the menu
- [x] #5 The user can permanently delete a saved workspace from the menu, with a confirmation step since this is destructive and unlike closing removes it for good
- [x] #6 The menu is only available to logged-in users; anonymous users don't see it
- [x] #7 Tests cover list rendering, open/restore, rename, and delete from the menu
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Both dependencies are done and already built almost every primitive this
ticket needs: TASK-126.2 gave `useSavedWorkspaceLibrary` (closed-saved
workspaces) plus `openSavedWorkspace(id)` (switches to an already-open tab
or reopens a closed one — literally ACs #2/#3), and TASK-126.3 gave
`setWorkspaceSaved`/the `.tab__save` star and proved the pattern for
extending `EditableTab`. This ticket only needs two new sync-engine
primitives (rename/delete a saved workspace regardless of open/closed
state) plus one new UI component that lists the union of both partitions
and reuses `EditableTab` for each row — its existing rename-on-dblclick and
`×` affordances, repurposing `×` to mean "permanently delete" here instead
of "close tab".

### 1. `web/src/sync.ts` — two new exported actions + a small refactor

**Refactor first (no behavior change):** `requestDelete` (the
offline-queue-aware DELETE wrapper) and the `offlineDeleteQueue` Set it
uses are currently private to `initSync()`'s closure, so nothing outside it
can issue a queued/retried delete. Move both to module scope, mirroring how
`offlineQueue`/`pushEntry` already sit at module scope for the same reason:
- Move `const offlineDeleteQueue = new Set<string>();` (currently declared
  inside `initSync`, next to `debounceTimers`) up next to the existing
  `const offlineQueue = new Map<string, WorkspaceEntry>();` (~line 296).
- Move `async function requestDelete(id: string): Promise<void> { ... }`
  (currently defined inside `initSync`, ~line 550) to module scope, placed
  right after `pushEntry` — both become the shared "network + offline-queue"
  tail other actions call into. Its callers inside `initSync` (the
  `unsubStore` deleted-workspace loop, `flushOfflineQueue`) need no changes
  — they already reference `requestDelete`/`offlineDeleteQueue` by name and
  now just resolve to the module-level versions via normal closure/scope
  rules.

**New actions**, added right after `closeSavedWorkspace` (rename that
section's header comment from "Saved-workspace open/close actions
(TASK-126.2)" to "...open/close/rename/delete actions (TASK-126.2,
TASK-126.4)"):

```ts
/**
 * Renames a saved workspace by id, whether it's currently open (in the tab
 * bar) or closed (in the saved library) — the Saved Workspaces menu doesn't
 * know or care which. An open workspace is renamed through the store's own
 * renameWorkspace action so the edit flows through the same generic
 * change-detection/autosave path every other tab-strip edit uses (no
 * explicit push here — mirrors setWorkspaceSaved from TASK-126.3). A closed
 * library entry isn't watched by that subscriber, so it's renamed in place
 * and pushed explicitly, the same shape as openSavedWorkspace/
 * closeSavedWorkspace above.
 */
export function renameSavedWorkspace(id: string, name: string): void {
  const openIndex = useWorkspace.getState().workspaces.findIndex((w) => w.id === id);
  if (openIndex !== -1) {
    useWorkspace.getState().renameWorkspace(openIndex, name);
    return;
  }
  const entry = useSavedWorkspaceLibrary.getState().entries.find((w) => w.id === id);
  if (!entry) {
    console.error(`Sync: renameSavedWorkspace(${id}) — not found`);
    return;
  }
  const renamed: WorkspaceEntry = { ...entry, name, version: (entry.version ?? 0) + 1 };
  useSavedWorkspaceLibrary.setState({
    entries: useSavedWorkspaceLibrary.getState().entries.map((w) => (w.id === id ? renamed : w)),
  });
  void pushEntry(renamed);
}

/**
 * Permanently deletes a saved workspace by id, whether open or closed —
 * unlike closeSavedWorkspace, this removes it for good and issues a
 * server-side delete. An open workspace reuses the store's plain
 * removeWorkspace with NO isSyncing guard (unlike closeSavedWorkspace) so
 * unsubStore's existing change-detection treats the missing id exactly like
 * closing a non-saved workspace's tab — same DELETE request, same
 * offline-queue/retry behavior, zero new delete logic. A closed library
 * entry has no such subscriber watching it, so it's removed from the
 * library here and the delete requested directly via the now-module-level
 * requestDelete.
 */
export function deleteSavedWorkspace(id: string): void {
  const openIndex = useWorkspace.getState().workspaces.findIndex((w) => w.id === id);
  if (openIndex !== -1) {
    useWorkspace.getState().removeWorkspace(openIndex);
    return;
  }
  const entry = useSavedWorkspaceLibrary.getState().entries.find((w) => w.id === id);
  if (!entry) {
    console.error(`Sync: deleteSavedWorkspace(${id}) — not found`);
    return;
  }
  useSavedWorkspaceLibrary.setState({
    entries: useSavedWorkspaceLibrary.getState().entries.filter((w) => w.id !== id),
  });
  void requestDelete(id);
}
```

Neither new action's closed-library branch needs an `isSyncing` guard —
`useSavedWorkspaceLibrary` has no subscriber watching it (only
`useWorkspace` does), so wrapping it would protect against nothing. Leave
it out; don't copy the guard reflexively from openSavedWorkspace/
closeSavedWorkspace just because they use one for their `useWorkspace` half.

### 2. `web/src/SavedWorkspacesMenu.tsx` (new file)

Self-contained: reads both stores itself, calls the sync actions directly
— App.tsx passes it nothing but a callback to close the dropdown after
"Open", so it needs no `entries`/`activeId` props threaded down.

```tsx
import { useWorkspace, activeWorkspace } from "./store";
import { useSavedWorkspaceLibrary, openSavedWorkspace, renameSavedWorkspace, deleteSavedWorkspace } from "./sync";
import { EditableTab } from "./EditableTab";
import type { WorkspaceEntry } from "./share";

type SavedEntry = WorkspaceEntry & { id: string };

export interface SavedWorkspacesMenuProps {
  /** Called after the user picks a workspace to open/switch to, so the
   *  caller can close the dropdown — mirrors how every other action in the
   *  Workspace/Share header menus closes itself on click. */
  onOpened: () => void;
}

/**
 * Panel content for the "Saved Workspaces" header menu (TASK-126.4): lists
 * every workspace the logged-in user has marked Saved, whether it's
 * currently open as a tab or closed. Each row reuses EditableTab — the same
 * rename-on-dblclick affordance the tab strip itself uses — with its "x"
 * repurposed here to mean permanent delete (behind a confirmation, since
 * unlike closing a tab this can't be undone).
 */
export function SavedWorkspacesMenu({ onOpened }: SavedWorkspacesMenuProps) {
  const workspaces = useWorkspace((s) => s.workspaces);
  const activeId = useWorkspace((s) => activeWorkspace(s).id ?? null);
  const closedEntries = useSavedWorkspaceLibrary((s) => s.entries);

  // Open-tab entries and the closed library are two disjoint partitions of
  // the same logical set (see sync.ts's mergeWorkspaces/mergeSavedLibrary),
  // so a plain concatenation can't double-list one workspace. The `.saved`
  // filter on `workspaces` is what actually excludes non-saved open tabs;
  // it's redundant-but-defensive on `closedEntries`, which is only ever
  // populated with saved+closed rows by construction. Sorted by name for a
  // stable order independent of tab position or pull order.
  const entries: SavedEntry[] = [...workspaces, ...closedEntries]
    .filter((w): w is SavedEntry => !!w.saved && !!w.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    return <p className="saved-workspaces-menu__empty">No saved workspaces yet.</p>;
  }

  return (
    <div className="saved-workspaces-menu">
      {entries.map((ws) => (
        <EditableTab
          key={ws.id}
          name={ws.name}
          active={ws.id === activeId}
          onSelect={() => {
            openSavedWorkspace(ws.id);
            onOpened();
          }}
          onRename={(name) => renameSavedWorkspace(ws.id, name)}
          onRemove={() => {
            if (window.confirm(`Permanently delete "${ws.name}"? This can't be undone.`)) {
              deleteSavedWorkspace(ws.id);
            }
          }}
          testId={`saved-workspace-${ws.id}`}
          removeAriaLabel={`Delete ${ws.name}`}
          removeTestId={`saved-workspace-delete-${ws.id}`}
        />
      ))}
    </div>
  );
}
```

`canRename` is left at `EditableTab`'s default (`true`) — unlike the tab
strip (which restricts rename to the active tab only, `canRename={i ===
activeWorkspaceIndex}`), every row here should be renameable regardless of
open/active state, per AC #4. No `saved`/`onToggleSaved` props are passed,
so no star renders (TASK-126.3's toggle is out of scope here).

### 3. `web/src/App.tsx` wiring

- Import the new component: `import { SavedWorkspacesMenu } from "./SavedWorkspacesMenu";`.
  No change to the existing `import { initSync, closeSavedWorkspace } from
  "./sync";` line — App.tsx doesn't need the new sync actions directly,
  `SavedWorkspacesMenu` calls them itself.
- Widen the mutual-exclusivity type (~line 335):
  `useState<"workspace" | "share" | "saved" | null>(null)`.
- Add a new `HeaderMenu`, gated on `authStatus === "authed"` (already
  destructured at ~line 392), placed in `.page-header__actions` right after
  the existing "Workspace" `HeaderMenu` and before "Share" (~line 1429-1430):

```tsx
{authStatus === "authed" && (
  <HeaderMenu
    label="Saved Workspaces"
    testId="header-menu-saved"
    open={openHeaderMenu === "saved"}
    onToggle={() => setOpenHeaderMenu((m) => (m === "saved" ? null : "saved"))}
    onClose={() => setOpenHeaderMenu((m) => (m === "saved" ? null : m))}
  >
    <SavedWorkspacesMenu onOpened={() => setOpenHeaderMenu(null)} />
  </HeaderMenu>
)}
```

  `globalHeader` (which contains this) is already shared verbatim between
  the desktop and mobile layouts and already has correct stacking/z-index
  for dropdowns on both (see the recent "Fix mobile dropdown menus
  rendering behind subgraph tabs" fix) — no separate mobile-specific work
  needed.

### 4. `web/src/theme.css` — style the panel + reused `.tab` rows

Add near the existing `.header-menu` block (~line 756, just before "Brand
logo"):

```css
/* Saved Workspaces menu (TASK-126.4): reuses .tab's rename/delete
 * affordances (EditableTab) stacked full-width inside the dropdown instead
 * of the horizontal tab strip; "x" is repurposed here to mean delete. */
.saved-workspaces-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 220px;
  max-height: 320px;
  overflow-y: auto;
}
.saved-workspaces-menu .tab {
  width: 100%;
  justify-content: space-between;
}
.saved-workspaces-menu__empty {
  margin: 4px 8px;
  color: var(--text-faint);
  font-size: 12px;
  font-style: italic;
}
```

### 5. `AGENTS.md` — extend the "Sync model" section

In the existing "Saved-workspace library (TASK-126.2)" paragraph (~line
633-649), add a sentence after the `openSavedWorkspace`/`closeSavedWorkspace`
description noting `renameSavedWorkspace(id, name)` and
`deleteSavedWorkspace(id)` (TASK-126.4) round out the set — same
open-vs-closed dispatch, and that the closed-only delete path now shares
`requestDelete`'s offline queue/retry (previously private to `initSync`) by
being promoted to module scope. Keep the "this layer has no UI of its own"
statement about `sync.ts` — it's still accurate; the UI lives in
`SavedWorkspacesMenu.tsx`/`App.tsx`.

### 6. Tests

**`web/src/sync.test.ts`** — two new `describe` blocks modeled directly on
the existing `openSavedWorkspace`/`closeSavedWorkspace` blocks (same
`makeEntry`/`makeRow`/`resetStores` helpers, `vi.useFakeTimers()`):

`describe("renameSavedWorkspace", ...)`:
- Renaming an open+saved workspace updates `useWorkspace`'s entry name and
  (after advancing fake timers) issues a debounced PUT with the new
  (encrypted-mocked) name — reuses the store's own debounce path, so assert
  via the generic autosave PUT, not a direct push.
- Renaming a closed library entry updates `useSavedWorkspaceLibrary`'s
  entry name directly and issues an immediate PUT (no debounce, matching
  openSavedWorkspace/closeSavedWorkspace's synchronous `pushEntry` call).
- No-ops (and logs via `console.error`) when `id` matches neither store —
  mirrors closeSavedWorkspace's "not found" test.

`describe("deleteSavedWorkspace", ...)`:
- Deleting an open+saved workspace: run with `initSync()` active (same
  requirement as the "non-saved workspace close still soft-deletes" test —
  the open branch depends on `unsubStore`'s change-detection to fire the
  DELETE); assert it's gone from `useWorkspace.workspaces` and a `DELETE
  /api/workspaces/:id` call fires.
- Deleting a closed library entry: assert it's gone from
  `useSavedWorkspaceLibrary.entries` and a `DELETE` call fires directly
  (no `initSync()` subscriber needed for this branch — pin this by NOT
  calling `initSync()` in this case and still asserting the DELETE fires,
  proving the closed path doesn't depend on the store subscriber).
- Offline: deleting a closed entry while offline queues via
  `offlineDeleteQueue` and flushes on the `online` event — reuses the
  pattern from the existing "initSync offline queue" describe block's AC #2
  test, confirming the module-scope refactor didn't lose offline-retry
  behavior for this new caller.
- No-ops (and logs) when `id` matches neither store.

**`web/src/App.test.tsx`** — new `describe("Saved Workspaces menu
(TASK-126.4)", ...)` block, modeled on the "saved workspace toggle & close
(TASK-126.3)" block immediately above it in the file (same two-workspace
`beforeEach` shape, `useSavedWorkspaceLibrary.setState({ entries: [] })`
reset). Cases:
- Anonymous user: `screen.queryByTestId("header-menu-saved")` is null (AC #6).
- Authed, lists both open-saved and closed-saved workspaces, excludes a
  non-saved open workspace (AC #1): mark ws-1 `saved: true`, leave ws-2
  unsaved, seed `useSavedWorkspaceLibrary` with a third closed+saved entry;
  click `header-menu-saved` to open the panel; assert
  `saved-workspace-ws-1` and `saved-workspace-<closed-id>` are present and
  `saved-workspace-ws-2` is absent.
- Opening a closed saved workspace adds it to the tab bar and closes the
  menu (AC #2): click its row; assert `useWorkspace.getState().workspaces`
  now contains it, and the panel's contents (e.g.
  `saved-workspace-<closed-id>`) are gone (menu closed via `onOpened`).
- Clicking an already-open saved workspace switches to it without
  duplicating and without any fetch call (AC #3): two open+saved
  workspaces, ws-1 active; click ws-2's row; assert
  `activeWorkspaceIndex` now points at ws-2, `workspaces.length` unchanged,
  fetch spy not called.
- Renaming from the menu (AC #4), both branches: double-click an open
  entry's name, retype, Enter — assert `useWorkspace` reflects the new
  name; separately, do the same for a closed entry — assert
  `useSavedWorkspaceLibrary` reflects the new name.
- Deleting from the menu requires confirmation (AC #5): `vi.spyOn(window,
  "confirm")` — mocked `false` first, click a row's delete (×), assert the
  workspace is still present (cancel path); then mocked `true`, click
  delete again, assert it's gone from the appropriate store and a `DELETE`
  fetch call fires. Cover once for an open entry and once for a closed
  entry, mirroring the sync.test.ts split.

## Verification

- `cd web && pnpm test run src/sync.test.ts src/App.test.tsx` — new and
  existing tests green (full suite: `pnpm test run`).
- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm lint` — clean.
- Manual check via the `run` skill: log in, save two workspaces (star
  toggle from TASK-126.3), close one (moves to the saved library per
  TASK-126.2) leaving the other open; open the new "Saved Workspaces" menu
  and confirm both are listed; click the closed one — it reopens as a tab
  and the menu closes; click the still-open one again from the menu —
  switches to its existing tab, no duplicate; double-click a row's name to
  rename it (try both an open and a closed entry); delete a saved
  workspace from the menu, confirm the browser confirm() prompt appears,
  cancel it (nothing happens), then confirm it (workspace disappears from
  both the menu and, if it was open, the tab bar; not recoverable). Confirm
  an anonymous session shows no "Saved Workspaces" button at all, and check
  the menu on a narrow (mobile) viewport for the dropdown stacking-order
  fix to still hold.

## Notes / non-goals

- No backend changes — TASK-126.1's `saved`/`open` fields and TASK-126.2's
  merge/push plumbing already cover everything this ticket needs.
- No changes to the `.tab__save` star toggle (TASK-126.3) — this menu does
  not expose an "unsave" action; only open, rename, and permanent delete,
  per this ticket's ACs.
- `deleteSavedWorkspace`'s open-tab branch relies on `initSync()` already
  being mounted (it is, unconditionally, via `App.tsx`'s
  `useEffect(() => initSync(), [])`) — same pre-existing dependency the
  ordinary non-saved-workspace delete path already has today.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented exactly per the recorded plan, with no deviations. sync.ts: promoted offlineDeleteQueue/requestDelete from initSync()'s closure to module scope (pure refactor, no behavior change — verified by the full existing suite staying green), and added renameSavedWorkspace(id, name)/deleteSavedWorkspace(id), each dispatching on whether id is currently open (tab bar) or closed (library). New web/src/SavedWorkspacesMenu.tsx renders the union of both partitions via EditableTab rows, repurposing its rename/× affordances for rename/permanent-delete with a window.confirm() gate on delete. Wired into App.tsx as a new 'Saved Workspaces' HeaderMenu gated on authStatus === 'authed', placed between the Workspace and Share menus. Added .saved-workspaces-menu CSS and extended AGENTS.md's Sync model section. Added two new sync.test.ts describe blocks (renameSavedWorkspace, deleteSavedWorkspace — including an offline-queue regression test proving the module-scope refactor preserved retry behavior) and one new App.test.tsx describe block covering all 7 ACs end-to-end.

Verification: pnpm test run src/sync.test.ts src/App.test.tsx (132/132 passed), full suite pnpm test run (491/491 passed), pnpm exec tsc -b --noEmit (clean), pnpm lint (clean — only 2 pre-existing unrelated warnings in useGraphQLPipeline.ts), pnpm exec prettier --check/--write (applied to new/changed files), and a production pnpm exec vite build (succeeded). Did not run the manual browser walkthrough (no interactive browser session in this run); the automated coverage above exercises every code path the manual script would (list rendering, open/switch, rename both branches, delete both branches with cancel/confirm, anonymous gating).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a "Saved Workspaces" header menu, visible only to logged-in users, that lists every workspace the user has marked Saved regardless of whether it's currently an open tab or sitting closed in the saved-workspace library. From the menu, the user can open a closed saved workspace (or switch to it if already open, never duplicating), rename it, or permanently delete it behind a confirm() prompt.

Two new sync-engine primitives, renameSavedWorkspace(id, name) and deleteSavedWorkspace(id) in web/src/sync.ts, dispatch on whether the workspace is currently open or closed and reuse the existing autosave/push/delete machinery — no new network logic. This required promoting requestDelete/offlineDeleteQueue from initSync()'s private closure to module scope so callers outside initSync can issue a queued/retried delete; this refactor is behavior-preserving and covered by the existing offline-queue tests staying green plus a new offline-delete regression test for the closed-library path. The new web/src/SavedWorkspacesMenu.tsx component reuses EditableTab (same rename-on-dblclick and × affordances as the tab strip) for each row. App.tsx wiring and theme.css styling follow the existing Workspace/Share header-menu patterns exactly.

All 7 acceptance criteria verified with automated tests (new describe blocks in sync.test.ts and App.test.tsx); full suite (491 tests), tsc, lint, and a production build all pass clean.
<!-- SECTION:FINAL_SUMMARY:END -->
