---
id: TASK-43
title: Replace live URL hash with explicit Share button
status: To Do
assignee: []
created_date: '2026-06-12 20:29'
labels:
  - ux
  - sharing
  - url
dependencies: []
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently the workspace is continuously serialised into `location.hash` via a debounced effect (`App.tsx` ~line 134–150). This clutters the browser history, makes URLs unwieldy to copy, and encodes transient state the user never asked to share.

**Goal**
- Remove the debounced effect that keeps rewriting `location.hash` as the workspace changes.
- Keep the on-mount restore: a URL with a `#w=…` hash should still hydrate the workspace exactly as it does today.
- After restoring from a hash, strip the hash from the URL (use `history.replaceState`) so the address bar stays clean for the rest of the session.
- Add a **Share** button that, when clicked, serialises the workspace at that point in time, writes `window.location.href` (with the `#w=…` hash) to the clipboard, and shows a brief "Copied!" confirmation — same feedback pattern as the existing copy button.

The `encode`/`decode` helpers in `share.ts` remain unchanged; only the call-sites in `App.tsx` change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The URL hash is NOT updated automatically as the user edits subgraphs, queries, variables, or seed.
- [ ] #2 Navigating to a URL containing a `#w=…` hash hydrates the workspace correctly (existing behaviour preserved).
- [ ] #3 After hydrating from a hash, the hash is removed from the address bar without adding a browser history entry.
- [ ] #4 A Share button is visible in the UI and generates a point-in-time shareable URL with the current workspace encoded as `#w=…`.
- [ ] #5 Clicking Share copies the full URL (including hash) to the clipboard.
- [ ] #6 Clicking Share shows a brief 'Copied!' confirmation, consistent with the existing copy-result button.
- [ ] #7 All existing share round-trip and URL tests continue to pass.
<!-- AC:END -->
