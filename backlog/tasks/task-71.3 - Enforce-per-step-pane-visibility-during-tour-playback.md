---
id: TASK-71.3
title: Enforce per-step pane visibility during tour playback
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-21 01:29'
updated_date: '2026-06-21 01:57'
labels:
  - tour
  - playback
  - ui
  - planned
dependencies:
  - TASK-71.1
parent_task_id: TASK-71
priority: medium
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During tour playback, show or hide each non-schema pane according to the visibility flags stored on the current step (introduced in TASK-71.1). When the viewer navigates between steps, the layout should update immediately to reflect the new step's visibility settings.

Steps with no flags stored (existing tours) should display the default pane layout unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Panes shown/hidden on step entry match the flags stored on that step
- [x] #2 Stepping forward and backward both correctly apply the destination step's visibility
- [x] #3 Steps without visibility flags show the default pane layout (no regression for existing tours)
- [x] #4 Hidden panes do not leave empty space or broken layout in the playback view
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Goal
During tour playback, read each step's `paneVisibility` flags and show/hide the schema and query-plan panels accordingly. Also update pane layout immediately when the viewer navigates between steps. Depends on TASK-71.1 for the data model.

### Files to modify
- `web/src/TourPlayback.tsx` — apply conditional rendering for schema and plan panels on both desktop and mobile layouts

### Context
`TourPlayback` renders a 3-column layout:
- **Prose panel** (left) — always visible, not controlled by `paneVisibility`
- **Schema panel** (top right, `.tour-playback__schema-panel`) — controlled by `paneVisibility.schema`
- **Query plan panel** (bottom right, `.tour-playback__plan-panel`) — controlled by `paneVisibility.plan`

On mobile, the schema and plan panels are also present as tab content.

### Step 1 — Derive `paneVisibility` from the active step

In `TourPlayback`, after `const activeStep = tour.steps[stepIndex];`, add:

```ts
// Default: both panes visible when no flags are set.
const schemaVisible = activeStep?.paneVisibility?.schema !== false;
const planVisible   = activeStep?.paneVisibility?.plan   !== false;
```

`!== false` means `undefined` (no flag) and `true` both resolve to visible. Only an explicit `false` hides the pane.

### Step 2 — Desktop layout: conditional rendering

In the desktop `return` block, inside `.tour-playback__right`:

```tsx
<div className="tour-playback__right">
  {schemaVisible && (
    <div className="tour-playback__schema-panel">
      {/* ... existing schema editor JSX ... */}
    </div>
  )}
  {planVisible && (
    <div className="tour-playback__plan-panel">
      {/* ... existing query plan JSX ... */}
    </div>
  )}
</div>
```

When both panes are hidden, `.tour-playback__right` becomes empty. A guard is not needed for the prose panel (it is always shown). If the right column becomes completely empty, CSS should handle graceful collapse (see Step 4).

### Step 3 — Mobile layout: conditional tab rendering

In the mobile layout, the tabs themselves (`"schema"` and `"plan"`) should be hidden when their pane is not visible for the current step. Wrap the mobile tab bar buttons:

```tsx
{schemaVisible && (
  <button
    key="schema"
    className={mobileTab === "schema" ? "mobile-tab is-active" : "mobile-tab"}
    aria-pressed={mobileTab === "schema"}
    onClick={() => setMobileTab("schema")}
  >
    Schema
  </button>
)}
{planVisible && (
  <button
    key="plan"
    className={mobileTab === "plan" ? "mobile-tab is-active" : "mobile-tab"}
    aria-pressed={mobileTab === "plan"}
    onClick={() => setMobileTab("plan")}
  >
    Plan
  </button>
)}
```

Also wrap the tab content conditionally so rendering is consistent with visibility.

**Handle active tab becoming hidden on step navigation:** Add an effect that resets `mobileTab` to `"tour"` whenever the current tab becomes invisible:

```ts
useEffect(() => {
  if (mobileTab === "schema" && !schemaVisible) setMobileTab("tour");
  if (mobileTab === "plan"   && !planVisible)   setMobileTab("tour");
  // eslint-disable-next-line react-hooks/set-state-in-effect
}, [stepIndex, schemaVisible, planVisible, mobileTab]);
```

### Step 4 — CSS: handle empty right column

When both schema and plan are hidden, the `.tour-playback__right` div is empty. Add a CSS rule:

```css
.tour-playback__right:empty {
  display: none;
}
```

Or conditionally add a class in JSX:

```tsx
<div className={`tour-playback__right${(!schemaVisible && !planVisible) ? " tour-playback__right--hidden" : ""}`}>
```

Either approach prevents a blank gutter.

### Step 5 — Layout reacts immediately on step navigation

Because `schemaVisible` and `planVisible` are derived from `activeStep` (which changes with `stepIndex`), React re-renders with the new visibility on every step transition. No additional effect is needed — the derived values are always in sync.

### Step 6 — No-flag backward compat

Existing tours have no `paneVisibility` field on any step. `activeStep?.paneVisibility?.schema` is `undefined`, `!== false` is `true`, so both panes render. Zero behavioral regression.

### Step 7 — Tests

Add cases in `TourPlayback.test.tsx`:

1. **Schema pane hidden when `paneVisibility.schema = false`** — render a tour where step 0 has `paneVisibility: { schema: false }`, assert `.tour-playback__schema-panel` is absent from the DOM.
2. **Plan pane hidden when `paneVisibility.plan = false`** — same pattern.
3. **Default visibility when no `paneVisibility` set** — assert both panels are present (existing tests already cover this implicitly, but add explicit assertion).
4. **Step navigation updates visibility** — render a tour with step 0 having no flags (both visible) and step 1 having `paneVisibility: { plan: false }`. Navigate to step 1, assert plan panel is absent.
5. **Mobile: schema tab absent when `paneVisibility.schema = false`** — set `innerWidth` to 375, render, assert schema tab button is not in the DOM.

### Acceptance criteria mapping
- AC#1 — panes shown/hidden on step entry match the stored flags.
- AC#2 — prev/next navigation re-derives visibility from the destination step's flags.
- AC#3 — steps without visibility flags show all panes (default).
- AC#4 — hidden panes do not leave empty space (CSS `:empty` or conditional class).

### Verification
Run `npm test` in `web/`. All existing TourPlayback tests must pass; new tests must pass.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation was delivered as part of commit 1b9570a (feat(web): per-step pane visibility control in tour mode). Key changes in TourPlayback.tsx:

- Derives `schemaVisible` / `planVisible` from `activeStep?.paneVisibility?.schema !== false` and `activeStep?.paneVisibility?.plan !== false`. Undefined (no flags) defaults to `true` — backward-compatible.
- Desktop layout: conditionally renders `.tour-playback__schema-panel` and `.tour-playback__plan-panel` behind those booleans. Applies `tour-playback__right--hidden` modifier class when both panes are hidden.
- Mobile layout: conditionally renders the Schema and Plan tab bar buttons; a `useEffect` on `[stepIndex, schemaVisible, planVisible, mobileTab]` resets `mobileTab` to `'tour'` when the active tab becomes hidden.
- CSS: `.tour-playback__right--hidden { display: none; }` collapses the empty right column.

5 new tests in the `per-step pane visibility` describe block in `TourPlayback.test.tsx`, plus 2 in `mobile pane visibility`. All 258 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Enforced per-step pane visibility in TourPlayback during tour playback. The feature derives `schemaVisible`/`planVisible` from `activeStep.paneVisibility` using `!== false` semantics (undefined = visible, explicit false = hidden). Desktop layout conditionally renders each panel and applies `.tour-playback__right--hidden` when both are hidden. Mobile layout conditionally shows/hides tab buttons and resets the active tab to 'tour' via a `useEffect` when the current tab becomes invisible. CSS rule `display: none` on the `--hidden` modifier collapses the empty right column. 7 new tests covering all ACs; all 258 tests pass. Implementation shipped in commit 1b9570a."
<!-- SECTION:FINAL_SUMMARY:END -->
