---
id: TASK-84
title: 'fix(tours): allow free browsing during playback with a return-to-anchor button'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-24 14:45'
updated_date: '2026-06-24 15:01'
labels:
  - tours
  - bug
  - ux
  - planned
dependencies: []
modified_files:
  - web/src/TourPlayback.tsx
  - web/src/theme.css
  - web/src/TourPlayback.test.tsx
priority: medium
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During tour playback, once a step navigates to a specific anchor (e.g., a subgraph or type in the schema editor), the viewer is locked to that location. Switching tabs causes a flicker — the UI briefly shows another subgraph before snapping back to the anchor. This makes it impossible to explore the schema freely while following a tour.

The fix should remove the hard lock and instead provide a "Return to step" or "Go to anchor" button that lets the user jump back to the current step's anchor on demand. While the tour is playing, the viewer should be free to browse tabs and subgraphs without being yanked back automatically.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 During tour playback, switching tabs or subgraphs does NOT auto-navigate back to the current step's anchor
- [x] #2 A visible button (e.g. 'Return to step' or 'Go to anchor') is shown when the viewer has navigated away from the current step's anchor
- [x] #3 Clicking that button navigates the viewer back to the current step's anchor
- [x] #4 When the tour advances to a new step with an anchor, the viewer is navigated to that anchor automatically as before
- [x] #5 The return button is not shown when the viewer is already at the current step's anchor
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

The bug is a hard lock in `TourPlayback.tsx`: the `useEffect` that applies tour step highlight decorations (lines 258–264) calls `setActiveSubgraph(step.anchor.subgraphIndex)` whenever the viewer's current subgraph tab doesn't match the step's anchor. Because changing `activeSubgraph` re-triggers the effect, any attempt to switch tabs snaps the viewer back immediately. This makes tab-switching impossible while a step has an anchor.

The fix removes the auto-snap from the highlight effect and replaces it with a "Return to step" button shown only when the viewer has navigated away from the anchor. Advancing to a new step still auto-navigates to that step's anchor (AC#4).

---

## Implementation

All changes are contained in two files: `web/src/TourPlayback.tsx` and `web/src/theme.css`. No new files. No changes to `tourHighlight.ts`, `share.ts`, or tests outside of `TourPlayback.test.tsx`.

### 1. Track whether the viewer is "away from anchor"

Add a `atAnchor` boolean state variable (default `true`):

```ts
const [atAnchor, setAtAnchor] = useState(true);
```

This drives both the button visibility (AC#2, AC#5) and keeps the "Return to step" button out of the way when the viewer is already at the anchor.

### 2. Reset `atAnchor` on step transitions

In the existing `useEffect` that resets `activeSubgraph` to 0 on `stepIndex` change (line 191–194), also reset `atAnchor` to `true`:

```ts
useEffect(() => {
  setActiveSubgraph(0);
  setAtAnchor(true);          // ← add this
}, [stepIndex]);
```

Actually, `atAnchor` should be reset to `true` on step change and then set to `false` if the viewer switches away. This is cleaner than computing it from `activeSubgraph` because eventually the viewer may switch to the correct subgraph manually and we want to detect that.

### 3. Auto-navigate to anchor only on step change — not on tab switches

The existing highlight `useEffect` (lines 248–283) currently handles auto-navigation to the anchor subgraph by calling `setActiveSubgraph(step.anchor.subgraphIndex)` inside the effect. This is the lock.

**Split the concern into two separate effects:**

**Effect A — auto-navigate on step change (runs only when `stepIndex` changes):**
```ts
useEffect(() => {
  const step = tour.steps[stepIndex];
  if (step?.anchor) {
    setActiveSubgraph(step.anchor.subgraphIndex);
  }
  setAtAnchor(true);
}, [stepIndex, tour.steps]);
```
This satisfies AC#4: when the tour advances to a new step with an anchor, the viewer is navigated to that anchor automatically.

**Effect B — apply highlight decorations (runs when `activeSubgraph` or `stepIndex` changes, but does NOT call `setActiveSubgraph`):**
```ts
useEffect(() => {
  tourHighlightHandleRef.current?.dispose();
  tourHighlightHandleRef.current = null;

  const ed = schemaEditorRef.current;
  if (!ed || !monacoInstance) return;

  const step = tour.steps[stepIndex];
  if (!step) return;

  // No longer calls setActiveSubgraph here — that's Effect A's job.
  const currentSdl = subgraphs[activeSubgraph]?.sdl ?? "";
  const prevPayload = stepIndex > 0 ? resolveTourStep(tour, stepIndex - 1) : tour.base;
  const prevSdl = prevPayload.subgraphs[activeSubgraph]?.sdl ?? "";

  tourHighlightHandleRef.current = applyTourHighlight(
    ed,
    monacoInstance,
    step,
    currentSdl,
    prevSdl,
    activeSubgraph,
  );

  return () => {
    tourHighlightHandleRef.current?.dispose();
    tourHighlightHandleRef.current = null;
  };
}, [monacoInstance, stepIndex, activeSubgraph, tour, subgraphs]);
```

### 4. Detect tab switches (set `atAnchor = false`)

Wrap the subgraph tab `onClick` handlers to also set `atAnchor = false` when the user manually switches:

```tsx
onClick={() => {
  setActiveSubgraph(i);
  const step = tour.steps[stepIndex];
  if (step?.anchor && step.anchor.subgraphIndex !== i) {
    setAtAnchor(false);
  } else {
    setAtAnchor(true);
  }
}}
```

This covers both switching to a non-anchor subgraph (sets `atAnchor = false`) and switching back to the anchor subgraph manually (sets `atAnchor = true`). AC#5 is thereby satisfied: the button disappears when the viewer is already at the anchor.

### 5. Add "Return to step" button

In the schema panel tab strip header, add the button conditionally:

```tsx
<nav className="tab-strip" aria-label="Subgraph tabs">
  {subgraphs.map((sg, i) => (
    <button
      key={i}
      className={i === activeSubgraph ? "tab is-active" : "tab"}
      onClick={() => { /* updated handler above */ }}
      aria-pressed={i === activeSubgraph}
    >
      {sg.name}
    </button>
  ))}
  {!atAnchor && activeStep?.anchor && (
    <button
      className="btn tour-playback__return-btn"
      data-testid="return-to-anchor"
      onClick={() => {
        setActiveSubgraph(activeStep.anchor!.subgraphIndex);
        setAtAnchor(true);
      }}
      aria-label="Return to step anchor"
    >
      ↩ Return to step
    </button>
  )}
</nav>
```

This satisfies AC#2 (visible when away) and AC#3 (clicking it navigates back).

The button must appear in both the desktop schema panel tab strip (line ~624–633) and the mobile schema panel tab strip (line ~419–431) so that the feature works on both layouts.

### 6. Add CSS for `.tour-playback__return-btn`

In `web/src/theme.css`, add a CSS rule scoped to the return button. It should be styled as a secondary action — distinct from subgraph tabs but not competing with the primary `btn--primary` style. A small, right-aligned button within the tab-strip using `margin-inline-start: auto` keeps it visually separated from the subgraph tabs:

```css
.tour-playback__return-btn {
  margin-inline-start: auto;
  font-size: 11px;
  padding: 2px 8px;
  color: var(--accent);
  border-color: var(--accent);
  opacity: 0.85;
}

.tour-playback__return-btn:hover {
  opacity: 1;
}
```

The tab-strip is already `display: flex` with `align-items: center`, so `margin-inline-start: auto` pushes the button to the far right.

---

## Edge cases

- **Step has no anchor:** `atAnchor` stays `true` perpetually; button never renders. Correct.
- **Anchor targets subgraph 0 (the default):** Effect A sets `activeSubgraph(0)` — no visible change. `atAnchor` stays `true`. Correct.
- **User manually navigates back to the anchor subgraph:** `onClick` sets `atAnchor = true`, button disappears (AC#5). Correct.
- **Step advances while viewer is on non-anchor subgraph:** Effect A fires, snaps to new anchor, sets `atAnchor = true`. Correct (AC#4).
- **Step with anchor targeting non-0 subgraph, user switches to subgraph 0:** Button appears. Clicking returns to the anchor subgraph. Correct.

---

## Tests to add in `TourPlayback.test.tsx`

Add a `describe("free browsing during playback (TASK-84)")` block with a tour fixture that includes a step with `anchor: { subgraphIndex: 1, typeName: "Review" }`:

- **AC#1:** After clicking the non-anchor subgraph tab, the active tab changes (no snap-back).
- **AC#2:** After switching to a non-anchor subgraph, a "Return to step" button appears (`data-testid="return-to-anchor"`).
- **AC#3:** Clicking the "Return to step" button switches back to the anchor subgraph.
- **AC#4:** Advancing to a new step with an anchor switches the active subgraph to the anchor (auto-navigate still works).
- **AC#5:** When already on the anchor subgraph, the "Return to step" button is absent.

---

## Files to modify

- `web/src/TourPlayback.tsx` — all logic changes
- `web/src/theme.css` — `.tour-playback__return-btn` styles
- `web/src/TourPlayback.test.tsx` — new test describe block for TASK-84 ACs
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Root Cause
The bug was in 's highlight  (formerly lines 248–283). It called  whenever the viewer's active subgraph differed from the step anchor. Because  was in the effect's dependency array, any attempt to switch tabs immediately re-triggered the effect and snapped back to the anchor. This made free browsing impossible.

### Fix Applied

**1. Separated concerns into two effects:**
- A new step-transition effect (keyed on ) auto-navigates to the anchor subgraph and resets . This satisfies AC#4 (new steps auto-navigate) without locking the viewer in place afterward.
- The existing highlight effect (keyed on ) was stripped of the  call entirely. It now only applies decorations for the current subgraph, whatever that is.

**2. Added  boolean state (default ):**
- Reset to  on every step transition.
- Set to  when the user clicks a non-anchor subgraph tab.
- Set back to  when the user clicks the anchor subgraph tab or uses the return button.

**3. Added 'Return to step' button (data-testid='return-to-anchor'):**
- Rendered inside both the desktop and mobile schema panel  conditionally: .
- Clicking it calls  and .
- Styled with  (right-aligned via ).

### Files Modified
-  — logic changes (two effects, atAnchor state, updated tab click handlers, return button)
-  —  styles
-  — new  block with 9 tests covering all 5 ACs
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed the auto-snap lock from TourPlayback and replaced it with a conditional 'Return to step' button. Free browsing during tour playback now works correctly, and the button only appears when the viewer has navigated away from the current step's anchor subgraph.
<!-- SECTION:FINAL_SUMMARY:END -->
