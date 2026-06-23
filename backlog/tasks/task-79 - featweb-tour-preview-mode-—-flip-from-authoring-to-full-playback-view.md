---
id: TASK-79
title: 'feat(web): tour preview mode — flip from authoring to full playback view'
status: To Do
assignee: []
created_date: '2026-06-23 18:58'
labels:
  - feat
  - web
  - tours
dependencies: []
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
- [ ] #1 Preview button appears in TourAuthoringPanel header while a tour draft exists
- [ ] #2 Clicking Preview replaces the full app layout with TourPlayback, starting at the active authoring step
- [ ] #3 Exit Preview button appears in TourPlayback header (in place of Open in Fiddle) and returns to authoring mode
- [ ] #4 Authoring state (draft, active step, workspace) is unchanged after exiting preview
- [ ] #5 URL-hash playback mode is unaffected
<!-- AC:END -->
