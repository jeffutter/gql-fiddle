---
id: TASK-103
title: Fix cross-subgraph entity edges dropped for multi-type subgraph pairs
status: Backlog
assignee: []
created_date: '2026-07-01 00:28'
labels:
  - review
dependencies: []
priority: medium
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crates/gql-core/src/compose.rs:224-231 dedups entity edges with key '{src}->{tgt}' omitting the target type, despite the comment claiming the key mirrors 'SRC->TGT:TargetType'. When subgraph A references two different entity types owned by B, only the first edge is emitted; the rest are swallowed by edge_set.insert. The TS consumer (web/src/schemaToEntityGraph.ts:105) reconstructs an id including the target type and expects one edge per target type. Fix: include the target type in the edge key (format\!("{}->{}:{}", src_sg, tgt_sg, ret_type)). While here, also carry the source type name through the edge DTO — needed by the entity-graph source-node fix (VIZ-ENTITYSRC).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a schema where A references two B-owned entities yields two distinct entity edges
- [ ] #2 the edge DTO exposes the source type name
- [ ] #3 entity-graph tests updated
<!-- AC:END -->
