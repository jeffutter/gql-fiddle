---
id: TASK-63
title: >-
  refactor(rust): annotate PlanNode::Fetch with entity_types, remove fragile
  string scanning from planToTimeline.ts
status: To Do
assignee: []
created_date: '2026-06-17 04:32'
labels:
  - architecture
  - rust
  - wasm
  - web
dependencies:
  - TASK-62.1
references:
  - web/src/planToTimeline.ts
  - crates/gql-core/src/plan.rs
  - crates/gql-core/src/dto.rs
  - web/src/core/types.ts
priority: medium
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`planToTimeline.ts` contains an `extractEntityTypes()` function that manually scans Fetch operation strings using balanced-paren parsing and regex to find `... on TypeName` inline fragments. This is a fragile workaround for not having a proper AST. The Rust `plan.rs` already parses each Fetch sub-operation as an `ExecutableDocument`; the entity type names are directly available there.

This task builds on TASK-62.1 which already adds `resolved_fields` to `PlanNode::Fetch` and parses the Fetch sub-operation in Rust. Rather than re-parsing again, this ticket extends that same pass to also collect entity type names.

## Goal

Add `entity_types: Vec<String>` to `PlanNode::Fetch` in `dto.rs`, populate it in `plan.rs` `map_fetch()`, and remove `extractEntityTypes()` from `planToTimeline.ts`.

## Implementation guidance

**`crates/gql-core/src/dto.rs`** — add to the `Fetch` variant:
```rust
pub entity_types: Vec<String>,
```

**`crates/gql-core/src/plan.rs`** — in `map_fetch()`, while already walking the sub-operation for `resolved_fields` (from TASK-62.1):
- If the top-level field is `_entities`, collect all distinct `... on TypeName` type conditions from the selection set into `entity_types`
- Otherwise `entity_types` is empty

**`web/src/core/types.ts`** — add to the `Fetch` variant:
```ts
entity_types: string[]
```

**`web/src/planToTimeline.ts`** — replace the call to `extractEntityTypes(operation)` with `node.entity_types`; delete the `extractEntityTypes` function and its balanced-paren/regex string scanner entirely.

## Verification

- Execution Timeline tab shows correct entity type names on subgraph fetch rows
- `extractEntityTypes` and all associated string-scanning code is deleted from `planToTimeline.ts`
<!-- SECTION:DESCRIPTION:END -->
