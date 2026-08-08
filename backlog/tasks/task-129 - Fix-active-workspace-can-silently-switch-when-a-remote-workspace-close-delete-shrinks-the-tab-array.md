---
id: TASK-129
title: >-
  Fix: active workspace can silently switch when a remote workspace close/delete
  shrinks the tab array
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-08 01:25'
updated_date: '2026-08-08 04:26'
labels:
  - review-fix
  - planned
dependencies: []
ordinal: 167000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In web/src/sync.ts, both deltaRefresh() and initSync()'s onLogin() clamp
activeWorkspaceIndex purely by position after a merge:

  const safeIdx = Math.min(currIdx, safeMerged.length - 1);

This does not preserve *identity* — it only prevents an out-of-bounds index.
If a workspace at an index earlier than (or equal to) the current active
index disappears from the array during a pull, activeWorkspaceIndex ends up
pointing at a different workspace than the one the user was looking at,
and App.tsx renders workspaces[activeWorkspaceIndex] directly — so the
editor content silently swaps to a different workspace's data with no user
action and no warning.

This code path predates TASK-126, but TASK-126.2's mergeWorkspaces() now
excludes any row that's `saved && !open` from the tab bar on every pull —
meaning routine cross-device actions (closing a saved workspace on another
device) now regularly shrink/reorder the local tab array, not just rare
full deletions. This makes an existing edge case into a routine one, right
as the saved-workspace feature (TASK-126.3/126.4) is about to add UI on
top of it.

Suggested fix: track the active workspace by id (or resolve
activeWorkspaceIndex from the previously-active id after merging) in the
deltaRefresh/onLogin merge paths, falling back to index clamping only when
the previously active workspace is genuinely gone (deleted).

Repro (conceptual, add as a sync.test.ts case): two tabs open locally,
device B closes the workspace at index 0 (saved workspace, another
device), device A's next deltaRefresh() pulls that row and its
activeWorkspaceIndex silently ends up referencing the workspace that used
to be at index 1.

Relevant code: web/src/sync.ts (deltaRefresh ~line 358-362, onLogin
~line 490-494), web/src/App.tsx (workspaces[activeWorkspaceIndex] ~line
302).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 deltaRefresh resolves the post-merge active workspace by id, falling back to positional clamping only when the previously-active workspace is genuinely absent from the merged result
- [x] #2 onLogin resolves the post-merge active workspace by id using the same fallback rule, preserving its existing late-read-currIdx / early-captured-local semantics
- [x] #3 New sync.test.ts cases cover both call sites: an earlier tab disappearing (deleted or closed-elsewhere-and-saved) must not silently re-point the active index at a different workspace
- [x] #4 Existing sync.test.ts suite (including the pre-existing positional-clamp and saved-workspace-closed-elsewhere tests) still passes unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

`deltaRefresh` (sync.ts ~362-394) and `initSync`'s `onLogin` (~535-588) both
resolve the post-merge active workspace purely by **position**:

    const currIdx = useWorkspace.getState().activeWorkspaceIndex;
    const safeIdx = Math.min(currIdx, safeMerged.length - 1);

`mergeById` (the shared engine behind `mergeWorkspaces`/`mergeSavedLibrary`,
~95-123) preserves `local`'s iteration order but can *remove* an entry at any
position (remote delete, or — since TASK-126.2 — `saved && !open` exclusion
moving a row into the saved-library instead of the tab bar). When an entry
before/at `currIdx` drops out, everything after it shifts left by one, so
`safeIdx` now points at a workspace with a different identity. App.tsx
renders `workspaces[activeWorkspaceIndex]` directly (~line 302), so this
swap is silent — no error, no warning, wrong content on screen.

## Fix

Add one shared helper in sync.ts, right after `mergeById`/`mergeWorkspaces`/
`mergeSavedLibrary` (~line 136, before the "API helpers" section), and call
it from both sites instead of the raw `Math.min` clamp:

    /**
     * Resolves the active workspace by identity across a merge, not
     * position. If the workspace that was active before the merge still
     * exists in the merged array (by id), stays active regardless of where
     * it moved to. Falls back to positional clamping only when that
     * workspace is genuinely gone from this array (deleted, or excluded
     * into the saved library) — matching the pre-existing empty-result
     * fallback behavior.
     */
    function resolveActiveIndex(
      prevWorkspaces: WorkspaceEntry[],
      prevActiveIndex: number,
      merged: WorkspaceEntry[],
    ): number {
      const activeId = prevWorkspaces[prevActiveIndex]?.id;
      if (activeId) {
        const idx = merged.findIndex((w) => w.id === activeId);
        if (idx !== -1) return idx;
      }
      return Math.min(prevActiveIndex, merged.length - 1);
    }

Note `merged.length - 1` is always >= 0 by the time this is called at both
sites, because both callers already default to
`[makeDefaultWorkspace(...)]` when the raw merge result is empty before
calling this helper.

### Call site 1 — `deltaRefresh` (~377-387)

`local` (pre-merge workspaces) and `currIdx` are both read in the same
synchronous tick already (no `await` in between), so this is a direct
substitution:

    const local = useWorkspace.getState().workspaces;
    const merged = mergeWorkspaces(local, rows);
    ...
    const safeMerged = merged.length > 0 ? merged : [makeDefaultWorkspace("Workspace 1")];
    const currIdx = useWorkspace.getState().activeWorkspaceIndex;
    const safeIdx = resolveActiveIndex(local, currIdx, safeMerged);

### Call site 2 — `onLogin` (~549-577)

Here `local` is captured early (line 549) but `currIdx` is deliberately read
late (line 575), *after* the `await pushWorkspace(...)` loop, so it reflects
any tab switch the user made while that loop was in flight. Preserve that
same "late read, resolved against the early local snapshot" semantics — do
not move the `local` capture or the `currIdx` read:

    const safeMerged = finalMerged.length > 0 ? finalMerged : [makeDefaultWorkspace("Workspace 1")];
    const currIdx = useWorkspace.getState().activeWorkspaceIndex;
    const safeIdx = resolveActiveIndex(local, currIdx, safeMerged);

(`local` here is the pre-merge array read at line 549 — still valid because
nothing mutates the *store's* `workspaces` between then and line 577; the
loop only mutates the local `finalMerged` array, not the store.)

## Why this is enough, and why the fallback is still by-position

- A workspace present in `safeMerged` under the same id (whether it moved
  position due to something earlier being deleted/excluded, or was
  updated/replaced by `rowToEntry`) is found by `findIndex` and stays
  active — this is the actual bug fix.
- A workspace that's genuinely gone from `safeMerged` (hard-deleted, or a
  saved workspace closed elsewhere and excluded into the library by
  `mergeWorkspaces`'s `saved && !open` filter) is not found, and we fall
  back to the pre-existing positional clamp. This matches the ticket's
  suggested fix verbatim ("falling back to index clamping only when the
  previously active workspace is genuinely gone") and preserves current,
  already-tested behavior for the true-removal case (see the existing
  "activeWorkspaceIndex is clamped when a workspace is removed by
  deltaRefresh" test, sync.test.ts ~654).
- No change needed in `App.tsx` — it already just reads
  `workspaces[activeWorkspaceIndex]`; fixing the index computation upstream
  is sufficient.
- `store.ts`'s `removeWorkspace` is a different, already-correct code path
  (single explicit index, local single-tab close) and is out of scope here.

## Tests to add (web/src/sync.test.ts)

Add two new `it` blocks near the existing "activeWorkspaceIndex is clamped
when a workspace is removed by deltaRefresh" test (~654-685), reusing
`makeEntry`/`makeRow`/`resetStores` helpers already in the file:

1. **`deltaRefresh` preserves active workspace by identity when an earlier
   tab disappears** (the ticket's repro): two local workspaces `ws-a`
   (index 0) and `ws-b` (index 1, active). Delta response reports `ws-a` as
   a closed saved workspace (`saved: true, open: false`) — the case
   TASK-126.2 made routine. After `await deltaRefresh(true)`, assert:
   - `workspaces` contains only `ws-b`
   - `activeWorkspaceIndex` points at the entry whose `id === "ws-b"`
     (not just "index 0" — assert on identity, e.g.
     `workspaces[activeWorkspaceIndex].id`), proving it didn't silently
     re-point at whatever ended up at position 1 (nothing does here, but
     assert by id/name so a future regression that scrambles order is
     still caught)

2. **`onLogin` preserves active workspace by identity when an earlier tab
   disappears** — same shape as (1) but driving it through `initSync()` +
   `useAuth.setState({ status: "authed" })` (mirroring the existing
   `describe("initSync onLogin", ...)` tests ~571-685) instead of calling
   `deltaRefresh` directly, so the `onLogin` code path itself is covered
   (not just `deltaRefresh`'s shared logic).

Optionally extend test (1)'s coverage to also cover a genuine remote delete
of the earlier tab (`deleted_at` set) to explicitly confirm the *fix*
applies to the delete case too, not just the saved/closed-elsewhere case —
though the existing test at ~654 already covers "active tab itself deleted
(clamped)"; the new gap is specifically "an *earlier* tab disappears while
a *later* tab stays active."

## Verification

    cd web && pnpm test -- sync.test.ts

Run the full existing suite (not just the new cases) to confirm the
existing "activeWorkspaceIndex is clamped..." test and the "saved workspace
closed on another device" test (~1165-1215) still pass unchanged — both
exercise adjacent behavior this change must not regress.

No sub-tickets: this is a single-file, well-bounded fix (one shared helper
+ two call-site substitutions + two test cases), all within sync.ts /
sync.test.ts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented exactly per the plan: added `resolveActiveIndex(prevWorkspaces, prevActiveIndex, merged)` helper in web/src/sync.ts right after `useSavedWorkspaceLibrary`, and swapped the raw `Math.min(currIdx, safeMerged.length - 1)` clamp for `resolveActiveIndex(local, currIdx, safeMerged)` at both call sites (deltaRefresh and onLogin). Neither the `local` capture point nor the late `currIdx` read in onLogin were moved, preserving existing semantics.

Added two new sync.test.ts cases inside `describe("initSync onLogin", ...)` alongside the existing positional-clamp test: one drives `deltaRefresh(true)` directly, the other drives the same scenario through `initSync()` + `useAuth.setState({ status: "authed" })`. Both report an earlier tab (ws-a) as closed-and-saved-elsewhere (saved:true, open:false) while a later tab (ws-b) stays active, then assert `workspaces[activeWorkspaceIndex].id === "ws-b"` by identity. Had to make the onLogin test's mock also return ws-b's row (version-matched) so onLogin's local-only push loop is a no-op — otherwise the test's simplistic fetch mock (which only understood the GET pull shape) crashed pushWorkspace's PUT path and masked the actual assertion behind an unrelated failure.

Full verification: `pnpm test -- sync.test.ts` (494/494 pass, including the pre-existing clamp and saved-workspace-closed-elsewhere tests unchanged), full `pnpm test` (494/494), `tsc -b` clean, `eslint src/sync.ts src/sync.test.ts` clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed active-workspace tracking in web/src/sync.ts so deltaRefresh and onLogin resolve the active workspace by id after a merge instead of by raw array position, via a shared `resolveActiveIndex` helper that falls back to positional clamping only when the previously-active workspace is genuinely gone. This prevents the editor from silently swapping to a different workspace's content when an earlier tab is removed from the array (e.g. a saved workspace closed on another device, made routine by TASK-126.2). Added two regression tests covering both call sites; full existing test suite, typecheck, and lint all pass unchanged.
<!-- SECTION:FINAL_SUMMARY:END -->
