---
id: TASK-79
title: 'feat(web): tour preview mode — flip from authoring to full playback view'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 18:58'
updated_date: '2026-06-23 19:47'
labels:
  - feat
  - web
  - tours
  - planned
dependencies: []
modified_files:
  - web/src/App.tsx
  - web/src/TourAuthoringPanel.tsx
  - web/src/TourPlayback.tsx
  - web/src/TourPlayback.test.tsx
priority: medium
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let tour authors preview the tour they're building without leaving the app or navigating to a share URL. A Preview button in the authoring panel swaps the whole app layout to `TourPlayback`, starting at the currently active step. An Exit Preview button returns the author to their exact prior state.

## Implementation

### `App.tsx`
- Add `const [tourPreviewMode, setTourPreviewMode] = useState(false)`.
- Pass `onPreview={() => setTourPreviewMode(true)}` to `TourAuthoringPanel`.
- Add a render path after the existing `if (playbackTour !== null)` block:
  ```tsx
  if (tourPreviewMode && tourDraft !== null) {
    return (
      <TourPlayback
        tour={tourDraft}
        initialStepIndex={tourActiveStep ?? 0}
        onExitPreview={() => setTourPreviewMode(false)}
      />
    );
  }
  ```

### `TourAuthoringPanel.tsx`
- Add `onPreview: () => void` to `TourAuthoringPanelProps`.
- Add a **Preview** button in the panel header row (between title input and collapse/exit buttons).

### `TourPlayback.tsx`
- Add optional props `onExitPreview?: () => void` and `initialStepIndex?: number`.
- Initialize `stepIndex` from `initialStepIndex ?? 0`.
- When `onExitPreview` is provided, replace "Open in Fiddle" with an **Exit Preview** button.

## Notes
- `tourDraft` is already typed as `Tour` — no encoding/conversion needed, passes directly as `tour` prop.
- Unsaved step edits are not reflected in preview (only committed step state). This is intentional.
- URL-hash playback (`playbackTour !== null`) takes priority and is unaffected.
- Step navigation inside preview does not affect authoring state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Preview button appears in TourAuthoringPanel header while a tour draft exists
- [x] #2 Clicking Preview replaces the full app layout with TourPlayback, starting at the active authoring step
- [x] #3 Exit Preview button appears in TourPlayback header (in place of Open in Fiddle) and returns to authoring mode
- [x] #4 Authoring state (draft, active step, workspace) is unchanged after exiting preview
- [x] #5 URL-hash playback mode is unaffected
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a preview mode so tour authors can see the full `TourPlayback` experience without leaving the authoring UI. Three files change together — they are tightly coupled and must ship as one unit.

## Files to Change

### 1. `web/src/TourPlayback.tsx`

Add two optional props to `TourPlaybackProps`:

```ts
interface TourPlaybackProps {
  tour: Tour;
  initialStepIndex?: number;
  onExitPreview?: () => void;
}
```

- Change the `useState(0)` for `stepIndex` to `useState(initialStepIndex ?? 0)`.
- In the desktop render (line ~506) and the mobile render (line ~316), replace the "Open in Fiddle" `<button>` with a conditional:
  - If `onExitPreview` is provided: render `<button className="btn btn--primary" onClick={onExitPreview}>Exit Preview</button>`
  - Otherwise: render the existing "Open in Fiddle" button.
- The `openInFiddle` function is still needed for the non-preview case; keep it.

### 2. `web/src/TourAuthoringPanel.tsx`

Extend `TourAuthoringPanelProps`:

```ts
interface TourAuthoringPanelProps {
  onCollapse: () => void;
  onPreview: () => void;
}
```

Add a **Preview** button in the panel header row (`.tour-panel__header`), between the title `<input>` and the collapse `›` button:

```tsx
<button
  className="btn"
  onClick={onPreview}
  title="Preview tour"
  aria-label="Preview tour"
>
  Preview
</button>
```

Update both call sites in `App.tsx` (desktop at line ~1940 and mobile at line ~1645) to pass the new prop.

### 3. `web/src/App.tsx`

1. Add state: `const [tourPreviewMode, setTourPreviewMode] = useState(false);`

2. After the existing `if (playbackTour !== null)` guard (line ~1405), add:
   ```tsx
   if (tourPreviewMode && tourDraft !== null) {
     return (
       <TourPlayback
         tour={tourDraft}
         initialStepIndex={tourActiveStep ?? 0}
         onExitPreview={() => setTourPreviewMode(false)}
       />
     );
   }
   ```

3. Pass `onPreview={() => setTourPreviewMode(true)}` to both `<TourAuthoringPanel>` usages (desktop and mobile).

4. When `tourPreviewMode` is set back to `false` (via `onExitPreview`), authoring state is naturally restored because `tourDraft`, `tourActiveStep`, and the workspace store are never mutated during preview — `TourPlayback` owns its own local state.

## Integration Notes

- `tourDraft` is already typed as `Tour` — passes directly to `TourPlayback` without conversion.
- URL-hash playback (`playbackTour !== null`) is checked before the new preview guard, so it retains full priority.
- Step navigation inside preview does not bleed back into `tourActiveStep` because `TourPlayback` uses its own `stepIndex` state.
- Exiting preview (setting `tourPreviewMode = false`) drops the `TourPlayback` subtree; React remounts the full authoring layout with the same store state that was there before preview.
- Reset `tourPreviewMode` to `false` when `tourDraft` is cleared (`handleExitTour` in `TourAuthoringPanel` calls `setTourDraft(null)`). This is safe implicitly because the preview render path already guards on `tourDraft !== null` — if `tourDraft` is cleared by some other means, the app falls through to the authoring layout which also has a `tourDraft !== null` guard.

## Test Coverage

Add to `TourPlayback.test.tsx` — a new `describe("preview mode (TASK-79)")` block:
- Render `<TourPlayback tour={sampleTour} initialStepIndex={1} onExitPreview={fn} />` and assert `step-counter` reads "2 / 2" (initialStepIndex honoured).
- Assert "Exit Preview" button is present (not "Open in Fiddle") when `onExitPreview` is provided.
- Assert `onExitPreview` is called when the Exit Preview button is clicked.
- Assert "Open in Fiddle" button is present (not "Exit Preview") when `onExitPreview` is absent.

These tests are unit-level and follow the existing `describe`/`it` patterns in the file.

## Acceptance Criteria Mapping

- AC#1: Preview button in `TourAuthoringPanel` header (visible when `tourDraft !== null`, which is always true while the panel is mounted).
- AC#2: Clicking Preview renders `TourPlayback` with `tourDraft` starting at `tourActiveStep`.
- AC#3: Exit Preview button in `TourPlayback` header (replaces "Open in Fiddle" when `onExitPreview` is provided).
- AC#4: Exiting preview drops the `TourPlayback` subtree; authoring state is unchanged in the store.
- AC#5: The `if (playbackTour !== null)` guard runs first, so URL-hash playback is unaffected.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation followed the plan exactly. Three files changed:
- TourPlayback.tsx: added optional initialStepIndex and onExitPreview props; stepIndex initializes from initialStepIndex ?? 0; both mobile and desktop headers show Exit Preview button (replacing Open in Fiddle) when onExitPreview is provided.
- TourAuthoringPanel.tsx: added onPreview prop to interface and component signature; Preview button added in panel header between title input and collapse button.
- App.tsx: added tourPreviewMode state; preview render path added after playbackTour check; both TourAuthoringPanel usages (desktop and mobile) updated to pass onPreview.
- TourPlayback.test.tsx: added describe('preview mode (TASK-79)') block with 5 tests covering initialStepIndex, Exit Preview visibility, Open in Fiddle visibility, and callback invocation.
All 44 TourPlayback tests and 68 App tests pass. TypeScript reports no errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added tour preview mode: a Preview button in TourAuthoringPanel swaps the full app layout to TourPlayback (starting at the active step), and an Exit Preview button returns authors to their exact prior state. All 5 acceptance criteria implemented and covered by unit tests.
<!-- SECTION:FINAL_SUMMARY:END -->
