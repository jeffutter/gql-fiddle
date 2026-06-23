---
id: TASK-83
title: 'feat(tours): step index in playback mode for direct navigation'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 19:18'
updated_date: '2026-06-23 20:07'
labels:
  - feat
  - tours
  - web
  - planned
dependencies: []
references:
  - web/src/TourPlayback.tsx
  - web/src/TourPlayback.test.tsx
  - web/src/theme.css
modified_files:
  - web/src/TourPlayback.tsx
  - web/src/TourPlayback.test.tsx
  - web/src/theme.css
priority: medium
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tour playback currently only supports linear navigation (Prev/Next buttons, arrow keys). Viewers have no way to see the full list of steps or jump directly to one. A step index in the prose panel gives viewers a table-of-contents and lets them jump to any step in one click.

## Layout

Add a step index at the bottom of the left prose panel (`tour-playback__prose-panel`), below the `<ProseRenderer>`. Render it as a numbered list:

```
1  Introduction
2  Define your subgraphs        ← current step (highlighted)
3  Add the @key directive
4  Compose and inspect the plan
```

Each row is a button that calls `setStepIndex(i)`. The active step gets a highlighted style (e.g. `is-active` class, bold label, accent-coloured number). Step labels fall back to `"Step N"` when `step.label` is empty.

## Mobile

In the mobile layout the prose panel is the `"tour"` tab. Append the same step index below the prose content there too — it's the right place since the viewer is already reading that tab.

## Onboarding hint

The onboarding hint (`tour-onboarding-hint`) currently tells viewers to use Prev/Next or arrow keys. Update its copy to also mention the step index, or remove the hint entirely now that the index makes navigation self-evident — author's call.

## CSS

Add styles for:
- `.tour-step-index` — the list container (scrollable if the tour is very long, capped height)
- `.tour-step-index__item` — each row button (full width, left-aligned, number + label)
- `.tour-step-index__item.is-active` — highlighted current step
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A numbered step list appears below the prose content in the desktop prose panel
- [x] #2 Clicking any step in the index jumps directly to that step
- [x] #3 The currently active step is visually highlighted in the list
- [x] #4 Steps with an empty label fall back to 'Step N' in the index
- [x] #5 The same step index appears in the mobile tour tab
- [x] #6 Arrow-key and Prev/Next navigation also updates the highlighted item in the index
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a `StepIndex` component (or inline JSX block) to `TourPlayback.tsx` that renders a numbered list of all steps below the prose content. Clicking any row calls `setStepIndex(i)`. The active step is highlighted. The same block appears in both the desktop prose panel and the mobile "tour" tab. The onboarding hint copy is updated to mention the index.

No sub-tickets are required — all changes live in two files: `TourPlayback.tsx` and `theme.css`.

---

## 1. Extract a `StepIndex` component inside `TourPlayback.tsx`

Add a small function component above `TourPlayback`:

```tsx
interface StepIndexProps {
  steps: Tour["steps"];
  stepIndex: number;
  setStepIndex: (i: number) => void;
}

function StepIndex({ steps, stepIndex, setStepIndex }: StepIndexProps) {
  return (
    <ol className="tour-step-index" aria-label="Step index">
      {steps.map((step, i) => (
        <li key={i} className={i === stepIndex ? "tour-step-index__item is-active" : "tour-step-index__item"}>
          <button onClick={() => setStepIndex(i)} aria-current={i === stepIndex ? "step" : undefined}>
            <span className="tour-step-index__num">{i + 1}</span>
            <span className="tour-step-index__label">{step.label || `Step ${i + 1}`}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
```

Use `<ol>` semantics since the list is ordered. Each `<li>` contains a `<button>` so it's keyboard-accessible. `aria-current="step"` marks the active entry for screen readers. The label fallback `step.label || \`Step ${i + 1}\`` satisfies AC#4.

## 2. Insert `<StepIndex>` into the desktop prose panel

In the desktop return path (below `<ProseRenderer prose={...} />`), append:

```tsx
<StepIndex steps={tour.steps} stepIndex={stepIndex} setStepIndex={setStepIndex} />
```

This satisfies AC#1, AC#2, AC#3, AC#6.

## 3. Insert `<StepIndex>` into the mobile "tour" tab

In the mobile path, inside `{mobileTab === "tour" && <div className="tour-playback__prose-panel">…</div>}`, append the same `<StepIndex>` element after `<ProseRenderer>`. This satisfies AC#5.

## 4. Update the onboarding hint copy

Update the hint body text to also mention the step index. A minimal addition is sufficient:

```
Use ← Prev / Next → buttons, arrow keys, or the step index below to navigate.
```

Alternatively, if the index makes navigation self-evident, remove the hint entirely (author's call per the ticket description). The safest approach is to update the copy — it continues to serve first-time users who haven't noticed the index.

The test `AC#2` in the `onboarding hint` describe block checks that hint text contains `"arrow keys"`. If the hint body is kept (updated text), update the test to match the new wording. If the hint is removed, remove those tests and the related localStorage logic.

## 5. Add CSS to `theme.css`

Insert after the `.tour-onboarding-hint__dismiss` rule block (end of tour-onboarding section, around line 1498):

```css
/* ── Tour step index ─────────────────────────────────────── */
.tour-step-index {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  max-height: 220px;
  overflow-y: auto;
}

.tour-step-index__item {
  display: flex;
}

.tour-step-index__item button {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 14px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--text-muted);
  font-size: 13px;
  transition: background 0.1s;
}

.tour-step-index__item button:hover {
  background: var(--surface-2);
  color: var(--text);
}

.tour-step-index__num {
  flex-shrink: 0;
  width: 1.6em;
  font-size: 11px;
  color: var(--text-faint);
  text-align: right;
}

.tour-step-index__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tour-step-index__item.is-active button {
  color: var(--text);
  font-weight: 600;
}

.tour-step-index__item.is-active .tour-step-index__num {
  color: var(--accent);
}
```

## 6. Add tests to `TourPlayback.test.tsx`

Add a `describe("step index (TASK-83)")` block covering:

- AC#1: `.tour-step-index` is present in the desktop prose panel
- AC#2: clicking a step-index item navigates to that step (check step counter)
- AC#3: the active item has the `is-active` class; others do not
- AC#4: a step with an empty label renders "Step N" in the index
- AC#5: `.tour-step-index` is present in the mobile tour tab
- AC#6: after ArrowRight, the `is-active` class moves to the next item

Use the existing `sampleTour` fixture (two steps, both with labels). For AC#4 add a local tour fixture where step labels are empty strings.

---

## File changes summary

| File | Change |
|------|--------|
| `web/src/TourPlayback.tsx` | Add `StepIndex` component; render it in desktop prose panel and mobile tour tab; update onboarding hint copy |
| `web/src/theme.css` | Add `.tour-step-index`, `.tour-step-index__item`, `.tour-step-index__item.is-active` rules |
| `web/src/TourPlayback.test.tsx` | Add `describe("step index (TASK-83)")` with 6 test cases |

---

## Verification

After implementation, run:

```
pnpm --filter web test
```

All existing tests must continue to pass. The 6 new test cases must pass. Visually confirm the index renders in both layouts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: Added StepIndex component in TourPlayback.tsx using ol/li/button for keyboard accessibility. Inserted in both desktop prose panel and mobile tour tab. Active step gets is-active class; keyboard/Prev-Next navigation automatically updates it via shared stepIndex state. Empty labels fall back to Step N. Updated onboarding hint copy in both layouts. Added CSS for .tour-step-index and related classes in theme.css. Added 7 tests covering all 6 ACs. All 325 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a StepIndex component to TourPlayback.tsx that renders a numbered list of all tour steps below the prose content in both the desktop prose panel and the mobile tour tab. Clicking any row calls setStepIndex(i) for direct navigation. The active step receives an is-active class (bold label, accent-coloured number) that updates automatically with all navigation methods (Prev/Next buttons, arrow keys, and index clicks). Empty step labels fall back to "Step N". Updated the onboarding hint copy in both layouts to also mention the step index. Added CSS for .tour-step-index and related classes in theme.css. Added 7 test cases in TourPlayback.test.tsx covering all 6 acceptance criteria; all 325 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
