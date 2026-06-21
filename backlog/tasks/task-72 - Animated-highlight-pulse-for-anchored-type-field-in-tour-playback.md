---
id: TASK-72
title: Animated highlight pulse for anchored type/field in tour playback
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-21 01:29'
updated_date: '2026-06-21 02:01'
labels:
  - tour
  - ui
  - animation
  - planned
dependencies: []
modified_files:
  - web/src/theme.css
  - web/src/tourHighlight.ts
  - web/src/tourHighlight.test.ts
priority: medium
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a tour step has an anchor targeting a schema type or field, the highlighted element should animate (e.g. a pulse or glow) to draw the viewer's eye to it. Currently the highlight is static and easy to miss, especially on dense schemas.

The animation should be subtle enough not to distract during reading but noticeable enough to orient a first-time viewer. It should play on step entry and either loop gently or settle after a short time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Anchored element animates (pulse, glow, or equivalent) when the tour step is first displayed
- [x] #2 Animation re-triggers when navigating between steps that have different anchors
- [x] #3 Animation respects prefers-reduced-motion media query (disabled or minimized when set)
- [x] #4 Animation does not interfere with the diff-based highlight rendering
- [x] #5 Works for both type-level and field-level anchors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a CSS animation (pulse/glow) to the anchor-based tour step highlight in Monaco so that when a viewer lands on a step with a type or field anchor, the highlighted line draws their eye immediately. The animation re-triggers on each step transition and respects `prefers-reduced-motion`.

## Approach

The work is entirely CSS + a small change to `tourHighlight.ts`. No new React state, no new files beyond the existing `theme.css` and `tourHighlight.ts`. Two complementary classes drive the effect:

- **`tour-highlight-line`** (already exists) — the whole-line background tint applied for both anchor-based and diff-based highlights. This class gains an animation that plays once on entry.
- **`tour-highlight-line--anchor`** (new modifier) — applied only on the anchor-based path. It can carry a slightly more emphatic version of the animation (e.g. a pulse that loops 2-3 times then settles) to distinguish an anchor highlight from a plain diff highlight.

Because Monaco re-uses DOM nodes across decorations, the animation only retriggers if the element is re-inserted into the DOM. The existing `dispose()` → re-create pattern in `TourPlayback.tsx` (and `App.tsx`) already removes and re-adds decorations on every step transition, so the CSS `animation` will restart naturally without any extra JS.

## Step-by-step

### 1. Add `@keyframes` to `theme.css`

Add two keyframe rules near the existing `@keyframes spin` block (line ~501):

```css
@keyframes tour-pulse {
  0%   { background-color: color-mix(in srgb, var(--accent) 28%, transparent); }
  60%  { background-color: color-mix(in srgb, var(--accent) 10%, transparent); }
  100% { background-color: color-mix(in srgb, var(--accent) 10%, transparent); }
}
```

A single keyframe that flashes in at 28% opacity then fades to the resting 10% — plays once on element entry, giving a clear "arrived here" cue without looping forever.

### 2. Update `.tour-highlight-line` in `theme.css`

Extend the existing rule (line ~1208) to add the animation:

```css
.tour-highlight-line {
  background: color-mix(in srgb, var(--accent) 10%, transparent) !important;
  animation: tour-pulse 0.8s ease-out 1;
}
```

`animation-iteration-count: 1` means it plays once and settles at the resting tint. This applies to both anchor and diff highlight paths, keeping them visually consistent.

### 3. Add anchor-specific modifier `.tour-highlight-line--anchor` in `theme.css`

For anchor highlights, add a slightly more emphatic variant that loops 3 times (enough to orient the viewer, not so much that it becomes distracting):

```css
.tour-highlight-line--anchor {
  animation: tour-pulse 0.9s ease-out 3;
}
```

### 4. Add `prefers-reduced-motion` block in `theme.css`

After the above rules, add:

```css
@media (prefers-reduced-motion: reduce) {
  .tour-highlight-line,
  .tour-highlight-line--anchor {
    animation: none;
  }
}
```

This satisfies AC#3 without needing any JS logic.

### 5. Update `tourHighlight.ts` — anchor path applies the modifier class

In the anchor-based decoration block (around line 105–118), change the `className` option:

```ts
options: {
  isWholeLine: true,
  linesDecorationsClassName: "tour-highlight-gutter",
  className: "tour-highlight-line tour-highlight-line--anchor",
},
```

The diff-based path keeps `className: "tour-highlight-line"` unchanged — it already benefits from the single-play animation added in step 2.

### 6. Update `tourHighlight.test.ts`

The two anchor-path tests that assert `className === "tour-highlight-line"` need updating to expect `"tour-highlight-line tour-highlight-line--anchor"`. The diff-path tests remain unchanged.

## Verification

- Navigate a tour with an anchored step → highlighted line should flash in then settle.
- Navigate to a different anchored step → animation restarts (because Monaco disposes and re-creates the decoration).
- Navigate between two diff-only steps → animation plays once per step transition.
- Enable `prefers-reduced-motion` in OS/browser → highlight appears immediately with no animation.
- Check diff-based highlight path is visually unchanged from the user's perspective (still shows the tint, just with a gentler single-play pulse instead of no animation).

## Files to modify

- `web/src/theme.css` — add `@keyframes tour-pulse`, update `.tour-highlight-line`, add `.tour-highlight-line--anchor`, add `@media (prefers-reduced-motion: reduce)` block
- `web/src/tourHighlight.ts` — anchor decoration `className` gains `tour-highlight-line--anchor` modifier
- `web/src/tourHighlight.test.ts` — update two className assertions in anchor-path tests

No sub-tickets needed — all changes are tightly coupled and can ship together in one focused session.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented via CSS-only approach with no new React state or files. Added `@keyframes tour-pulse` (flash-then-settle) to `theme.css` after the existing `@keyframes spin`. The `.tour-highlight-line` base class now plays the pulse once (0.8s), while the new `.tour-highlight-line--anchor` modifier overrides to 3 iterations (0.9s each) for more emphasis on anchor-targeted lines. A `@media (prefers-reduced-motion: reduce)` block suppresses both animations. In `tourHighlight.ts`, the anchor decoration path now applies `"tour-highlight-line tour-highlight-line--anchor"` as its `className`. The animation re-triggers naturally because the existing dispose+recreate pattern removes and re-inserts Monaco decorations on every step transition. All 258 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a `tour-pulse` CSS keyframe animation to the anchor-based tour step highlight. The anchored line now flashes bright then settles (3 iterations at 0.9s each) via the new `.tour-highlight-line--anchor` BEM modifier, while diff-based highlights play a single gentler pulse (0.8s, once). `prefers-reduced-motion` disables all animation. The animation re-triggers automatically on step navigation because the existing dispose+recreate pattern for Monaco decorations re-inserts the DOM element. Three files changed: `web/src/theme.css`, `web/src/tourHighlight.ts`, `web/src/tourHighlight.test.ts`. All 258 tests pass."
<!-- SECTION:FINAL_SUMMARY:END -->
