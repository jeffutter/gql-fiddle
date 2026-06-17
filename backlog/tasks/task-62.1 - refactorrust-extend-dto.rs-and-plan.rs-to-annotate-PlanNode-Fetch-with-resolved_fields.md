---
id: TASK-62.1
title: >-
  refactor(rust): extend dto.rs and plan.rs to annotate PlanNode::Fetch with
  resolved_fields
status: Done
assignee: []
created_date: '2026-06-17 04:31'
updated_date: '2026-06-17 12:00'
labels:
  - architecture
  - rust
  - wasm
  - planned
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 cargo test -p gql-core passes with no regressions
- [ ] #2 A non-entity Fetch node in the plan JSON includes `resolved_fields: [{field_name, type_condition: null}, ...]` for top-level fields
- [ ] #3 An entity Fetch node includes `resolved_fields` with `type_condition` set to the inline-fragment type name for each field
- [ ] #4 Fields `__typename` and `_entities` are excluded from `resolved_fields`
- [ ] #5 `resolved_fields` is omitted from the JSON when empty (serde skip_serializing_if)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

Add `resolved_fields: Vec<ResolvedField>` to the `Fetch` variant in `dto.rs`, then populate it in `map_fetch()` in `plan.rs` by walking the already-parsed `ExecutableDocument` stored inside `FetchNode.operation_document`.

The key insight: `operation_document` is a `SerializableDocument` built via `from_parsed()` by the Apollo query planner, so `as_parsed()` returns `Ok(Arc<Valid<ExecutableDocument>>)` — no re-parsing needed.

---

### Step 1: Add `ResolvedField` struct and extend `PlanNode::Fetch` in `dto.rs`

File: `crates/gql-core/src/dto.rs`

Add after the `RequiresSelection` enum (around line 31):

```rust
/// A field that a Fetch node resolves for the web layer's editor decorations.
#[derive(Debug, serde::Serialize)]
pub struct ResolvedField {
    /// The field name as it appears in the original query (not the sub-operation alias).
    pub field_name: String,
    /// Set for entity fetches: the inline-fragment type condition (`... on Product` → `"Product"`).
    /// `None` for plain (non-entity) fetches.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_condition: Option<String>,
}
```

Extend `PlanNode::Fetch` (around line 41):

```rust
Fetch {
    service: String,
    #[serde(rename = "operation")]
    operation_str: String,
    operation_kind: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    requires: Vec<RequiresSelection>,
    /// Fields this Fetch resolves, pre-computed in Rust for the web layer.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    resolved_fields: Vec<ResolvedField>,
},
```

---

### Step 2: Populate `resolved_fields` in `map_fetch()` in `plan.rs`

File: `crates/gql-core/src/plan.rs`

Add `ResolvedField` to the existing import:

```rust
use crate::dto::{DeferredBranch, PlanNode, RequiresSelection, ResolvedField};
```

Add a new private helper function `collect_resolved_fields()`:

```rust
/// Walk the Fetch sub-operation's top-level selection to extract resolved field names.
///
/// - Non-entity fetch: walk top-level selections and collect field names with `type_condition = None`.
/// - Entity fetch (top-level field is `_entities`): for each `... on TypeName` inline fragment
///   inside `_entities`, collect the fields within that fragment with `type_condition = Some("TypeName")`.
///
/// Uses the pre-parsed `ExecutableDocument` from `FetchNode.operation_document` — no re-parse.
fn collect_resolved_fields(
    op_doc: &apollo_compiler::validation::Valid<apollo_compiler::ExecutableDocument>,
) -> Vec<ResolvedField> {
    use apollo_compiler::executable::Selection;

    let mut out = Vec::new();

    for op in op_doc.operations.iter() {
        let selections = &op.1.selection_set.selections;

        // Check if top-level is `_entities` (entity fetch)
        let is_entity_fetch = selections.iter().any(|sel| {
            matches!(sel, Selection::Field(f) if f.name.as_str() == "_entities")
        });

        if is_entity_fetch {
            for sel in selections {
                if let Selection::Field(field) = sel {
                    if field.name.as_str() == "_entities" {
                        for inner in &field.selection_set.selections {
                            if let Selection::InlineFragment(frag) = inner {
                                let type_cond = frag
                                    .type_condition
                                    .as_ref()
                                    .map(|t| t.to_string());
                                collect_selection_fields(
                                    &frag.selection_set.selections,
                                    type_cond.as_deref(),
                                    &mut out,
                                );
                            }
                        }
                    }
                }
            }
        } else {
            collect_selection_fields(selections, None, &mut out);
        }
    }

    out
}

/// Recursively collect field names from a selection set into `out`.
/// `type_condition` is `Some("TypeName")` for entity fetch fragments, `None` otherwise.
/// Skips `__typename` and `_entities` (planner-injected fields not visible in original query).
fn collect_selection_fields(
    selections: &[apollo_compiler::executable::Selection],
    type_condition: Option<&str>,
    out: &mut Vec<ResolvedField>,
) {
    use apollo_compiler::executable::Selection;
    for sel in selections {
        match sel {
            Selection::Field(f) => {
                let name = f.name.as_str();
                if name != "__typename" && name != "_entities" {
                    out.push(ResolvedField {
                        field_name: name.to_string(),
                        type_condition: type_condition.map(str::to_string),
                    });
                }
                // Recurse into nested selections (for deeper fields, not needed for top-level
                // attribution but keeps the data complete)
                if !f.selection_set.selections.is_empty() {
                    collect_selection_fields(
                        &f.selection_set.selections,
                        type_condition,
                        out,
                    );
                }
            }
            Selection::InlineFragment(frag) => {
                let inner_type = frag
                    .type_condition
                    .as_ref()
                    .map(|t| t.to_string())
                    .or_else(|| type_condition.map(str::to_string));
                collect_selection_fields(
                    &frag.selection_set.selections,
                    inner_type.as_deref(),
                    out,
                );
            }
            Selection::FragmentSpread(_) => {
                // Fetch sub-operations produced by the query planner do not use
                // named fragment spreads — inline fragments only. Safe to skip.
            }
        }
    }
}
```

Update `map_fetch()` to call the helper and pass the result to `PlanNode::Fetch`:

```rust
fn map_fetch(fetch: apollo_federation::query_plan::FetchNode) -> PlanNode {
    let service = fetch.subgraph_name.to_string();
    let op_str = serde_json::to_string(&fetch.operation_document).unwrap_or_default();
    let op_kind = format!("{}", fetch.operation_kind);
    let requires = map_requires(fetch.requires);

    // Use the pre-parsed ExecutableDocument to extract resolved fields.
    // `as_parsed()` succeeds here because the query planner builds
    // SerializableDocument via `from_parsed()`.
    let resolved_fields = fetch
        .operation_document
        .as_parsed()
        .map(|doc| collect_resolved_fields(doc))
        .unwrap_or_default();

    PlanNode::Fetch {
        service,
        operation_str: op_str,
        operation_kind: op_kind,
        requires,
        resolved_fields,
    }
}
```

---

### Step 3: Verify with `cargo test`

Run the existing tests to confirm nothing regressed:

```bash
cargo test -p gql-core
```

The existing `plan_returns_ok_with_query_plan_tree` test validates the plan serializes correctly. The new `resolved_fields` field is `skip_serializing_if = "Vec::is_empty"` so it does not appear in plans that produce empty lists, which keeps the test assertions valid.

Optionally add a targeted test in `plan.rs::tests` to assert that a known two-subgraph plan produces non-empty `resolved_fields` in at least one Fetch.

---

### Notes

- `collect_selection_fields` does NOT need to recurse deeply for the web layer's current use case (field attribution is top-level), but recursing into nested fields makes the data richer for future consumers without changing the shape.
- TASK-63 will extend `map_fetch()` in the same place to also collect `entity_types`. To minimize merge pain, TASK-63 depends on this ticket completing first.
- The `ResolvedField` struct in `dto.rs` should also be imported by TASK-63 (it extends the same struct concept). If TASK-63 needs `entity_types: Vec<String>` on the Fetch DTO, it adds a separate field alongside `resolved_fields`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rust implementation was already complete: ResolvedField struct in dto.rs and extract_resolved_fields() helper in plan.rs walk the FetchNode operation_document AST without re-parsing. cargo test -p gql-core passes (53 tests).
<!-- SECTION:NOTES:END -->
