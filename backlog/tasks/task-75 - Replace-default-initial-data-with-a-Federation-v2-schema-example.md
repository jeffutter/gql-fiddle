---
id: TASK-75
title: Replace default initial data with a Federation v2 schema example
status: To Do
assignee: []
created_date: '2026-06-23 01:12'
labels:
  - enhancement
  - ux
  - federation
dependencies: []
priority: medium
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On first load (or when the editor is empty/reset), the app should pre-populate with a realistic Apollo Federation v2 example instead of whatever placeholder is currently shown.

The example must include:
- `@link` directives pulling in the Federation v2 spec (`https://specs.apollo.dev/federation/v2.x`)
- At least 2 subgraph SDL definitions (e.g. `users` and `products`)
- A shared entity (e.g. `Product` or `User`) defined in one subgraph and extended/referenced with `@key` in the other
- A supergraph-level or gateway query that stitches them together

The goal is that a new visitor immediately sees a working, non-trivial Federation v2 schema that demonstrates `@key`, `@external`, `@shareable`, or similar directives, giving them a meaningful starting point for exploration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On initial page load (no existing session data), the editor is pre-populated with a Federation v2 SDL example
- [ ] #2 The example uses @link to import the federation v2 spec
- [ ] #3 At least 2 subgraph schemas are present (e.g. users and products subgraphs)
- [ ] #4 A shared entity is defined with @key in one subgraph and referenced/extended in another
- [ ] #5 The example is valid and can be executed/validated without errors in the app
- [ ] #6 Resetting the editor (if such a feature exists) restores this default Federation v2 example
<!-- AC:END -->
