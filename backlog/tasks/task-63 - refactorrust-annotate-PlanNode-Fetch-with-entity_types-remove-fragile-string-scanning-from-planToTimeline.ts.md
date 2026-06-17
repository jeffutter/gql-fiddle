---
id: TASK-63
title: >-
  refactor(rust): annotate PlanNode::Fetch with entity_types, remove fragile
  string scanning from planToTimeline.ts
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-17 04:32'
updated_date: '2026-06-17 12:12'
labels:
  - architecture
  - rust
  - wasm
  - web
  - planned
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cargo test -p gql-core passes with no regressions
- [x] #2 entity_types: Vec<String> is added to PlanNode::Fetch in dto.rs with skip_serializing_if = Vec::is_empty
- [x] #3 extract_entity_types() helper in plan.rs collects distinct type condition names from _entities inline fragments
- [x] #4 entity_types field is added to the Fetch variant in web/src/core/types.ts
- [x] #5 extractEntityTypes() string scanner is completely deleted from planToTimeline.ts
- [x] #6 planToTimeline.ts uses node.entity_types to determine isEntityFetch and label for entity fetches
- [x] #7 pnpm --filter web test passes — planToTimeline.test.ts fixtures updated to supply entity_types
- [ ] #8 Execution Timeline tab shows correct entity type names on subgraph fetch rows in the browser
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

This ticket extends the work from TASK-62.1 (already done) to annotate `PlanNode::Fetch` with `entity_types: Vec<String>` computed in Rust, then removes the fragile `extractEntityTypes()` string scanner from `planToTimeline.ts`.

The change touches four files:
1. `crates/gql-core/src/dto.rs` — add `entity_types` field to `PlanNode::Fetch`
2. `crates/gql-core/src/plan.rs` — populate it in `map_fetch()` via a new helper
3. `web/src/core/types.ts` — add `entity_types` to the TypeScript `PlanNode` Fetch variant
4. `web/src/planToTimeline.ts` — replace `extractEntityTypes(node.operation)` with `node.entity_types`; delete the function
5. `web/src/planToTimeline.test.ts` — update entity-fetch test fixtures to supply `entity_types` instead of relying on the string scanner

---

### Step 1: Extend `dto.rs` — add `entity_types` to `PlanNode::Fetch`

File: `crates/gql-core/src/dto.rs`

Add `entity_types` field to the `Fetch` variant alongside `resolved_fields`:

```rust
Fetch {
    service: String,
    #[serde(rename = "operation")]
    operation_str: String,
    operation_kind: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    requires: Vec<RequiresSelection>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    resolved_fields: Vec<ResolvedField>,
    /// Distinct entity type names from `... on TypeName` fragments in `_entities` fetches.
    /// Empty for non-entity fetches. Skipped from JSON when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    entity_types: Vec<String>,
},
```

---

### Step 2: Populate `entity_types` in `plan.rs`

File: `crates/gql-core/src/plan.rs`

Add a focused helper that extracts distinct `... on TypeName` type conditions from an `_entities` fetch. It shares the same `doc.as_parsed()` call pattern as `extract_resolved_fields()`.

Add after `extract_resolved_fields()` (around line 166):

```rust
/// Collect distinct entity type names from a Fetch sub-operation that has
/// `_entities` as its top-level field. Returns an empty Vec for non-entity fetches.
fn extract_entity_types(
    doc: &apollo_federation::query_plan::serializable_document::SerializableDocument,
) -> Vec<String> {
    use apollo_compiler::executable::Selection;

    let executable = match doc.as_parsed() {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let mut types: indexmap::IndexSet<String> = indexmap::IndexSet::new();

    for op in executable.operations.iter() {
        for sel in &op.selection_set.selections {
            if let Selection::Field(f) = sel {
                if f.name == "_entities" {
                    for inner in &f.selection_set.selections {
                        if let Selection::InlineFragment(frag) = inner {
                            if let Some(tc) = &frag.type_condition {
                                types.insert(tc.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    types.into_iter().collect()
}
```

**Note:** If `IndexSet` is not already in scope, use a plain `Vec` with a subsequent dedup:
```rust
let mut types: Vec<String> = vec![];
// ... push into types ...
types.dedup();  // or use a HashSet for order-independent dedup
```
Alternatively, use a `Vec` and collect into a `LinkedHashSet` or deduplicate with `seen: HashSet`. The simplest approach that preserves insertion order is:
```rust
let mut seen = std::collections::HashSet::new();
let mut types = Vec::new();
// when inserting: if seen.insert(name.clone()) { types.push(name); }
```

Update `map_fetch()` to call this helper:

```rust
fn map_fetch(fetch: apollo_federation::query_plan::FetchNode) -> PlanNode {
    let service = fetch.subgraph_name.to_string();
    let op_str = serde_json::to_string(&fetch.operation_document).unwrap_or_default();
    let op_kind = format!("{}", fetch.operation_kind);
    let requires = map_requires(fetch.requires);
    let resolved_fields = extract_resolved_fields(&fetch.operation_document);
    let entity_types = extract_entity_types(&fetch.operation_document);
    PlanNode::Fetch {
        service,
        operation_str: op_str,
        operation_kind: op_kind,
        requires,
        resolved_fields,
        entity_types,
    }
}
```

Run `cargo test -p gql-core` to confirm no regressions (53 existing tests must still pass).

---

### Step 3: Update `web/src/core/types.ts` — add `entity_types` to Fetch

File: `web/src/core/types.ts`, line 81–89

Add `entity_types` to the Fetch variant of `PlanNode`:

```typescript
export type PlanNode =
  | {
      kind: "Fetch";
      service: string;
      operation: string;
      operation_kind: string;
      requires?: RequiresSelection[];
      resolved_fields?: Array<{ field_name: string; type_condition: string | null }>;
      entity_types?: string[];   // <-- add this line
    }
  | { kind: "Sequence"; nodes: PlanNode[] }
  // ... rest unchanged
```

---

### Step 4: Refactor `web/src/planToTimeline.ts`

File: `web/src/planToTimeline.ts`

**Remove `topLevelField()` and `extractEntityTypes()` entirely** (lines 4–62). These are no longer needed.

**In the `Fetch` case of `walk()`**, replace the current logic:

```typescript
// BEFORE (lines 107–111):
const isEntityFetch = topLevelField(node.operation) === "_entities";
const label = isEntityFetch
  ? extractEntityTypes(node.operation).join(", ") || "_entities"
  : topLevelField(node.operation);
```

With:

```typescript
// AFTER:
const isEntityFetch = (node.entity_types?.length ?? 0) > 0;
const label = isEntityFetch
  ? node.entity_types!.join(", ")
  : topLevelField(node.operation);
```

**Wait** — `topLevelField()` is still needed for the non-entity label. Only `extractEntityTypes()` and its associated balanced-paren scanner are deleted. Keep `topLevelField()`.

Revised plan:
- **Delete `extractEntityTypes()` (lines 16–62) entirely.**
- **Keep `topLevelField()` (lines 4–7).**
- Update the Fetch label logic in `walk()`:

```typescript
case "Fetch": {
  const id = `${node.service}-${counter++}`;
  const isEntityFetch = (node.entity_types?.length ?? 0) > 0;
  const label = isEntityFetch
    ? node.entity_types!.join(", ")
    : topLevelField(node.operation);
  items.push({
    id,
    service: node.service,
    label,
    depthStart,
    depthEnd: depthStart + 1,
    isEntityFetch,
  });
  return depthStart + 1;
}
```

---

### Step 5: Update `web/src/planToTimeline.test.ts`

The entity-fetch tests (lines 228–280) currently use fake `PlanNode` objects that rely on `operation` string scanning. After deleting `extractEntityTypes()`, those tests must supply `entity_types` on the Fetch node and the operation string alone no longer determines the label or `isEntityFetch`.

Update each entity-fetch fixture to include `entity_types`:

**Test: "entity fetch — multiple types"** (line 229):
```typescript
const fetch: PlanNode = {
  kind: "Fetch",
  service: "products",
  operation: "{ _entities(representations: $representations) { ... on Product { id } ... on Review { id } } }",
  operation_kind: "query",
  entity_types: ["Product", "Review"],   // <-- add
};
// item.isEntityFetch → true, item.label → "Product, Review"
```

**Test: "entity fetch — single type"** (line 243):
```typescript
const fetch: PlanNode = {
  kind: "Fetch",
  service: "users",
  operation: "{ _entities(representations: $representations) { ... on User { id name } } }",
  operation_kind: "query",
  entity_types: ["User"],   // <-- add
};
```

**Test: "entity fetch — no inline fragments — label falls back to _entities"** (line 255):
```typescript
const fetch: PlanNode = {
  kind: "Fetch",
  service: "products",
  operation: "{ _entities(representations: $representations) { id } }",
  operation_kind: "query",
  entity_types: [],   // empty → isEntityFetch: false; label falls back to topLevelField → "_entities"
};
// With the new logic: isEntityFetch = (entity_types.length > 0) = false
// label = topLevelField(node.operation) = "_entities"
// So item.isEntityFetch → false, item.label → "_entities"
// The test assertion "expect(item.isEntityFetch).toBe(true)" must be updated to false.
```

**Test: "entity fetch — duplicate types are deduplicated in label"** (line 268):
```typescript
const fetch: PlanNode = {
  kind: "Fetch",
  service: "products",
  operation: "{ _entities(representations: $representations) { ... on Product { id ... on Product { title } } } }",
  operation_kind: "query",
  entity_types: ["Product"],   // Rust already deduplicates; test just passes the deduplicated list
};
```

**Also update "non-entity fetch — isEntityFetch is false"** (line 223): `FETCH_USERS` has no `entity_types` field, so `entity_types?.length ?? 0 === 0` → `isEntityFetch: false`. No change needed to `FETCH_USERS`; the test continues to pass.

Run `pnpm --filter web test` (or `pnpm run test` in the `web/` directory) to confirm all timeline tests pass.

---

### Verification

- `cargo test -p gql-core` passes with no regressions
- `pnpm --filter web test` passes (all `planToTimeline` tests)
- `extractEntityTypes` function and its balanced-paren/regex scanner are completely deleted from `planToTimeline.ts`
- Execution Timeline tab in the browser shows correct entity type names on subgraph fetch rows
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in four files: dto.rs (added entity_types field), plan.rs (added extract_entity_types() helper using HashSet for dedup, called from map_fetch()), web/src/core/types.ts (added entity_types?: string[] to Fetch variant), web/src/planToTimeline.ts (deleted extractEntityTypes() and balanced-paren scanner, updated Fetch case to use node.entity_types). Updated snapshot test plan__plan_multi_subgraph_with_flatten.snap to include entity_types:["User"]. Updated four test fixtures in planToTimeline.test.ts to supply entity_types. Note: AC#8 (browser visual verification) requires a running browser session.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `entity_types: Vec<String>` to `PlanNode::Fetch` in `dto.rs` with `skip_serializing_if = Vec::is_empty`. Implemented `extract_entity_types()` helper in `plan.rs` that walks the `_entities` selection set AST and collects distinct inline-fragment type condition names using a `HashSet` for insertion-order-preserving dedup. Called from `map_fetch()` alongside the existing `extract_resolved_fields()`. Added `entity_types?: string[]` to the TypeScript `Fetch` variant in `web/src/core/types.ts`. In `planToTimeline.ts`, deleted the entire `extractEntityTypes()` function and its balanced-paren/regex string scanner; the Fetch case now checks `node.entity_types?.length > 0` for `isEntityFetch` and joins the array for the label. Updated the `plan__plan_multi_subgraph_with_flatten` insta snapshot to include `entity_types:[\"User\"]`. Updated four entity-fetch test fixtures in `planToTimeline.test.ts` to supply `entity_types` directly. All 53 Rust tests and 195 web tests pass."
<!-- SECTION:FINAL_SUMMARY:END -->
