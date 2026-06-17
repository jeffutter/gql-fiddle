---
id: TASK-62.1
title: >-
  refactor(rust): extend dto.rs and plan.rs to annotate PlanNode::Fetch with
  resolved_fields
status: To Do
assignee: []
created_date: '2026-06-17 04:31'
labels:
  - architecture
  - rust
  - wasm
dependencies: []
references:
  - crates/gql-core/src/plan.rs
  - crates/gql-core/src/dto.rs
parent_task_id: TASK-62
priority: medium
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the Rust half of TASK-62. `planToFieldRanges.ts` re-parses every Fetch sub-operation and the original query using `graphql-js` to map fields to their resolving subgraph. The Rust `plan.rs` already has both the parsed `ExecutableDocument` and each Fetch's operation string in memory when building the plan tree.

## Goal

Annotate each `PlanNode::Fetch` DTO with `resolved_fields` so the web layer only needs to place Monaco editor decorations rather than re-implement field resolution logic.

## Implementation guidance

**`dto.rs`** — add a new struct and extend the Fetch variant:
```rust
#[derive(Serialize)]
pub struct ResolvedField {
    pub field_name: String,
    pub type_condition: Option<String>,  // set for entity fetches (inline fragment type)
}
```
Add `resolved_fields: Vec<ResolvedField>` to the `Fetch` variant in `PlanNode`.

**`plan.rs`** — in `map_fetch()`:
- Parse the Fetch `operation` string with `apollo_compiler` (or re-use the already-parsed document if accessible)
- Walk the selection set of the operation
- If the top-level field is `_entities`: for each `... on TypeName` inline fragment, record fields under that fragment with `type_condition = Some("TypeName")`
- Otherwise: record top-level fields with `type_condition = None`
- Populate `resolved_fields` in the returned `PlanNode::Fetch`

## Output

Each Fetch node in the plan JSON gains a new field:
```json
{
  "kind": "Fetch",
  "service_name": "products",
  "operation": "...",
  "resolved_fields": [
    { "field_name": "price", "type_condition": null },
    { "field_name": "name",  "type_condition": "Product" }
  ]
}
```

TASK-62.2 and TASK-63 both consume this output. TASK-63 extends this same struct further — implement in this ticket first so TASK-63 can build on top.
<!-- SECTION:DESCRIPTION:END -->
