---
id: TASK-73
title: Keyboard shortcuts for tour step navigation in playback mode
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-21 01:29'
updated_date: '2026-06-21 02:07'
labels:
  - tour
  - keyboard
  - accessibility
  - planned
dependencies: []
references:
  - web/src/TourPlayback.tsx
  - web/src/TourPlayback.test.tsx
modified_files:
  - web/src/TourPlayback.tsx
  - web/src/TourPlayback.test.tsx
priority: medium
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Viewers navigating a tour in playback mode should be able to use keyboard shortcuts to move between steps without reaching for the mouse. Arrow keys (left/right) or similar are the natural choice for sequential step navigation.

Shortcuts should only be active when the tour is in playback mode (not authoring mode) to avoid conflicting with editor keybindings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Right arrow / ArrowRight advances to the next step in playback mode
- [x] #2 Left arrow / ArrowLeft goes back to the previous step in playback mode
- [x] #3 Shortcuts are disabled (or not registered) when in authoring mode to avoid editor conflicts
- [x] #4 At the first step, left arrow is a no-op; at the last step, right arrow is a no-op
- [x] #5 Shortcuts do not fire when focus is inside an input, textarea, or contenteditable element
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add keyboard shortcut support (ArrowRight / ArrowLeft) for step navigation inside `TourPlayback`. The entire implementation lives in a single `useEffect` added to `web/src/TourPlayback.tsx`. No new files, no store changes, no Rust changes.

## Approach

A `window.addEventListener("keydown", handler)` effect is the established pattern in this codebase (see `App.tsx` lines 204–212 for the Escape-key handler). The same pattern applies here.

### Guard conditions (all must be false to advance/retreat)

1. `e.target` is an `<input>`, `<textarea>`, or has `contenteditable="true"` — prevents firing inside any editable surface.
2. `e.target` is inside the Monaco editor DOM (`closest(".monaco-editor")`) — belt-and-suspenders guard since Monaco absorbs arrow keys internally, but the window handler can still fire if focus escapes.
3. Authoring mode is NOT active (the component is only rendered during playback, so this is trivially satisfied; no extra check needed). The component already is only mounted when `playbackTour` is set in `App.tsx`, so the shortcuts can never fire in authoring mode.

### Effect body (add inside TourPlayback, near the mobile-tab fallback effect)

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // AC#5 — do not fire when focus is in any editable surface
    const target = e.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable ||
      target?.closest(".monaco-editor")
    ) return;

    if (e.key === "ArrowRight") {
      // AC#1, AC#4 — advance; no-op at last step
      setStepIndex((i) => Math.min(i + 1, totalSteps - 1));
    } else if (e.key === "ArrowLeft") {
      // AC#2, AC#4 — retreat; no-op at first step
      setStepIndex((i) => Math.max(i - 1, 0));
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [totalSteps]);
```

`totalSteps` is already derived (`const totalSteps = tour.steps.length`) so the effect dependency is stable across step transitions.

## Tests (add to `web/src/TourPlayback.test.tsx`)

Use `fireEvent.keyDown(window, { key: "ArrowRight" })` / `fireEvent.keyDown(window, { key: "ArrowLeft" })`. Testing Library's `fireEvent.keyDown` dispatches a native `KeyboardEvent` on the given target.

Cover these cases (new `describe("keyboard navigation (TASK-73)")` block):

1. ArrowRight on step 0 advances to step 1 (counter = "2 / 2").
2. ArrowLeft on step 1 returns to step 0 (counter = "1 / 2").
3. ArrowRight on last step is a no-op (counter stays "2 / 2").
4. ArrowLeft on first step is a no-op (counter stays "1 / 2").
5. ArrowRight does NOT fire when the event target is an `<input>` (simulate by dispatching `keyDown` on an input element within the document).
6. (Optional, medium-value) ArrowRight does not fire when target is a `<textarea>`.

For AC#5 tests, create an `<input>` via `document.createElement("input")`, append it to `document.body`, focus it, dispatch `fireEvent.keyDown(inputEl, { key: "ArrowRight" })`, then assert the counter is still "1 / 2".

## Files to touch

- `web/src/TourPlayback.tsx` — add one `useEffect` (~15 lines)
- `web/src/TourPlayback.test.tsx` — add ~50 lines in a new `describe` block

## Checklist

- [ ] Effect is registered with `window.addEventListener("keydown", ...)` and cleaned up on unmount.
- [ ] ArrowRight advances; ArrowLeft retreats. Both clamp at boundaries (no index goes below 0 or above totalSteps−1).
- [ ] Focus-in-editable guard uses `instanceof` checks for `HTMLInputElement` / `HTMLTextAreaElement` plus `isContentEditable`.
- [ ] No new dependencies added; `totalSteps` (number) is the only dep in the effect array.
- [ ] Tests cover all five AC items: advance, retreat, first-step clamp, last-step clamp, editable-focus no-op.
- [ ] `pnpm tsc --noEmit` and `pnpm test run` pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented keyboard navigation via a `useEffect` in `TourPlayback.tsx` that registers a `keydown` listener on `window`. The effect captures `tour.steps.length` so the dependency array is stable across step changes.

Key guard conditions:
- `target instanceof HTMLInputElement` / `HTMLTextAreaElement` — prevents firing inside form inputs
- `target instanceof HTMLElement && target.isContentEditable` — covers contenteditable divs
- `target instanceof HTMLElement && target.closest('.monaco-editor')` — belt-and-suspenders for Monaco editor focus

The `instanceof HTMLElement` guard before `.isContentEditable` / `.closest()` is required because jsdom (and browsers) call the handler with `window` as the target when `keyDown` is dispatched directly on `window` in tests — and `window` does not have a `closest` method.

AC#3 is satisfied structurally: `TourPlayback` is only mounted when `playbackTour` is set in `App.tsx` (playback mode), so the shortcuts cannot fire during authoring.

Tests: 6 new tests in `describe('keyboard navigation (TASK-73)')` cover all 5 AC items (advance, retreat, first-step clamp, last-step clamp, input/textarea focus no-op). All 264 tests pass; `tsc --noEmit` reports no errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added ArrowRight/ArrowLeft keyboard navigation to `TourPlayback`. A single `useEffect` registers a `keydown` listener on `window` that advances or retreats the step index, clamped at boundaries. Guards prevent firing inside `<input>`, `<textarea>`, contenteditable elements, or Monaco editor nodes. AC#3 is satisfied structurally — the component is only mounted during playback mode. Six new tests in `web/src/TourPlayback.test.tsx` cover all five acceptance criteria. All 264 tests pass and TypeScript reports no errors."
<!-- SECTION:FINAL_SUMMARY:END -->
