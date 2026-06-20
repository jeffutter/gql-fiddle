---
id: TASK-69
title: 'feat(web): tour step highlight system — diff-based and anchor-based'
status: To Do
assignee: []
created_date: '2026-06-20 03:14'
labels:
  - feat
  - web
  - tour
dependencies:
  - TASK-65
  - TASK-66
  - TASK-67
priority: medium
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the reader advances to a step in playback (or the author navigates steps in authoring), highlight the relevant schema element in the Monaco editor to draw attention to what's pedagogically important.

**Design decisions from planning session:**

**Two highlight modes, in priority order:**
1. **Anchor-based (explicit):** If the current step has an `anchor` (`{ subgraphIndex, typeName, fieldName? }`), switch to that subgraph tab, find the line of that type/field definition, and apply a gutter icon + token background decoration. Auto-scroll Monaco to that line.
2. **Diff-based (automatic):** If no anchor, text-diff the current step's resolved SDL against the previous step's resolved SDL (for each subgraph). Highlight changed lines with a gutter icon + subtle background. Switch to the first subgraph with changes and auto-scroll to the first changed line.
3. **No highlight:** If neither condition applies (intro step with no anchor and same SDL as previous), do nothing. This is valid for introductory or summary steps.

**Visual style (consistent with existing system in `subgraphColors.ts`):**
- Gutter icon: a small colored dot or arrow (similar to existing `sg-glyph-*` classes in the query editor).
- Token/line background: subtle highlight, distinct from the existing field-attribution highlight colors.
- Use `editor.createDecorationsCollection` (same pattern as `decorationsRef` in `App.tsx`).
- Clear previous highlight decorations before applying new ones on each step change.

**Diff implementation:**
- Text diff at the line level is sufficient — no AST-level diffing needed. Split both SDLs by newline, find lines present in new but not old (or changed), highlight those line numbers in Monaco.
- Only diff the subgraph(s) whose SDL actually changed; if multiple subgraphs changed, highlight the first one.

**Scope:** This ticket covers both playback mode (`TourPlayback.tsx`, TASK-67) and authoring mode preview (`TourAuthoringPanel.tsx`, TASK-66). The same highlight logic should run in both contexts.

**Files likely touched:** new `web/src/tourHighlight.ts`, `web/src/TourPlayback.tsx`, `web/src/TourAuthoringPanel.tsx`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When a step has an anchor, the Monaco editor switches to the anchored subgraph, scrolls to the anchored type/field line, and shows a gutter icon + line background decoration
- [ ] #2 When a step has no anchor but its SDL differs from the previous step, changed lines are highlighted with a gutter icon and Monaco auto-scrolls to the first change
- [ ] #3 When a step has no anchor and no SDL diff (intro/summary step), no decoration is applied
- [ ] #4 Decorations are cleared before each step transition so stale highlights don't accumulate
- [ ] #5 The highlight style is visually distinct from the existing field-attribution decorations in the query editor
- [ ] #6 Highlight logic works in both authoring panel navigation and playback mode step navigation
- [ ] #7 Switching to a step that anchors a different subgraph automatically activates that subgraph tab
<!-- AC:END -->
