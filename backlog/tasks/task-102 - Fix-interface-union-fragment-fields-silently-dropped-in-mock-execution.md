---
id: TASK-102
title: Fix interface/union fragment fields silently dropped in mock execution
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: high
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/gql-core/src/mock.rs:294-297 tests inline-fragment applicability with exact type-name equality (object_type == **tc), so a fragment whose type condition is a supertype (e.g. '... on Node { id }' evaluated on a concrete User) is dropped even though it applies — verified empirically. This produces mock output missing fields for any interface/union fragment query, a common federation pattern, undermining the tool's core 'show the query's shape' purpose. Fix: test type-condition satisfaction — true if tc == object_type, or object_type is a member of union tc, or implements interface tc (via schema union / implementers_map); gate the fragment-spread branch with the same helper.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 query '{ node { __typename ... on Node { id } ... on User { name } } }' on a User includes both id and name
- [ ] #2 union-member inline fragments resolve correctly
- [ ] #3 a regression test covers supertype fragment conditions
<!-- AC:END -->
