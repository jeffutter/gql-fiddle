---
id: TASK-62
title: 'refactor(rust): move field-to-service attribution into plan() Rust layer'
status: To Do
assignee: []
created_date: '2026-06-17 04:31'
labels:
  - architecture
  - rust
  - wasm
dependencies: []
references:
  - web/src/planToFieldRanges.ts
  - crates/gql-core/src/plan.rs
  - crates/gql-core/src/dto.rs
  - web/src/core/types.ts
priority: medium
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`planToFieldRanges.ts` is the most complex analysis living in the web layer. It:
1. Re-parses every `Fetch` node's sub-operation string using `graphql-js`
2. Re-parses the original query using `graphql-js`
3. Detects entity fetches by inspecting `_entities` at the top level
4. Matches field names between sub-operations and the original query to determine which subgraph resolves each field
5. Extracts source positions (`loc.startToken.line`/`column`) for Monaco editor decorations

The Rust `plan.rs` already has both the full `ExecutableDocument` (parsed during planning) and every `Fetch` node's operation string in memory. The query planner itself knows which service resolves what — that information just isn't surfaced in the DTO.

## Goal

Annotate each `PlanNode::Fetch` in the DTO with `resolved_fields` so the web layer only handles Monaco editor decoration placement (a pure UI concern) rather than re-implementing field resolution logic.

## Shape of the change

**Rust side (`crates/gql-core/`):**
- Add `resolved_fields: Vec<ResolvedField>` to `PlanNode::Fetch` variant in `dto.rs`, where `ResolvedField` carries `{ field_path: String, type_name: Option<String> }`
- In `plan.rs` `map_fetch()`, walk the Fetch sub-operation AST to populate `resolved_fields`, detecting entity fetches via `_entities` and extracting inline fragment type conditions

**Web side (`web/src/`):**
- Update `core/types.ts` to add `resolvedFields` on the `Fetch` plan node type
- Refactor `planToFieldRanges.ts` to consume `resolvedFields` from the plan, removing all `graphql-js` re-parsing; only Monaco source-position decoration logic remains
<!-- SECTION:DESCRIPTION:END -->
