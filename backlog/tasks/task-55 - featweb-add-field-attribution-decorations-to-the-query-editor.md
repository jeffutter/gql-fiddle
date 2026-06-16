---
id: TASK-55
title: 'feat(web): add field attribution decorations to the query editor'
status: To Do
assignee: []
created_date: '2026-06-16 18:46'
labels:
  - visualization
  - query-editor
  - query-plan
  - monaco
dependencies: []
references:
  - web/src/App.tsx
  - web/src/core/types.ts
  - web/src/planToMermaid.ts
documentation:
  - >-
    https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IModelDeltaDecoration.html
priority: medium
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After a query plan is computed, color-code each field selection in the Monaco query editor (bottom-left panel) to show which subgraph will resolve it. This gives users immediate, tangible feedback: adding a field visually reveals whether it adds a new subgraph hop or stays within an already-involved service.

**App placement:**
- Decorations are applied to the existing Monaco query editor in `App.tsx` (the `Editor` component at the bottom-left, path `query-${activeQueryTab}.graphql`).
- A small legend (subgraph → color swatch) is rendered below or overlaid on the query editor.
- No new tab or panel needed — this augments the existing query editing experience.

**Implementation approach:**
- New `planToFieldRanges.ts` utility that walks the `PlanNode` tree and the parsed query AST to produce a mapping of `{ line, col, len, service }` for each field selection served by each Fetch node. The `operation` string on each `Fetch` node contains the sub-selection sent to that subgraph — parse it with `graphql-js` `parse()` (already available as a dependency) to extract field positions relative to the original query.
- Apply decorations via Monaco's `createDecorationsCollection` API (the modern replacement for the deprecated `deltaDecorations`). Each subgraph gets a distinct `inlineClassName` (colored text background using a CSS class) and a `glyphMarginClassName` (colored gutter dot). Enable `glyphMargin: true` in the query editor's `EDITOR_OPTIONS` or via `updateOptions`.
- Decorations should update (via the existing `planResult` state) whenever the plan recomputes. Clear all decorations when `planResult` is null or has errors.
- A consistent color palette per subgraph (deterministic: e.g., hash subgraph name → index into a fixed accent palette in `theme.css`). **This same palette should be reused by the Entity Ownership Graph feature for visual consistency across the app.**

**No additional npm packages required.** Monaco's `createDecorationsCollection` API (added ~v0.34) handles everything. The `hoverMessage` field on decoration options provides free tooltip rendering.

**Design:** Use CSS custom properties from `theme.css` for the color palette. Ensure sufficient contrast on the dark "Ink at Night" theme. Colors should be visually distinct for up to 8–10 subgraphs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a successful plan, each field selection in the query editor has a colored inline highlight matching its source subgraph
- [ ] #2 Each subgraph is assigned a consistent color (same subgraph always gets the same color, deterministic across reruns)
- [ ] #3 A legend is visible near the query editor listing each subgraph name and its assigned color swatch
- [ ] #4 Hovering over a highlighted range shows a Monaco tooltip: 'Resolved by: <subgraph-name>'
- [ ] #5 A gutter icon/dot in the left margin is colored per subgraph (requires glyphMargin: true in editor options)
- [ ] #6 Decorations update automatically when the query changes and a new plan is computed (debounced, matching the existing plan computation timing)
- [ ] #7 All decorations are cleared when the plan fails or has not yet run
- [ ] #8 On mobile, decorations appear correctly in the Monaco query editor within the 'Query' tab
- [ ] #9 The color palette is accessible — sufficient contrast on the dark theme for all swatch colors
- [ ] #10 No new npm packages are added for this feature
<!-- AC:END -->
