---
id: TASK-107
title: Draw entity-ownership edges from the correct source node
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
updated_date: '2026-07-01 00:30'
labels:
  - review
dependencies:
  - TASK-103
priority: medium
ordinal: 128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/EntityOwnershipGraph.tsx:324 picks srcNode as the first node in the source cluster regardless of which type holds the cross-subgraph reference, so with more than one entity per source subgraph every edge visually originates from the same (often wrong) node — a correctness defect in the diagram's core claim (which field references which entity). The source type name is available in the Rust edge id (SUBGRAPH:TypeName, split at web/src/schemaToEntityGraph.ts:99 but discarded). Fix: thread the source type name through schemaToEntityGraph from the Rust DTO (see RS-ENTITYEDGE) and match srcNode on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 edges originate from the entity node that actually holds the reference
- [ ] #2 a source subgraph with multiple entities renders distinct edge origins
<!-- AC:END -->
