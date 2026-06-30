---
id: TASK-93
title: Adjust header logo
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-30 16:09'
updated_date: '2026-06-30 18:46'
labels:
  - planned
dependencies: []
priority: medium
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Redo the header logo. The favicon is better. Base the header logo (visually) on the favicon. Keep the same color scheme
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The header logo is updated to look like the favicon
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

The header logo `.logo__mark` is a hexagram (two overlapping triangles) while
the favicon (web/public/favicon.svg) is a single hexagon outline with three
diameter lines through the center connecting opposite vertices, plus a filled
circle at each vertex. The circle vertex positions already match between the two.
The change is to swap the two-triangle markup for the favicon's hexagon-graph
markup, keeping the existing color scheme (`var(--accent)` = #e3b341).

## Files & exact changes

The header logo SVG is duplicated identically in two places:
- web/src/App.tsx (~lines 1628-1654, `globalHeader`)
- web/src/TourPlayback.tsx (~lines 555-581, `tour-playback__header`)

In BOTH files, replace the two `<polygon>` triangle elements with the favicon's
geometry, leaving the 6 `<circle>` vertex elements unchanged. The favicon coords
(viewBox 0 0 32 32) map cleanly onto the header's existing vertices
(viewBox 0 0 30 30): (15,3)(25.4,9)(25.4,21)(15,27)(4.6,21)(4.6,9).

Replace the two triangle polygons with:
  - one hexagon outline polygon:
      points="15,3 25.4,9 25.4,21 15,27 4.6,21 4.6,9"
      stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round"
  - three diameter lines connecting opposite vertices (stroke var(--accent),
    strokeWidth 1.5, strokeLinecap="round"):
      (15,3)->(15,27)        vertical
      (25.4,9)->(4.6,21)     diagonal
      (25.4,21)->(4.6,9)     diagonal

Keep the 6 existing `<circle>` elements (fill var(--accent)) as-is.

## Color scheme

Per the ticket, keep the same color scheme: continue using `var(--accent)`
(#e3b341), NOT the favicon's literal #F6B800. The .logo__mark drop-shadow in
web/src/theme.css (~line 631) stays unchanged.

## Optional cleanup (recommended, not required)

The logo SVG is copy-pasted in two files. Consider extracting a small shared
`<LogoMark />` (or full `<Logo />`) component to remove the duplication so the
two copies cannot drift. If done, both App.tsx and TourPlayback.tsx import and
render it. Keep this optional — if skipped, update both copies identically.

## Verification

- Run the web app (pnpm dev) and visually compare the header logo to the
  browser-tab favicon — they should read as the same mark.
- Check both the main app header and the Tour Playback header.
- Confirm the AC: "header logo is updated to look like the favicon".
- Run existing checks: pnpm lint / pnpm build (and any TourPlayback tests) to
  ensure no markup/JSX regressions.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced the header logo's hexagram (two overlapping triangle polygons) with the favicon's mark: a single hexagon outline polygon plus three diameter lines connecting opposite vertices through the center. Kept the 6 existing vertex circles and the existing color scheme (var(--accent) = #e3b341), per the ticket. Updated both identical copies of the logo SVG: web/src/App.tsx (globalHeader) and web/src/TourPlayback.tsx (tour-playback header). Verified: pnpm lint passes (only pre-existing unrelated warnings). pnpm build fails only on a missing generated src/wasm/gql_core.js module (build:wasm/wasm-pack prerequisite not present in this checkout) — unrelated to this change; no type errors reported for the edited files. Did not extract a shared Logo component (the plan's optional cleanup); the two copies were updated identically.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Header logo now mirrors the favicon: a hexagon outline with three center diameter lines and 6 vertex dots, using the existing accent color. Applied identically to both App.tsx and TourPlayback.tsx headers.
<!-- SECTION:FINAL_SUMMARY:END -->
