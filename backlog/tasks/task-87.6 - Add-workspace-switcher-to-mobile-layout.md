---
id: TASK-87.6
title: Add workspace switcher to mobile layout
status: Done
assignee: []
created_date: '2026-06-26 13:09'
updated_date: '2026-06-26 17:54'
labels:
  - task
dependencies:
  - TASK-87.3
parent_task_id: TASK-87
priority: medium
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The desktop workspace tab strip added in TASK-87.3 lives in the `page-header`, which is not shown on mobile. Expose workspace switching in the mobile layout.

**Context:** Mobile layout renders a `mobile-tabbar` at the bottom and uses `mobileTab` state to switch between schema/query/output/results/tour views. The `page-header` (with workspace tabs) is not part of the mobile render path.

**Options to evaluate during implementation:**
1. A compact `<select>` dropdown in the mobile header showing workspace names — simplest
2. A horizontally-scrollable strip above the mobile tab bar (mirrors desktop style)

Recommendation: start with the `<select>` dropdown for mobile since it's the least invasive and works well on touch devices. Can be enhanced later.

**Scope:** Add workspace name display + ability to switch workspaces + add/delete workspace in the mobile layout. Rename and clone can be lower priority for mobile (can be implemented if time permits).
<!-- SECTION:DESCRIPTION:END -->
