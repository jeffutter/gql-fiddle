---
id: TASK-106
title: Fix node_at_position off-by-one at exclusive end column
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: low
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/gql-core/src/node_at_pos.rs:34-50 — the contains() closure treats col == end_col as inside, but apollo-compiler's LineColumn end is exclusive (one past the last char), so a cursor resting one column past a node resolves to that node instead of null/the next node. Causes hover/highlight to occasionally fire on the wrong token at boundaries. Fix: use col >= end_col for the end-line bound; add a boundary unit test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a cursor at the column immediately after a node no longer matches that node
- [ ] #2 interior positions are unchanged
- [ ] #3 a boundary unit test is added
<!-- AC:END -->
