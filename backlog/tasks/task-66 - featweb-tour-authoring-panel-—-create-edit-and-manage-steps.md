---
id: TASK-66
title: 'feat(web): tour authoring panel — create, edit, and manage steps'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-20 03:13'
updated_date: '2026-06-20 14:14'
labels:
  - feat
  - web
  - tour
  - planned
dependencies:
  - TASK-64
priority: high
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a tour authoring panel to the normal fiddle UI that lets an author build a guided tour from their current workspace.

**Design decisions from planning session:**
- A "Create Tour" button in the global header converts the current workspace into the tour `base` and opens the authoring panel alongside the normal fiddle (no full mode switch — the fiddle remains fully functional).
- The author adds steps by editing the schema/query as desired, then clicking "Add Step" to snapshot the current workspace. Each step stores only `overrides` (what differs from `base`), not the full payload.
- The author can navigate Prev/Next through existing steps; when on a step, the workspace reflects that step's resolved state (base + overrides). Clicking "Save Step" re-snapshots the current workspace into the active step's overrides.
- Step management: up/down arrows to reorder, trash button to delete. No drag-and-drop in v1.
- A "Share Tour" button (only visible when a tour draft exists) encodes the tour to `#t=` and copies the URL — replaces the normal "Share" button while authoring.
- The tour draft persists in localStorage (wired up in TASK-64).

**Key behaviours:**
- `resolveTourStep(tour, stepIndex)` (from TASK-64) drives what workspace is loaded when navigating to a step.
- "Add Step" snapshots current workspace: computes `overrides` as the diff of current subgraphs/queryTabs/seed against `base`, stores only changed top-level keys.
- "Save Step" does the same but updates the existing step rather than appending.
- Navigating away from a step with unsaved changes should warn or auto-save (decision left to implementer — warn is simpler).
- The panel is collapsible (toggle button). When collapsed, the full fiddle layout is restored.

**Files likely touched:** `web/src/App.tsx`, `web/src/store.ts`, `web/src/share.ts`, new `web/src/TourAuthoringPanel.tsx`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 'Create Tour' button appears in the global header when no tour draft exists
- [x] #2 Clicking 'Create Tour' stores the current workspace as tour.base in tourDraft (localStorage-persisted)
- [x] #3 The authoring panel appears alongside the fiddle (collapsible)
- [x] #4 Tour title is editable in the panel
- [x] #5 'Add Step' appends a new step with a label input and prose textarea; the step captures overrides vs base
- [x] #6 Prev/Next navigation loads the resolved workspace for that step into the editors
- [x] #7 'Save Step' updates the active step's overrides to match the current workspace state
- [x] #8 Up/Down arrow buttons reorder steps correctly
- [x] #9 Delete button removes a step (with confirmation if it has prose)
- [x] #10 'Share Tour' encodes the tour draft to a #t= URL and copies it to the clipboard
- [x] #11 'Exit Tour' or closing the panel clears the draft after confirmation
- [x] #12 All step management actions are reflected in localStorage immediately
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

This ticket adds a tour authoring panel to the existing fiddle UI. The author clicks "Create Tour" in the global header, which snapshots the current workspace into `tour.base` and opens a collapsible side panel. Inside the panel the author can add/edit/reorder/delete steps, navigate between them, and share or exit the tour. The fiddle remains fully functional throughout.

No sub-tickets are needed — all pieces are tightly coupled (the panel reads and writes the workspace state, and all interactions with the store must stay in sync), and the entire feature ships as a single coherent unit.

---

### Files to create/modify

- `web/src/TourAuthoringPanel.tsx` — new component (the panel itself)
- `web/src/App.tsx` — wire up the panel and header buttons
- `web/src/theme.css` — add `.tour-panel` and `.tour-step` class families
- `web/src/store.ts` — add `tourActiveStep: number | null` and actions to navigate steps without mutating the tour (session-only state, not persisted)

---

### Step 1 — Extend store.ts with session-only authoring state

The store already has `tourDraft: Tour | null` (persisted). Add the following **non-persisted** fields (they must NOT be in `partialize`):

```ts
// In WorkspaceState interface:
tourActiveStep: number | null;          // which step is currently being previewed
setTourActiveStep: (i: number | null) => void;
```

These drive navigation (Prev/Next). They are session-only: losing them on reload is acceptable (the author returns to step-less view on reload).

Also add two store actions that **write workspace state** to reflect a resolved step:

```ts
loadTourStep: (stepIndex: number) => void;
// Calls resolveTourStep(tourDraft, stepIndex) and writes the result into
// subgraphs, queryTabs, activeQueryTab, seed — replacing the live workspace.
```

And an action to snapshot the current workspace into a step:

```ts
snapshotCurrentToStep: (stepIndex: number | 'new') => void;
// 'new' → appends a new TourStep; number → updates existing step's overrides.
// Computes overrides as the diff of the current workspace against tour.base.
```

**Diff computation** — only keys that differ from `base` are stored in `overrides`:

```ts
function computeOverrides(base: WorkspacePayload, current: WorkspacePayload): Partial<WorkspacePayload> | undefined {
  const overrides: Partial<WorkspacePayload> = {};
  if (JSON.stringify(current.subgraphs) !== JSON.stringify(base.subgraphs)) overrides.subgraphs = current.subgraphs;
  if (JSON.stringify(current.queryTabs) !== JSON.stringify(base.queryTabs)) overrides.queryTabs = current.queryTabs;
  if (current.activeQueryTab !== base.activeQueryTab) overrides.activeQueryTab = current.activeQueryTab;
  if (current.seed !== base.seed) overrides.seed = current.seed;
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
```

This pure helper can live at the top of `store.ts` or in `share.ts`.

---

### Step 2 — Create TourAuthoringPanel.tsx

The component receives no props — it reads entirely from `useWorkspace`.

```tsx
export function TourAuthoringPanel({ onCollapse }: { onCollapse: () => void }) { ... }
```

**Internal state (local, not in Zustand):**
- `editingStepIndex: number | null` — which step label/prose fields are expanded for editing
- Step label and prose values are read from `tourDraft.steps[i]` and written back via `setTourDraft` on blur/change

**Panel sections (top to bottom):**

1. **Tour header row** — tour title `<input>`, collapse button (`‹`), and "Exit Tour" button
   - Editing the title calls `setTourDraft({ ...tourDraft, title: newTitle })`
   - "Exit Tour" calls `window.confirm(...)` then `setTourDraft(null)` + `setTourActiveStep(null)` then restores `tour.base` into the workspace

2. **Steps list** — maps over `tourDraft.steps` and renders each as a card:
   - **Step header**: label input (inline), Prev/Next icons for navigation, up/down arrows, trash button
   - **Step body** (shown when `editingStepIndex === i`): multiline prose textarea
   - Clicking on a step header makes it active: calls `loadTourStep(i)` and `setTourActiveStep(i)`
   - "Save Step" button (shown in active step): calls `snapshotCurrentToStep(i)`

3. **Add Step button** — calls `snapshotCurrentToStep('new')`, then sets `tourActiveStep` to the new index

4. **Share Tour button** — calls `encodeTour(tourDraft!)` and copies the resulting URL to clipboard (same pattern as `copyShareUrl` in App.tsx)

**Reorder logic:**
- Up arrow: swap step[i] with step[i-1], adjust `tourActiveStep` if needed
- Down arrow: swap step[i] with step[i+1], adjust `tourActiveStep` if needed
- Always call `setTourDraft(updatedTour)` after mutation

**Delete logic:**
- If the step has non-empty prose: `window.confirm("Delete this step?")`
- Remove from array; if the deleted index was active, set `tourActiveStep` to `Math.min(i, newLength - 1)` or `null` if no steps remain; call `loadTourStep` on the new active step or restore `tour.base`

**Unsaved changes warning:**
- When navigating away from a step with `tourActiveStep !== null`, compute whether the current workspace differs from the resolved step. If it does, call `window.confirm("You have unsaved changes to this step. Navigate away?")`. If cancelled, abort navigation. (Simpler than auto-save for v1.)

---

### Step 3 — Modify App.tsx

**Global header changes:**

Replace the static "Share" button with conditional rendering:

```tsx
{tourDraft !== null ? (
  <button onClick={shareTour} className={copied ? "btn is-success" : "btn"}>
    {copied ? "Copied!" : "Share Tour"}
  </button>
) : (
  <>
    <button onClick={copyShareUrl} className={copied ? "btn is-success" : "btn"}>
      {copied ? "Copied!" : "Share"}
    </button>
    <button onClick={createTour} className="btn">
      Create Tour
    </button>
  </>
)}
```

`createTour` function:
```ts
function createTour() {
  const base: WorkspacePayload = { subgraphs, queryTabs, activeQueryTab, seed };
  setTourDraft({ title: "Untitled Tour", base, steps: [] });
  setTourAuthoringOpen(true);
}
```

`shareTour` mirrors `copyShareUrl` but uses `encodeTour(tourDraft!)`.

**Layout changes (desktop):**

Add local state `tourAuthoringOpen: boolean`. When `tourDraft !== null && tourAuthoringOpen`, render the `TourAuthoringPanel` as an additional `Panel` to the right of the existing `Group`. The panel has a fixed minimum width (~260px) with a `Separator` between the fiddle and the panel.

The collapsible behavior: a toggle button on the panel header calls `setTourAuthoringOpen(false)`. A "Tour" indicator button in the header re-opens it when `tourDraft !== null && !tourAuthoringOpen`.

On mobile: the tour authoring panel is appended as an additional mobile tab "Tour" in the bottom tab bar (when `tourDraft !== null`).

---

### Step 4 — Add CSS to theme.css

New class families following the existing design system (all use existing design tokens, no hardcoded colors):

```css
/* Tour authoring panel — sidebar alongside the fiddle */
.tour-panel { ... }           /* flex column, fixed min-width */
.tour-panel__header { ... }   /* row: title input + collapse + exit buttons */
.tour-panel__title-input { ... }  /* full-width inline input */
.tour-panel__steps { ... }    /* scrollable step list */
.tour-panel__add { ... }      /* full-width add step button */
.tour-panel__share { ... }    /* share tour button row */

/* Step cards */
.tour-step { ... }            /* card surface, border-radius, gap */
.tour-step--active { ... }    /* accent border when this step is loaded */
.tour-step__header { ... }    /* row: label + nav + reorder + delete */
.tour-step__label { ... }     /* inline label input */
.tour-step__prose { ... }     /* multiline textarea, shown when expanded */
.tour-step__actions { ... }   /* Save Step button row */
```

---

### Step 5 — Testing

Extend `web/src/store.test.ts` (or add `TourAuthoringPanel.test.tsx`) to cover:

1. `computeOverrides` — no changes returns `undefined`, single-key change returns only that key, all-keys-changed returns all keys
2. `snapshotCurrentToStep('new')` — appends step with correct overrides
3. `snapshotCurrentToStep(i)` — updates existing step overrides
4. `loadTourStep(i)` — writes resolved workspace into store
5. Step reorder: up/down arrows update `steps` array correctly

---

### Acceptance criteria verification

- AC#1 Create Tour button: rendered when `tourDraft === null`
- AC#2 Clicking it sets `tourDraft.base` to current workspace
- AC#3 Panel appears alongside fiddle, collapsed by toggle
- AC#4 Title is editable inline
- AC#5 Add Step captures overrides via `snapshotCurrentToStep('new')`
- AC#6 Prev/Next load resolved workspace via `loadTourStep`
- AC#7 Save Step updates overrides via `snapshotCurrentToStep(i)`
- AC#8 Up/Down arrows swap `steps[i]` and `steps[i±1]`
- AC#9 Delete with confirm removes step from array
- AC#10 Share Tour uses `encodeTour` + clipboard copy
- AC#11 Exit Tour confirms, clears draft, restores base
- AC#12 All mutations call `setTourDraft` which persists to localStorage immediately

---

### Verification

```bash
cd /home/jeffutter/src/gql-fiddle/web
pnpm test run          # unit tests pass
pnpm tsc --noEmit      # no type errors
pnpm lint              # no lint errors
```

Manual smoke test: open app → Create Tour → add 2 steps with different schemas → navigate between steps → verify workspace reflects step state → Share Tour → paste URL confirms it decodes (TASK-67 will handle playback, but the URL can be verified to start with `#t=`).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Files created/modified
- `web/src/TourAuthoringPanel.tsx` (new) — self-contained panel component; all state read from useWorkspace; local state only for editingStepIndex and shareCopied.
- `web/src/store.ts` — added `computeOverrides` pure helper (exported for tests), `tourActiveStep`/`setTourActiveStep` session-only fields (not in partialize), `loadTourStep` action (calls resolveTourStep, writes workspace), `snapshotCurrentToStep` action ('new' or index).
- `web/src/App.tsx` — added `tourDraft`/`setTourDraft` to destructure, `tourAuthoringOpen` local state, `createTour()` and `copyTourShareUrl()` functions, conditional header buttons (Create Tour / Share Tour / Tour reopen), flex wrapper div around the main Group for the desktop layout, TourAuthoringPanel as sibling when open, mobile 'tour' tab.
- `web/src/theme.css` — added `.tour-panel`, `.tour-panel__*`, `.tour-step`, `.tour-step--active`, `.tour-step__*` class families using design tokens only.
- `web/src/store.test.ts` — added 8 new tests covering computeOverrides (no-change, single-key, all-keys), snapshotCurrentToStep('new' and index), loadTourStep, and step reorder.
- `web/src/App.test.tsx` — updated 2 existing TASK-45 layout tests to match the new DOM structure (Group is now inside a flex-wrapper div at children[1]).

### Key design choices
- TypeScript narrowing: used `const draft = tourDraft` after early-return guard since TS can't narrow hook reads through closures.
- Navigation warning: confirm dialog before navigating away from unsaved step (simpler than auto-save).
- Step label click activates the step (calls loadTourStep); prose edit button (✎) expands/collapses prose textarea independently.
- All 213 tests pass; no type errors; no lint errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the tour authoring panel for TASK-66. Created `web/src/TourAuthoringPanel.tsx` (new component with full step CRUD, reorder, delete with confirmation, unsaved-change warnings, Share Tour URL copy, and collapsible sidebar). Extended `web/src/store.ts` with `computeOverrides` helper, `tourActiveStep`/`setTourActiveStep` session-only fields, `loadTourStep` action, and `snapshotCurrentToStep` action. Updated `web/src/App.tsx` with Create Tour / Share Tour header buttons, desktop flex-layout sidebar, and mobile Tour tab. Added CSS class families to `web/src/theme.css`. Added 8 new unit tests in `store.test.ts` and updated 2 layout tests in `App.test.tsx` to reflect the new DOM structure. All 213 tests pass, TypeScript reports no errors, and ESLint reports no errors."
<!-- SECTION:FINAL_SUMMARY:END -->
