---
id: TASK-67
title: 'feat(web): tour playback mode — 3-pane layout driven by #t= URL'
status: To Do
assignee: []
created_date: '2026-06-20 03:13'
labels:
  - feat
  - web
  - tour
dependencies:
  - TASK-64
priority: high
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the reader-facing playback mode. When the app loads a `#t=` URL hash, it decodes the tour and enters a simplified 3-pane layout instead of the normal fiddle.

**Design decisions from planning session:**
- Layout: prose panel left (~40% width), schema editor read-only top-right, query plan bottom-right.
- The query editor is hidden in playback; the active query is part of the step's resolved workspace and drives the plan automatically (auto-run is already wired up in the existing fiddle).
- Subgraph tabs remain visible so the reader can switch between subgraphs to inspect the full picture.
- Step navigation: Prev/Next buttons + step counter (e.g. "2 / 5") in the playback header. The tour title also appears in the header.
- "Open in Fiddle" button in the playback header loads the current step's resolved workspace (base + overrides merged via `resolveTourStep`) into the normal fiddle — navigates to `#w=` URL or loads workspace into state and drops the `#t=` hash.
- Schema editors are read-only in playback (Monaco `readOnly: true` option).
- Playback is a distinct layout from the normal fiddle — not the same component rearranged, but a dedicated `TourPlayback.tsx` component that reads from the decoded tour.

**Entry point in `App.tsx`:**
- On mount, check `location.hash`. If it starts with `#t=`, decode the tour via `decodeTour` (TASK-64), store it in component state, and render `<TourPlayback>` instead of the normal fiddle layout.
- The existing `#w=` restore logic remains untouched.

**Files likely touched:** `web/src/App.tsx`, new `web/src/TourPlayback.tsx`, `web/src/share.ts` (re-export `decodeTour`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A #t= URL hash causes the app to render the playback layout instead of the normal fiddle
- [ ] #2 Prose panel is displayed on the left showing the active step's label and prose text (Markdown rendered)
- [ ] #3 Schema editor panel is top-right, read-only, showing the active step's resolved subgraph SDL
- [ ] #4 Query plan panel is bottom-right, updating automatically as the resolved workspace changes per step
- [ ] #5 Subgraph tabs are present and switch the read-only editor between subgraphs
- [ ] #6 Prev/Next buttons and step counter navigate between steps
- [ ] #7 Step navigation updates the prose, schema editor content, and active subgraph appropriately
- [ ] #8 'Open in Fiddle' loads the current step's resolved workspace into the normal fiddle UX
- [ ] #9 Invalid or malformed #t= URL shows a clear error message rather than a blank screen
- [ ] #10 Tour title appears in the playback header
<!-- AC:END -->
