---
id: TASK-83
title: 'feat(tours): step index in playback mode for direct navigation'
status: To Do
assignee: []
created_date: '2026-06-23 19:18'
labels:
  - feat
  - tours
  - web
dependencies: []
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
- [ ] #1 A numbered step list appears below the prose content in the desktop prose panel
- [ ] #2 Clicking any step in the index jumps directly to that step
- [ ] #3 The currently active step is visually highlighted in the list
- [ ] #4 Steps with an empty label fall back to 'Step N' in the index
- [ ] #5 The same step index appears in the mobile tour tab
- [ ] #6 Arrow-key and Prev/Next navigation also updates the highlighted item in the index
<!-- AC:END -->
