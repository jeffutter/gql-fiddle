---
id: TASK-96
title: Decompose App.tsx (2441 lines) into focused hooks and components
status: Done
assignee: []
created_date: '2026-07-01 00:27'
updated_date: '2026-07-02 16:44'
labels:
  - review
dependencies:
  - TASK-112
  - TASK-113
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent tracking ticket. web/src/App.tsx is 2441 lines / 21 effects / 64 hooks mixing seven concerns. A code review identified high-value extractions (useMonacoGraphQL, useGraphQLPipeline, useTourAuthoringDecorations, shared TabStrip/EditableTab/clipboard) that would take it to ~400-500 lines of composition and make the fragile Monaco/pipeline logic reviewable and testable. Do the targeted bug fixes (APP-MOCKRUN, APP-MONACOLIFE) first to avoid moving buggy code.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All four planned sub-extractions (TASK-96.1 useMonacoGraphQL, TASK-96.2 useGraphQLPipeline, TASK-96.3 useTourAuthoringDecorations, TASK-96.4 shared TabStrip/EditableTab/clipboard) are Done, as are prerequisite bug fixes TASK-112 and TASK-113. App.tsx reduced from 2441 to 1804 lines with Monaco/pipeline/tour logic now in focused, independently testable hooks.
<!-- SECTION:NOTES:END -->
