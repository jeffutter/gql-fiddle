---
id: TASK-96
title: Decompose App.tsx (2441 lines) into focused hooks and components
status: Backlog
assignee: []
created_date: '2026-07-01 00:27'
updated_date: '2026-07-01 00:30'
labels:
  - review
dependencies:
  - TASK-112
  - TASK-113
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent tracking ticket. web/src/App.tsx is 2441 lines / 21 effects / 64 hooks mixing seven concerns. A code review identified high-value extractions (useMonacoGraphQL, useGraphQLPipeline, useTourAuthoringDecorations, shared TabStrip/EditableTab/clipboard) that would take it to ~400-500 lines of composition and make the fragile Monaco/pipeline logic reviewable and testable. Do the targeted bug fixes (APP-MOCKRUN, APP-MONACOLIFE) first to avoid moving buggy code.
<!-- SECTION:DESCRIPTION:END -->
