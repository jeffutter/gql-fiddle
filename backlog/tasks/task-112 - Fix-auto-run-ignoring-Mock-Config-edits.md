---
id: TASK-112
title: Fix auto-run ignoring Mock Config edits
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: medium
ordinal: 133000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/App.tsx:696-709 — the auto-run effect depends on [currentQuery, supergraphSdl, seed] but doRun reads mockConfig via closure (parseYamlToJson(mockConfig) ~line 1149). Editing the Mock Config YAML changes what the mock executor should produce, but the auto-run effect never re-fires, so the user sees no change until they touch the query/seed or click Run. Fix: add mockConfig to the auto-run effect's dependency array.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 editing the Mock Config YAML re-runs the query and updates the Output pane
- [ ] #2 no auto-run infinite loop is introduced
<!-- AC:END -->
