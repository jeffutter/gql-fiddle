---
id: TASK-113
title: >-
  Fix Monaco singleton double-init, stale schema on compose failure, and vim on
  conditional editors
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: medium
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In web/src/App.tsx the module-scope monacoGraphQLAPI is initialized lazily inside a debounced async compose callback (~56, ~647) — two rapid composes before the first resolves can both see null and double-initialize; it is never reset when composition fails, so a broken supergraph keeps a stale schema registered for completions/hovers; and the vim effect (~977, deps [vimMode, editor]) does not attach vim to the conditionally-mounted mock-config/query editors. Fix: guard singleton init against concurrency, clear/update the registered schema on compose failure, and attach vim per-editor on mount based on current vimMode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 rapid successive composes never double-initialize the monaco-graphql singleton
- [ ] #2 a compose failure clears stale completions/hovers from the previous schema
- [ ] #3 enabling vim then opening the mock-config editor attaches vim to it
<!-- AC:END -->
