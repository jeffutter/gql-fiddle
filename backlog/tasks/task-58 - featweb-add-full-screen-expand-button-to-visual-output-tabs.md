---
id: TASK-58
title: 'feat(web): add full-screen expand button to visual output tabs'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-17 01:22'
updated_date: '2026-06-17 01:49'
labels:
  - web
  - ux
  - visualization
  - planned
dependencies: []
priority: medium
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The embedded output panel is too small for the visual tabs (Timeline, Schema Graph, Entity Ownership Graph, etc.). Add a small expand icon in the top-right corner of each visual tab that opens the content in a full-screen modal overlay, giving users more room to explore complex visualizations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each visual output tab (Timeline, Schema Graph, Entity Ownership Graph, and any future visual tabs) has a small expand/fullscreen icon in its top-right corner
- [ ] #2 Clicking the icon opens the tab content in a modal overlay that fills most of the viewport
- [ ] #3 The modal has a close button (X or Escape key) to return to the normal panel view
- [ ] #4 The modal renders the same component/visualization as the embedded tab with no loss of interactivity
- [ ] #5 The icon is unobtrusive and does not interfere with existing tab content or controls
- [ ] #6 1,2,3,4,5
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a small fullscreen-expand button to each visual output tab (Timeline, Sequence Diagram, Entity Ownership Graph, Type Graph). Clicking it opens the tab content in a modal overlay that fills most of the viewport. The modal closes via a close button or Escape key.

This is a self-contained change across two files: `web/src/App.tsx` (component + state) and `web/src/theme.css` (modal CSS classes).

---

## Approach

Reuse the existing `.overlay` pattern that already exists for the mobile "Select Text" full-screen view. Extend it with a new `.fullscreen-modal` variant that:
- Is a centered, large-viewport box (not full-bleed like the mobile overlay)
- Has a header row with a title and close button
- Fills its content area with the visualization

The expand button lives in the Output panel's header row, using the existing `.panel__actions` / `.btn--icon` patterns so it sits unobtrusive in the top-right of the tab strip area.

---

## Step-by-step Implementation

### 1. Add state to App.tsx

Add a new state variable to track which tab (if any) is open in fullscreen:

```ts
const [fullscreenTab, setFullscreenTab] = useState<
  "sequence" | "timeline" | "entities" | "type-graph" | null
>(null);
```

Only visual tabs get this treatment. "Query Plan", "Supergraph SDL", and "Results" are text/tree outputs that don't benefit from fullscreen.

### 2. Add the expand button to the Output panel header

The Output panel already has a `panel__header` div wrapping `<h2 className="section-title">Output</h2>`. Add a `.panel__actions` cluster that shows an expand icon button whenever a visual tab is active:

```tsx
<div className="panel__header">
  <h2 className="section-title">Output</h2>
  {(["sequence", "timeline", "entities", "type-graph"] as const).includes(
    rightTab as "sequence" | "timeline" | "entities" | "type-graph"
  ) && (
    <div className="panel__actions">
      <button
        className="btn btn--icon"
        title="Expand to full screen"
        aria-label="Expand to full screen"
        onClick={() =>
          setFullscreenTab(
            rightTab as "sequence" | "timeline" | "entities" | "type-graph"
          )
        }
      >
        {/* SVG expand icon — two outward-pointing diagonal arrows */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )}
</div>
```

### 3. Add the fullscreen modal

After the desktop layout's closing `</div>`, render the modal conditionally (it must be outside `react-resizable-panels` to avoid clipping):

```tsx
{fullscreenTab !== null && (
  <div
    className="fullscreen-modal-backdrop"
    onClick={() => setFullscreenTab(null)}
    onKeyDown={(e) => { if (e.key === "Escape") setFullscreenTab(null); }}
  >
    <div
      className="fullscreen-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${fullscreenTab} full screen`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="fullscreen-modal__header">
        <span className="fullscreen-modal__title">
          {/* derive label from tab id */}
          {{ sequence: "Sequence Diagram", timeline: "Timeline", entities: "Entity Ownership Graph", "type-graph": "Type Graph" }[fullscreenTab]}
        </span>
        <button
          className="btn btn--icon"
          aria-label="Close full screen"
          onClick={() => setFullscreenTab(null)}
        >
          ×
        </button>
      </div>
      <div className="fullscreen-modal__body">
        {fullscreenTab === "sequence" && sequenceContent}
        {fullscreenTab === "timeline" && timelineContent}
        {fullscreenTab === "entities" && entitiesContent}
        {fullscreenTab === "type-graph" && typeGraphContent}
      </div>
    </div>
  </div>
)}
```

**Escape key**: Attach a `useEffect` that adds a `keydown` listener on `window` when `fullscreenTab !== null`, removing it on cleanup. This is more reliable than relying on a div's `onKeyDown` (which requires focus):

```ts
useEffect(() => {
  if (fullscreenTab === null) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape") setFullscreenTab(null);
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [fullscreenTab]);
```

### 4. Add CSS to theme.css

Add new classes at the end of theme.css, following the existing section structure:

```css
/* ==========================================================================
 * Fullscreen modal (visual tab expand)
 * ========================================================================== */

/* Semi-transparent backdrop — closes modal on click */
.fullscreen-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* The modal card itself */
.fullscreen-modal {
  width: min(96vw, 1400px);
  height: min(92vh, 900px);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-overlay);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Modal title bar */
.fullscreen-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.fullscreen-modal__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.02em;
}

/* Scrollable content area inside the modal */
.fullscreen-modal__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* TypeGraph uses height: 100% — give the body a fixed context */
  position: relative;
}
```

### 5. TypeGraph height fix in modal

`TypeGraph` renders `<div className="type-graph-root" style={{ width: "100%", height: "100%" }}>` which needs a fixed-height ancestor. The `.fullscreen-modal__body` uses `position: relative` + `flex: 1; min-height: 0` which satisfies this — no changes to `TypeGraph.tsx` needed.

However, `typeGraphContent` currently wraps `TypeGraph` in `<div className="scroll" style={{ height: "100%" }}>`. In the fullscreen modal body this will work correctly since `.fullscreen-modal__body` gives it a real height. No change needed.

### 6. Mobile: no expand button needed

The mobile layout already has a full-screen experience by design (the tab occupies the whole viewport). The expand button only renders in the desktop layout branch. This is naturally handled since the expand button is added only to the desktop Output panel, not the mobile tab strip.

---

## Files Changed

- `web/src/App.tsx` — state, expand button, modal JSX, Escape key effect
- `web/src/theme.css` — `.fullscreen-modal-backdrop`, `.fullscreen-modal`, `.fullscreen-modal__header`, `.fullscreen-modal__title`, `.fullscreen-modal__body`

---

## Testing

Add tests to `web/src/App.test.tsx`:

1. **Expand button appears for visual tabs**: Render app, click "Timeline" tab, assert a button with aria-label "Expand to full screen" is present.
2. **Expand button absent for non-visual tabs**: Click "Query Plan" tab, assert no expand button.
3. **Clicking expand opens modal**: Click expand button, assert `role="dialog"` is in the document with the correct title.
4. **Clicking × in modal closes it**: Open modal, click ×, assert dialog is gone.
5. **Escape key closes modal**: Open modal, fire Escape keydown on window, assert dialog is gone.
6. **Backdrop click closes modal**: Open modal, click backdrop, assert dialog is gone.

These tests follow the existing `fireEvent.click(screen.getByRole("button", ...))` patterns in `App.test.tsx`.

---

## Acceptance Criteria Mapping

- AC#1: expand icon in visual tab top-right → expand button in `.panel__actions` of the Output header, visible when a visual tab is active
- AC#2: modal fills most of viewport → `width: min(96vw, 1400px); height: min(92vh, 900px)`
- AC#3: close button + Escape key → `×` button in modal header + `useEffect` window keydown listener
- AC#4: same component rendered, no loss of interactivity → modal reuses `sequenceContent`, `timelineContent`, `entitiesContent`, `typeGraphContent` JSX variables directly
- AC#5: icon is unobtrusive → small SVG in `.btn--icon`, only visible when a visual tab is active, positioned in `.panel__actions` at the right of the header
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Files Changed
- `web/src/App.tsx` — Added `fullscreenTab` state, Escape key useEffect, expand button in Output panel header (desktop only), and fullscreen modal rendered outside the resizable panel tree.
- `web/src/theme.css` — Added `.fullscreen-modal-backdrop`, `.fullscreen-modal`, `.fullscreen-modal__header`, `.fullscreen-modal__title`, and `.fullscreen-modal__body` CSS classes.
- `web/src/App.test.tsx` — Added 13 new tests covering all acceptance criteria.

### Design Decisions
- The expand button is only shown in the desktop layout's Output panel header when a visual tab (sequence, timeline, entities, type-graph) is active. Non-visual tabs (Query Plan, Supergraph SDL) do not get it.
- The modal is rendered outside the `react-resizable-panels` Group tree (in a React fragment) so it is not clipped by panel overflow.
- The modal reuses existing `sequenceContent`, `timelineContent`, `entitiesContent`, and `typeGraphContent` JSX variables directly, ensuring AC#4 (same component, no loss of interactivity).
- Escape key is handled via a window-level `keydown` listener added in a `useEffect` that cleans up on close — more reliable than a div's `onKeyDown` which requires focus.
- The backdrop click closes the modal; the inner dialog card has `e.stopPropagation()` so clicking inside does not close it.
- A `VISUAL_TAB_LABELS` map in the desktop return drives the modal title and aria-label from the active tab id.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added fullscreen expand button to all visual output tabs (Timeline, Sequence Diagram, Entities, Type Graph) in the desktop layout. Clicking the expand icon opens a large modal overlay (96vw × 92vh) reusing the same visualization component. The modal closes via X button, Escape key, or backdrop click. 13 new tests cover all acceptance criteria.
<!-- SECTION:FINAL_SUMMARY:END -->
