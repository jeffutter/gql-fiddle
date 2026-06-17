---
id: TASK-59
title: 'feat(web): improve Timeline tab to show entity names for subgraph fetches'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-17 01:22'
updated_date: '2026-06-17 01:57'
labels:
  - web
  - ux
  - timeline
  - visualization
  - planned
dependencies: []
modified_files:
  - web/src/planToTimeline.ts
  - web/src/planToTimeline.test.ts
  - web/src/ExecutionTimeline.tsx
  - web/src/theme.css
priority: medium
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the execution Timeline (Gantt chart) tab, subgraph fetch rows currently show `_entities` as the operation name, which is not informative. Instead, display the actual entity type names being fetched (e.g. `Product, Review`). Additionally, add a visual distinction (color coding or a badge/icon) to differentiate entity fetches from regular subgraph queries so users can quickly understand the fetch pattern at a glance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Subgraph rows that represent entity fetches show the entity type names being loaded instead of `_entities`
- [x] #2 If multiple entity types are fetched in one request, list them (e.g. `Product, Review` or truncate with a tooltip for long lists)
- [x] #3 Entity fetches are visually distinct from regular subgraph queries (different color, badge, or icon)
- [x] #4 Regular subgraph query rows are unaffected and continue to show their operation name
- [x] #5 The distinction is explained in a legend or tooltip so users understand what the visual difference means
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Subgraph fetch rows that represent `_entities` calls currently display `_entities` as their label in the Timeline Gantt chart, which is uninformative. This change extracts the actual entity type names from the inline fragments inside the `_entities` selection set and surfaces them as the label, while also applying a visual distinction (different bar color + badge) so users can tell entity fetches apart from regular subgraph queries at a glance.

All changes are confined to two TypeScript files and `theme.css`. No sub-tickets are needed — the work is tightly coupled and cannot ship in parts.

---

## 1 — Add a CSS design token for entity fetch bars (`theme.css`)

Add one new token to the `:root` block in `web/src/theme.css`:

```css
/* Entity fetch highlight — used in the Timeline tab to distinguish _entities bars */
--entity-fetch: #2ac3de;           /* cyan — already --sg-4, reuse the hue */
--entity-fetch-contrast: #0f1826;  /* text on a solid entity-fetch fill */
```

`--sg-4` (#2ac3de, cyan) is already in the palette and has sufficient contrast on `--surface`. Reusing the hue keeps the token count low; the semantic token name (`--entity-fetch`) makes the purpose explicit. Do NOT hardcode hex values in the component.

---

## 2 — Extend `planToTimeline.ts`

### 2a — Add entity type extraction

Add a `extractEntityTypes(operation: string): string[]` helper beneath `topLevelField()`:

```
/**
 * If `operation` is an _entities fetch, return the inline-fragment type names
 * found in its selection set (e.g. ["Product", "Review"]).
 * Returns an empty array for non-entity operations.
 *
 * Pattern matched: { _entities(...) { ... on TypeName { ... } } }
 */
function extractEntityTypes(operation: string): string[] { ... }
```

Implementation approach — regex scan for `... on TypeName` patterns inside the `_entities` body. A regex like `/\bon\s+([_A-Za-z][_0-9A-Za-z]*)/g` applied after confirming the top-level field is `_entities` covers all real-world plan operation strings produced by Apollo federation.

**Important**: only apply entity-type extraction when `topLevelField(operation) === "_entities"` — guard against false positives on operations that happen to contain inline fragments for other reasons.

### 2b — Add `isEntityFetch` flag to `TimelineItem`

```ts
export interface TimelineItem {
  id: string;
  service: string;
  label: string;
  depthStart: number;
  depthEnd: number;
  isOnCriticalPath: boolean;
  /** True when this fetch is an _entities call (federation entity resolution). */
  isEntityFetch: boolean;
}
```

### 2c — Populate `isEntityFetch` and update `label` in `walk()`

Inside the `"Fetch"` case of `walk()`:

```ts
case "Fetch": {
  const isEntityFetch = topLevelField(node.operation) === "_entities";
  const label = isEntityFetch
    ? (extractEntityTypes(node.operation).join(", ") || "_entities")
    : topLevelField(node.operation);
  items.push({ id, service: node.service, label, depthStart, depthEnd, isEntityFetch });
  ...
}
```

The `|| "_entities"` fallback covers the edge case where regex extraction finds no type names (malformed or future-format operations).

---

## 3 — Update `ExecutionTimeline.tsx`

### 3a — Bar fill colors

Replace the existing two-way color logic (critical path vs normal) with three-way logic:

| Condition | Fill | Stroke |
|-----------|------|--------|
| `isEntityFetch` | `var(--entity-fetch)` | `var(--entity-fetch)` with 80% opacity (`color-mix`) or a darker shade |
| `isOnCriticalPath` (non-entity) | `var(--accent)` | `var(--accent-hover)` |
| normal | `var(--surface-3)` | `var(--border-strong)` |

Entity fetches take precedence over the critical-path accent so the user always sees the entity distinction; the critical path remains visible through the `isOnCriticalPath` property (which can still affect e.g. the stroke style or a subtle icon in a future pass).

Text color: entity fetch bars use `var(--entity-fetch-contrast)`.

### 3b — "Entity" badge/pill in bar label

For entity fetch bars, prefix the truncated label text with a small `[E]` indicator rendered as an inline SVG `<text>` element, OR simply rely on the color distinction alone and put the entity types in the label. The label-only approach (no extra badge element) is simpler and more readable at small bar widths.

Recommendation: use color coding only for the bar, and put entity type names in the label + tooltip. This keeps the SVG clean.

### 3c — Tooltip update

The tooltip already shows `service` and `label`. For entity fetches, add a third line:

```
[E] Entity fetch
```

This makes the distinction explicit when hovering, satisfying AC #5.

Extend `TooltipState`:
```ts
interface TooltipState {
  x: number;
  y: number;
  service: string;
  label: string;
  isEntityFetch: boolean;  // add this
}
```

Increase `TOOLTIP_HEIGHT` from `46` to `62` to accommodate the extra line when `isEntityFetch` is true (or render it conditionally without pre-allocating height — measure the rendered tooltip and clip instead).

### 3d — Legend entry

Add a small legend row beneath the chart SVG (or above it) in the `ExecutionTimeline` component:

```tsx
<div className="timeline-legend">
  <span className="timeline-legend__item">
    <svg width="12" height="12"><rect width="12" height="12" rx="2" fill="var(--accent)" /></svg>
    Critical path
  </span>
  <span className="timeline-legend__item">
    <svg width="12" height="12"><rect width="12" height="12" rx="2" fill="var(--entity-fetch)" /></svg>
    Entity fetch (_entities)
  </span>
</div>
```

Add `.timeline-legend` and `.timeline-legend__item` to `theme.css` following the same pattern as `.subgraph-legend` / `.subgraph-legend__item`.

Only show legend items that are relevant to the current chart (e.g. only show "Entity fetch" when at least one item has `isEntityFetch === true`; only show "Critical path" when `criticalEnd === maxDepth && maxDepth > 0`).

---

## 4 — Update tests in `planToTimeline.test.ts`

Add test cases:

1. **Entity fetch label extraction** — a Fetch node whose `operation` is `{ _entities(representations: $representations) { ... on Product { id } ... on Review { id } } }` should produce `label === "Product, Review"` and `isEntityFetch === true`.

2. **Single entity type** — `{ _entities(...) { ... on User { id } } }` → `label === "User"`, `isEntityFetch === true`.

3. **Non-entity fetch unchanged** — existing tests still pass; verify `isEntityFetch === false` for normal operations.

4. **Empty type list fallback** — `{ _entities(...) { id } }` (no inline fragments) → `label === "_entities"`, `isEntityFetch === true`.

---

## 5 — Verification

After implementation:

- Run `pnpm test run planToTimeline` — all tests green including new ones.
- Run `pnpm tsc --noEmit` — no type errors.
- Run `pnpm lint` — no lint errors.
- Manual browser check: open a federation query that produces entity fetches (e.g. a two-subgraph setup with `@key`), navigate to the Timeline tab, confirm entity bars are cyan-colored and display type names instead of `_entities`, and that the hover tooltip shows `[E] Entity fetch`.

---

## File checklist

- `web/src/theme.css` — add `--entity-fetch` and `--entity-fetch-contrast` tokens + `.timeline-legend*` classes
- `web/src/planToTimeline.ts` — add `extractEntityTypes()`, extend `TimelineItem`, update `walk()`
- `web/src/planToTimeline.test.ts` — add entity fetch test cases
- `web/src/ExecutionTimeline.tsx` — three-way bar color, tooltip `isEntityFetch` line, legend component
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented `extractEntityTypes(operation)` in `planToTimeline.ts` using a regex scan for `... on TypeName` patterns, guarded by a `topLevelField() === '_entities'` check. Results are deduplicated via `Set`.

Added `isEntityFetch: boolean` field to `TimelineItem` interface. The `label` for entity fetches is now the comma-joined type names (e.g. `Product, Review`), falling back to `_entities` if no inline fragments are found.

In `ExecutionTimeline.tsx`, bar fill/stroke/text colors now use three-way logic: entity fetch (cyan `--entity-fetch`) > critical path (accent yellow) > normal. The tooltip gains a third line `[E] Entity fetch` (in cyan) for entity fetch bars. A conditional legend below the SVG shows swatches only for the categories present in the current chart.

CSS: added `--entity-fetch` (#2ac3de) and `--entity-fetch-contrast` (#0f1826) design tokens to `:root` in `theme.css`, plus `.timeline-legend` and `.timeline-legend__item` classes following the same pattern as `.subgraph-legend`.

Added 5 new test cases in `planToTimeline.test.ts` covering multiple types, single type, no-fragment fallback, deduplication, and non-entity `isEntityFetch === false`. All 179 tests pass; `tsc --noEmit` and lint both clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Improved the Timeline tab to show entity type names instead of `_entities` for federation entity fetches. Added `extractEntityTypes()` helper and `isEntityFetch` flag to `planToTimeline.ts`, applied three-way bar coloring (cyan entity / yellow critical path / default) with an `[E] Entity fetch` tooltip line and a conditional legend in `ExecutionTimeline.tsx`, and added `--entity-fetch` / `--entity-fetch-contrast` CSS tokens plus `.timeline-legend*` classes to `theme.css`. Five new test cases added; all 179 tests pass with no type or lint errors.
<!-- SECTION:FINAL_SUMMARY:END -->
