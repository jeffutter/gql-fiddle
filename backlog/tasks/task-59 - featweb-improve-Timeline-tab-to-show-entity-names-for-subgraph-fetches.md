---
id: TASK-59
title: 'feat(web): improve Timeline tab to show entity names for subgraph fetches'
status: To Do
assignee: []
created_date: '2026-06-17 01:22'
labels:
  - web
  - ux
  - timeline
  - visualization
dependencies: []
priority: medium
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the execution Timeline (Gantt chart) tab, subgraph fetch rows currently show `_entities` as the operation name, which is not informative. Instead, display the actual entity type names being fetched (e.g. `Product, Review`). Additionally, add a visual distinction (color coding or a badge/icon) to differentiate entity fetches from regular subgraph queries so users can quickly understand the fetch pattern at a glance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Subgraph rows that represent entity fetches show the entity type names being loaded instead of `_entities`
- [ ] #2 If multiple entity types are fetched in one request, list them (e.g. `Product, Review` or truncate with a tooltip for long lists)
- [ ] #3 Entity fetches are visually distinct from regular subgraph queries (different color, badge, or icon)
- [ ] #4 Regular subgraph query rows are unaffected and continue to show their operation name
- [ ] #5 The distinction is explained in a legend or tooltip so users understand what the visual difference means
<!-- AC:END -->
