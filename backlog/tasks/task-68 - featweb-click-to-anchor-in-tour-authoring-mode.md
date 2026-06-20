---
id: TASK-68
title: 'feat(web): click-to-anchor in tour authoring mode'
status: To Do
assignee: []
created_date: '2026-06-20 03:13'
labels:
  - feat
  - web
  - tour
dependencies:
  - TASK-64
  - TASK-65
  - TASK-66
priority: medium
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While the tour authoring panel is open, clicking on a type or field name in the schema editor sets that node as the anchor for the current step. The anchor is used by the highlight system (TASK-69) to draw attention to a specific schema element in playback.

**Design decisions from planning session:**
- Click handler is active only when the authoring panel is open (not in normal fiddle mode).
- On click, call the WASM `nodeAtPosition(sdl, line, col)` export (from TASK-65) with the Monaco cursor position.
- If the result is non-null `{ typeName, fieldName? }`, store it as `step.anchor = { subgraphIndex: activeSubgraph, typeName, fieldName }` on the current step.
- If the result is null (click landed on whitespace, a directive argument, etc.), do nothing.
- Visual feedback: the anchored line gets a distinct Monaco decoration (e.g. a small pin icon in the gutter, or a subtle left-border highlight) so the author knows what's anchored. A small "clear anchor" button appears in the authoring panel next to the anchor display.
- Clicking the same line again, or clicking "clear anchor," removes the anchor from the step.
- Only one anchor per step.

**Monaco integration:**
- Register a click handler on the schema editor instance via `editor.onMouseDown` when authoring mode is active. Remove it when authoring mode exits.
- Use `editor.createDecorationsCollection` for the anchor indicator decoration (same pattern as existing field-attribution decorations in `App.tsx`).

**Files likely touched:** `web/src/App.tsx` (or `TourAuthoringPanel.tsx`), `web/src/core/index.ts` (wire up new WASM export).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clicking a type declaration line in the schema editor while authoring sets anchor.typeName with no fieldName
- [ ] #2 Clicking a field line sets both anchor.typeName and anchor.fieldName
- [ ] #3 Clicking whitespace or a directive argument does not change the anchor
- [ ] #4 The anchored line is visually indicated in the Monaco editor (gutter decoration or similar)
- [ ] #5 The authoring panel shows the current anchor (e.g. 'Product.price') with a clear button
- [ ] #6 Clicking 'clear anchor' removes the anchor and the Monaco decoration
- [ ] #7 Clicking a different line replaces the existing anchor
- [ ] #8 The click handler is only active when the authoring panel is open
- [ ] #9 Anchor is saved when 'Save Step' or 'Add Step' is called
<!-- AC:END -->
