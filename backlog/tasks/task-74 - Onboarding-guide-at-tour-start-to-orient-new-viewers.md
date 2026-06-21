---
id: TASK-74
title: Onboarding guide at tour start to orient new viewers
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-21 01:29'
updated_date: '2026-06-21 02:13'
labels:
  - tour
  - onboarding
  - ui
  - planned
dependencies:
  - TASK-73
references:
  - web/src/TourPlayback.tsx
  - web/src/theme.css
  - web/src/TourPlayback.test.tsx
  - web/src/setupTests.tsx
modified_files:
  - web/src/TourPlayback.tsx
  - web/src/TourPlayback.test.tsx
  - web/src/theme.css
priority: medium
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First-time viewers arriving at a tour in playback mode have no way of knowing where the navigation controls are or that keyboard shortcuts exist. Add a brief onboarding guide — a tooltip overlay, dismissible banner, or similar — that appears at the start of a tour and points out the navigation buttons and available keyboard shortcuts.

The guide should appear once per tour (or once ever) and be easy to dismiss. It should mention keyboard shortcuts (TASK-73), so this task should be implemented after TASK-73 is complete so the guide can accurately document the shortcuts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An onboarding hint appears automatically when a viewer first enters tour playback mode
- [x] #2 The hint identifies the prev/next navigation buttons and mentions keyboard shortcuts (← / → arrow keys)
- [x] #3 The hint can be dismissed with a single click/keypress
- [x] #4 Once dismissed, the hint does not reappear on subsequent page loads (localStorage or equivalent)
- [x] #5 The hint does not appear in tour authoring mode
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a dismissible onboarding hint banner that appears the first time a viewer enters tour playback mode. The hint identifies the prev/next navigation buttons and mentions the arrow-key shortcuts (← / →). Once dismissed, `localStorage` records the dismissal so the hint never reappears. The hint must not appear in authoring mode.

All work lives in two files: `web/src/TourPlayback.tsx` (logic + JSX) and `web/src/theme.css` (styles). No new files, no store changes, no Rust changes.

---

## Approach

### 1. localStorage key

```
const ONBOARDING_HINT_KEY = "gql-fiddle:tour-onboarding-dismissed";
```

Read once on component mount; write when the user dismisses.

### 2. State

```typescript
const [showHint, setShowHint] = useState<boolean>(
  () => localStorage.getItem(ONBOARDING_HINT_KEY) !== "1"
);
```

The lazy initializer reads localStorage synchronously so there is no flash-of-hint on re-visits. The hint is never shown in authoring mode because `TourPlayback` is only mounted when `playbackTour !== null` in `App.tsx` (structurally satisfies AC#5).

### 3. Dismiss handler

```typescript
function dismissHint() {
  localStorage.setItem(ONBOARDING_HINT_KEY, "1");
  setShowHint(false);
}
```

Also wire the `keydown` handler already on `window` to dismiss on Escape (or any non-navigation key) — or simply add a separate one-time `keydown` handler for Escape inside a `useEffect` that runs while `showHint` is true.

### 4. JSX — dismissible banner inside the prose panel

The hint renders as a fixed-position banner overlaid at the bottom of the prose panel (desktop) or as a full-width strip inside the mobile content area. It should appear above the prose content without shifting layout.

```tsx
{showHint && (
  <div className="tour-onboarding-hint" role="status" aria-live="polite" data-testid="onboarding-hint">
    <span className="tour-onboarding-hint__body">
      Use the <strong>← Prev</strong> / <strong>Next →</strong> buttons
      or <kbd>←</kbd> <kbd>→</kbd> arrow keys to navigate steps.
    </span>
    <button
      className="btn btn--icon tour-onboarding-hint__dismiss"
      onClick={dismissHint}
      aria-label="Dismiss navigation hint"
      data-testid="onboarding-hint-dismiss"
    >
      ✕
    </button>
  </div>
)}
```

Place the hint JSX:
- **Desktop:** as the first child inside `.tour-playback__prose-panel` (above `.tour-playback__step-label`).
- **Mobile:** as the first child inside `.tour-playback__mobile-content` (above the tab content).

### 5. Escape key dismissal

Add a secondary `useEffect` that listens for `Escape` while the hint is visible:

```typescript
useEffect(() => {
  if (!showHint) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape") dismissHint();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [showHint]);
```

This satisfies AC#3 ("a single keypress") for keyboard users via Escape.

---

## CSS (add to theme.css, under the tour-playback section)

```css
/* ── Tour onboarding hint ─────────────────────────────────────── */
.tour-onboarding-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 14px;
  background: var(--accent-soft);
  border-bottom: 1px solid var(--warning-border);
  font-size: 12px;
  color: var(--text);
  flex-shrink: 0;
}

.tour-onboarding-hint__body {
  flex: 1;
  min-width: 0;
}

.tour-onboarding-hint kbd {
  display: inline-block;
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--text-muted);
}

.tour-onboarding-hint__dismiss {
  flex-shrink: 0;
  padding: 2px 6px;
  font-size: 11px;
}
```

---

## Tests (add to `web/src/TourPlayback.test.tsx`)

Add a new `describe("onboarding hint (TASK-74)")` block. Before each test, clear `localStorage` so the hint is in the default visible state.

Cover these cases:

1. **AC#1 — hint appears on first entry:** After render with clean localStorage, `data-testid="onboarding-hint"` is present.
2. **AC#2 — content:** The hint text contains "← Prev" / "Next →" and the word "arrow keys" (or similar); `<kbd>` elements are present.
3. **AC#3 — click dismiss:** Click the dismiss button (`data-testid="onboarding-hint-dismiss"`); hint disappears from the DOM.
4. **AC#3 — Escape dismiss:** `fireEvent.keyDown(window, { key: "Escape" })`; hint disappears.
5. **AC#4 — persists across remount:** After dismiss, unmount and remount; hint does not reappear.
6. **AC#4 — localStorage flag set after dismiss:** After clicking dismiss, `localStorage.getItem("gql-fiddle:tour-onboarding-dismissed")` is `"1"`.
7. **AC#5 (structural):** Verify the hint does NOT appear in authoring mode — since `TourPlayback` is not rendered during authoring, any test rendering `TourPlayback` is implicitly in playback mode. Include a comment noting this.

---

## Files to touch

- `web/src/TourPlayback.tsx` — add `ONBOARDING_HINT_KEY` const, `showHint` state, `dismissHint` function, Escape `useEffect`, and hint JSX (~40 lines).
- `web/src/theme.css` — add `.tour-onboarding-hint` block (~25 lines).
- `web/src/TourPlayback.test.tsx` — add ~60 lines in a new `describe` block.

---

## Checklist

- [ ] `ONBOARDING_HINT_KEY` is a module-level const (`"gql-fiddle:tour-onboarding-dismissed"`).
- [ ] `showHint` initializes from `localStorage` in the state initializer (no flash on repeat visits).
- [ ] `dismissHint` writes `"1"` to localStorage and sets `showHint` to false.
- [ ] Escape key dismisses the hint (separate effect, only registers while `showHint` is true).
- [ ] Hint JSX rendered in both desktop and mobile branches with `data-testid="onboarding-hint"`.
- [ ] Dismiss button has `data-testid="onboarding-hint-dismiss"` and `aria-label`.
- [ ] CSS uses design tokens only (no hardcoded colors).
- [ ] Tests clear `localStorage` in `beforeEach` to avoid bleed-through between test cases.
- [ ] `pnpm tsc --noEmit` and `pnpm test run` pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete. Added `ONBOARDING_HINT_KEY` const at module level. `showHint` state initializes from localStorage in its lazy initializer — no flash on repeat visits. `dismissHint` writes '1' to localStorage and sets `showHint` to false. A separate `useEffect` registers an Escape keydown listener on window while `showHint` is true (AC#3). Hint JSX with `data-testid='onboarding-hint'` and dismiss button (`data-testid='onboarding-hint-dismiss'`) is rendered in both the desktop prose panel and the mobile `tour-playback__mobile-content` container. AC#5 is satisfied structurally — `TourPlayback` is only mounted in playback mode in App.tsx. CSS added at end of theme.css using design tokens only. 7 new tests in `describe('onboarding hint (TASK-74)')` covering all 5 AC items. All 271 tests pass; tsc --noEmit reports no errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a dismissible onboarding hint banner to TourPlayback. The hint appears at the top of the prose panel (desktop) and mobile content area on first visit, identifies the Prev/Next buttons and arrow key shortcuts, can be dismissed by clicking the ✕ button or pressing Escape, and is suppressed on subsequent visits via a localStorage flag. AC#5 is satisfied structurally — TourPlayback is only mounted during playback mode. 7 new tests cover all acceptance criteria; all 271 tests pass with no TypeScript errors.
<!-- SECTION:FINAL_SUMMARY:END -->
