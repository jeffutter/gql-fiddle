---
id: TASK-129
title: >-
  Fix: active workspace can silently switch when a remote workspace close/delete
  shrinks the tab array
status: To Do
assignee: []
created_date: '2026-08-08 01:25'
labels:
  - review-fix
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
