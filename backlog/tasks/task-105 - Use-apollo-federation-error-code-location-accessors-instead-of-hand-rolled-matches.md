---
id: TASK-105
title: >-
  Use apollo-federation error code/location accessors instead of hand-rolled
  matches
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: medium
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/gql-core/src/compose.rs:644-766 hand-rolls error_code and error_locations (~110 LOC of per-variant matches) that apollo-federation already provides via CompositionError::code() and ::locations(). The hand-rolled version is also less accurate — it maps SubgraphError/MergeError to generic codes where Apollo delegates to the inner error's real code (INVALID_GRAPHQL, SATISFIABILITY_ERROR, etc). Fix: use err.locations() directly and err.code() for codes. The code strings are a JS-side contract, so run the compose golden tests and reconcile any string differences (or keep a documented compatibility map).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 error_locations and error_code delegate to the apollo-federation accessors
- [ ] #2 compose golden tests pass or are updated with justification
- [ ] #3 ~100 LOC of hand-rolled matching removed
<!-- AC:END -->
