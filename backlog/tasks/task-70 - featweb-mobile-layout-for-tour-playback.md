---
id: TASK-70
title: 'feat(web): mobile layout for tour playback'
status: To Do
assignee: []
created_date: '2026-06-20 03:14'
labels:
  - feat
  - web
  - tour
  - mobile
dependencies:
  - TASK-67
priority: low
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adapt the tour playback mode (TASK-67) to work on mobile viewports. This is a best-effort ticket — if a good mobile experience cannot be achieved without major rework, the fallback is a "best viewed on desktop" message and the ticket is closed without full implementation.

**Context:** The existing app has a mobile layout using a four-tab bottom nav bar (Schema, Query, Output, Results), implemented via the `useMobile` hook and `isMobile` flag in `App.tsx`. The playback 3-pane layout (prose + schema + plan side by side) does not fit a small screen.

**Proposed mobile playback layout:**
- Reuse the existing mobile tab bar pattern with a modified set of tabs: **Tour** (prose + step nav), **Schema** (read-only subgraph editor), **Plan** (query plan).
- The "Tour" tab shows the step prose, step counter, Prev/Next buttons, and tour title.
- The "Schema" tab shows the read-only Monaco editor for the active subgraph, with subgraph tabs if multiple subgraphs exist.
- The "Plan" tab shows the query plan tree.
- "Open in Fiddle" button accessible from the Tour tab header.

**Fallback:** If the Monaco read-only editor on mobile is too problematic (known to be awkward on touch screens), replace the Schema tab with a styled `<pre>` block showing the SDL text. This loses syntax highlighting but is reliable.

**Files likely touched:** `web/src/TourPlayback.tsx`, possibly `web/src/App.tsx` (`useMobile` hook already exists there).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a viewport ≤768px wide, tour playback renders a mobile tab bar instead of the 3-pane layout
- [ ] #2 The Tour tab shows step prose, step label, Prev/Next navigation, step counter, and tour title
- [ ] #3 The Schema tab shows the active step's subgraph SDL (read-only Monaco or pre block)
- [ ] #4 The Plan tab shows the query plan updating per step
- [ ] #5 'Open in Fiddle' is accessible on mobile
- [ ] #6 If full implementation is not feasible, a 'best viewed on desktop' message is shown instead and this is documented in the task final summary
<!-- AC:END -->
