---
id: TASK-104
title: Make WASM export error-envelope shapes consistent and correctly attributed
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: medium
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The six WASM exports use three different failure shapes: compose/plan return {ok:false, errors}; validate_subgraph/validate_query return {diagnostics}; query_shape/node_at_position silently return empty/null. Worst case: validate_query with malformed *supergraph* SDL emits a fake operation diagnostic at (1,1) pointing at the user's query editor when the real fault is the schema (crates/gql-core/src/validate.rs:154-184), underlining the wrong pane. Fix: document the intentional shapes in lib.rs and distinguish 'schema could not be derived/parsed' from 'operation has diagnostics' in validate_query.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 malformed supergraph SDL no longer produces a bogus query diagnostic at (1,1)
- [ ] #2 the three envelope conventions are documented in lib.rs
- [ ] #3 web/src/core/index.ts handles the schema-error signal
<!-- AC:END -->
