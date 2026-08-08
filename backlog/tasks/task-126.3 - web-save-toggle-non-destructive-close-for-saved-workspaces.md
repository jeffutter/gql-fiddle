---
id: TASK-126.3
title: 'web: save toggle & non-destructive close for saved workspaces'
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-06 22:21'
updated_date: '2026-08-08 01:37'
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
ordinal: 161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Part of TASK-126 (Saved workspaces). Depends on TASK-126.2 (sync engine support for saved/open state).

Add a way for a logged-in user to mark or unmark the currently-open workspace as **Saved** (e.g. from the tab itself or the workspace header menu), with a visible indicator on saved tabs. Update the close-tab action (`removeWorkspace` in `web/src/store.ts`, wired up in `web/src/App.tsx`) so that:

- Closing a tab for a **saved** workspace only removes it from the tab bar (via the open/closed state from TASK-126.2) — the workspace is not deleted.
- Closing a tab for a workspace that is **not saved** keeps today's behavior exactly: immediate, permanent deletion, including any existing confirmation UX for that path.

This task is scoped to the tab/toggle/close interaction only. Browsing and reopening saved-but-closed workspaces is TASK-126.4.

Relevant existing code: `web/src/store.ts` (`removeWorkspace`, `renameWorkspace`), `web/src/EditableTab.tsx` (tab rendering), `web/src/App.tsx` (tab strip wiring, `onRemove`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A logged-in user can mark any open workspace as Saved and unmark it, with the state visibly reflected on the tab
- [x] #2 Closing a tab for a saved workspace removes the tab but does not delete the underlying workspace
- [x] #3 Closing a tab for a non-saved workspace deletes it immediately, matching current behavior with no regressions
- [x] #4 Anonymous (not logged-in) users don't see the Saved toggle, since the feature only applies to logged-in users
- [x] #5 Tests cover both close paths (saved vs. non-saved) at the store and/or component level
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

TASK-126.2 already built the sync-engine primitives this ticket wires up:
`WorkspaceEntry.saved`/`open` fields (`web/src/share.ts`), the
`useSavedWorkspaceLibrary` store, and the exported `openSavedWorkspace`/
`closeSavedWorkspace` actions in `web/src/sync.ts` — `closeSavedWorkspace(id)`
already removes a saved workspace from the tab bar, moves it into the saved
library, and pushes `open: false` to the server without touching the
existing DELETE path. This ticket only needs to: (1) add a way to flip
`saved` on a workspace, and (2) route the tab's close button to
`closeSavedWorkspace` instead of `removeWorkspace` when the workspace is
saved. No new sync-engine work is needed — the existing generic
`unsubStore` change-detection in `sync.ts` (any changed workspace field gets
a debounced PUT) already covers the `saved` toggle for free once it's
written to `useWorkspace.workspaces` through a normal store mutation.

There is currently no confirmation dialog on tab close at all (verified: no
`window.confirm` anywhere near `removeWorkspace`/`EditableTab`) — so "no
regressions" for the non-saved path just means `onRemove` keeps calling
`removeWorkspace(i)` exactly as today.

### 1. `web/src/store.ts` — `setWorkspaceSaved` action

Add to `WorkspaceState` (interface, in the "Workspace CRUD" group near
`renameWorkspace`, ~line 188):

```ts
/** Mark or unmark the workspace at `index` as Saved (persists past tab close for logged-in users). */
setWorkspaceSaved: (index: number, saved: boolean) => void;
```

Implementation, right after `renameWorkspace` (~line 398), mirroring its
exact shape:

```ts
setWorkspaceSaved: (index, saved) =>
  set((state) => ({
    workspaces: state.workspaces.map((ws, i) => (i === index ? { ...ws, saved } : ws)),
  })),
```

No `partialize` change needed — `workspaces` (and therefore `saved`) is
already persisted whole. No sync.ts change needed either: `initSync`'s
`unsubStore` subscriber already diffs `JSON.stringify(ws)` per workspace on
every `useWorkspace` state change and schedules a debounced
`autoSave`/PUT for anything that changed, and `pushWorkspace` (TASK-126.2)
already sends `saved: ws.saved ?? false` unconditionally on every push.

### 2. `web/src/EditableTab.tsx` — save toggle affordance

Add optional props (extend `EditableTabProps`), all undefined by default so
the two existing call sites (subgraph tabs, query tabs) are unaffected and
render nothing new:

```ts
/** Current saved state. Only meaningful when onToggleSaved is provided. */
saved?: boolean;
/** Toggles saved state. Omit entirely to hide the save affordance (e.g.
 *  anonymous users, or tab strips that don't support saving). */
onToggleSaved?: () => void;
saveAriaLabel?: string;
saveTestId?: string;
```

Render a `☆`/`★` glyph button between the name and the close `×`
(mirrors the existing close affordance's structure — plain span,
`stopPropagation`, no SVG needed since `×` already sets that precedent):

```tsx
{onToggleSaved && (
  <span
    onClick={(e) => {
      e.stopPropagation();
      onToggleSaved();
    }}
    className={saved ? "tab__save is-saved" : "tab__save"}
    role="button"
    aria-pressed={saved}
    aria-label={saveAriaLabel}
    data-testid={saveTestId}
    title={saved ? "Saved — click to unsave" : "Click to save"}
  >
    {saved ? "★" : "☆"}
  </span>
)}
```

Place it right after the name `span`/rename `input` block and before the
`tab__close` span.

### 3. `web/src/theme.css` — style the toggle

Add near `.tab__close` (~line 320), following the same hover/active-tab
pattern already used there:

```css
/* The "★"/"☆" save toggle affordance inside a workspace tab. */
.tab__save {
  display: inline-flex;
  color: var(--text-faint);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
}
.tab__save:hover {
  color: var(--text);
}
.tab__save.is-saved {
  color: var(--accent);
}
.tab.is-active .tab__save {
  color: var(--text-muted);
}
.tab.is-active .tab__save.is-saved {
  color: var(--accent);
}
```

### 4. `web/src/App.tsx` — wire toggle + branch close behavior

- Add `closeSavedWorkspace` to the existing `import { initSync } from "./sync";` (~line 16) → `import { initSync, closeSavedWorkspace } from "./sync";`.
- Destructure `setWorkspaceSaved` alongside `renameWorkspace`/`removeWorkspace` in the top-level `useWorkspace()` call (~line 280).
- In `workspaceTabStrip`'s `.map((ws, i) => ...)` (~line 1236), update the
  `EditableTab` usage:

```tsx
<EditableTab
  key={i}
  name={ws.name}
  active={i === activeWorkspaceIndex}
  onSelect={() => setActiveWorkspace(i)}
  onRename={(newName) => renameWorkspace(i, newName)}
  onRemove={() => {
    // Saved workspaces: close the tab only (TASK-126.2's closeSavedWorkspace
    // moves it into the saved library and pushes open:false — never deletes
    // it). Non-saved: unchanged immediate delete-on-close.
    if (ws.saved && ws.id) {
      closeSavedWorkspace(ws.id);
    } else {
      removeWorkspace(i);
    }
  }}
  canRename={i === activeWorkspaceIndex}
  testId={`workspace-tab-${i}`}
  removeAriaLabel={`Remove ${ws.name}`}
  removeTestId={`workspace-remove-${i}`}
  saved={ws.saved ?? false}
  onToggleSaved={
    authStatus === "authed" && ws.id ? () => setWorkspaceSaved(i, !ws.saved) : undefined
  }
  saveAriaLabel={ws.saved ? `Unsave ${ws.name}` : `Save ${ws.name}`}
  saveTestId={`workspace-save-${i}`}
/>
```

`authStatus` is already destructured from `useAuth()` in this component
(~line 391) — this is the same flag gating the existing sync-status pill, so
it's consistent with how the rest of the file distinguishes logged-in UI.
Passing `onToggleSaved={undefined}` for anonymous users means
`EditableTab` renders no save affordance at all for them (AC #4), not just
a disabled one.

The `ws.id` guard is defensive: every real workspace has had a UUID since
the v5 localStorage migration (`store.ts`), so this only matters for a
theoretical pre-migration edge case — falls back to hiding the toggle /
using the plain delete path rather than crashing.

### 5. Tests

**`web/src/store.test.ts`** — new `describe("setWorkspaceSaved", ...)` block
near the existing `renameWorkspace`-adjacent tests, using the file's
existing `aw()`/`setWs()` helpers and two-workspace setup pattern (see
`removeSubgraph (AC #2)` block for the shape to copy):
- Toggling `true` on workspace index 0 sets `saved: true` on that entry only
  (add a second workspace first, assert it's untouched).
- Toggling `false` on an already-saved workspace clears it back to `false`.

**`web/src/App.test.tsx`** — new `describe("saved workspace toggle & close (TASK-126.3)", ...)`
block, modeled on the existing `decryptWarning` banner describe block
(~line 1953: same `beforeEach` shape — set `useWorkspace` to a two-workspace
state, `useAuth.setState({ status: "authed" })`). Scope fetch mocking to
just this block's `beforeEach`/`afterEach` (no existing App.test.tsx tests
mock `fetch` globally, so don't add one file-wide) — mirror
`sync.test.ts`'s `non-saved workspace close still soft-deletes` block
(~line 1294) for the `vi.spyOn(globalThis, "fetch")` pattern that
distinguishes `DELETE` calls from other requests, plus
`vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync(0)` since `autoSave` is
debounced.

Cases:
- Anonymous user (`useAuth.setState({ status: "anonymous" })`): no
  `workspace-save-0` test id in the DOM at all (`queryByTestId` is null) —
  proves AC #4, not just that a toggle is disabled.
- Authed, non-saved workspace: clicking `workspace-save-0` sets
  `useWorkspace.getState().workspaces[0].saved` to `true`; the element's
  `aria-pressed` flips to `"true"` and its class gains `is-saved`.
- Authed, already-saved workspace: clicking the same toggle again clears
  `saved` back to `false`.
- Closing a **saved** workspace's tab (`workspace-remove-0`): after the
  click, `useWorkspace.getState().workspaces` no longer contains that id,
  `useSavedWorkspaceLibrary.getState().entries` does contain it, and the
  spied `fetch` never receives a `DELETE` call for it (advance fake timers
  to flush the resulting PUT and assert the PUT body has `open: false`,
  confirming it went through `closeSavedWorkspace` and not the delete path).
- Closing a **non-saved** workspace's tab: unchanged — `removeWorkspace`
  path fires, `fetch` receives a `DELETE /api/workspaces/:id` call (pins the
  existing behavior at the component level, complementing the store-level
  pin already in `sync.test.ts`'s "non-saved workspace close still
  soft-deletes" test from TASK-126.2).

## Verification

- `cd web && pnpm test run src/store.test.ts src/App.test.tsx src/sync.test.ts src/EditableTab.tsx 2>/dev/null || pnpm test run` — full suite green, including the new tests above. (No `EditableTab.test.tsx` exists today; toggle behavior is covered through `App.test.tsx` per the file's existing convention of testing tab-strip components through `App`.)
- `pnpm exec tsc -b --noEmit` — clean (new props/action are fully typed).
- `pnpm lint` — clean.
- Manual check via the `run` skill: log in, open a workspace, click the save
  star (fills in, tab persists across a page reload without needing to stay
  "open"), close its tab (tab disappears, no confirm, workspace is not in
  local `useWorkspace` state, no `DELETE` in the network tab, and revisiting
  after `openSavedWorkspace` — exercised manually via devtools console since
  126.4's UI to do this from a menu doesn't exist yet — brings it back).
  Then confirm a non-saved workspace's tab still deletes immediately on
  close, unchanged, and that an anonymous session shows no star at all.

## Notes / non-goals

- No changes to `web/src/sync.ts` — `openSavedWorkspace`/`closeSavedWorkspace`/
  `useSavedWorkspaceLibrary`/the `saved`/`open` push wiring already exist
  from TASK-126.2 exactly as this ticket needs them.
- Browsing/reopening saved-but-closed workspaces (a menu listing
  `useSavedWorkspaceLibrary`'s entries plus open saved workspaces, calling
  `openSavedWorkspace`) is explicitly out of scope — TASK-126.4.
- No new confirmation dialog is introduced for either close path — none
  exists today and the ticket doesn't ask for one.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented exactly per the plan: `setWorkspaceSaved` action added to store.ts; EditableTab.tsx gained optional saved/onToggleSaved/saveAriaLabel/saveTestId props rendering a ☆/★ toggle span (hidden entirely when onToggleSaved is undefined); theme.css got a .tab__save block mirroring .tab__close; App.tsx imports closeSavedWorkspace from sync.ts, destructures setWorkspaceSaved, and branches EditableTab's onRemove between closeSavedWorkspace(ws.id) (saved) and removeWorkspace(i) (not saved), gating onToggleSaved on authStatus === "authed" && ws.id. No changes needed to sync.ts — TASK-126.2's closeSavedWorkspace/openSavedWorkspace/useSavedWorkspaceLibrary were used as-is. Added tests: store.test.ts (setWorkspaceSaved describe block, 2 tests) and App.test.tsx (new 'saved workspace toggle & close (TASK-126.3)' describe block, 4 tests covering AC #1-4 at the component level). Full suite: 478 tests passing, tsc -b --noEmit clean, eslint clean (2 pre-existing unrelated warnings in useGraphQLPipeline.ts).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a Saved toggle (☆/★) to workspace tabs for logged-in users and rewired tab-close to branch: saved workspaces close via TASK-126.2's `closeSavedWorkspace` (tab removed, workspace preserved in the saved library, `open:false` pushed to the server), while non-saved workspaces keep the existing immediate-delete behavior unchanged. New `setWorkspaceSaved` store action flips the `saved` flag; the existing generic sync-engine change-detection picks up and pushes it for free. Anonymous users see no toggle at all. Covered by new store-level and component-level tests (store.test.ts, App.test.tsx); full suite (478 tests), `tsc -b --noEmit`, and `pnpm lint` all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
