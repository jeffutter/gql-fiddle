---
id: TASK-90.2
title: 'refactor(rust): add schema_tree to compose() result in compose.rs and dto.rs'
status: Done
assignee: []
created_date: '2026-06-27 17:13'
updated_date: '2026-06-27 18:03'
labels:
  - rust
  - wasm
dependencies:
  - TASK-90.1
references:
  - crates/gql-core/src/compose.rs
  - crates/gql-core/src/dto.rs
  - web/src/schemaToSchemaTree.ts
parent_task_id: TASK-90
priority: medium
ordinal: 90200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the Rust half of TASK-90. TASK-90.1 must be complete first so snapshot tests exist before the implementation changes. This task adds `schema_tree` to the Rust `compose()` return value — parallel to how TASK-61 added `entity_graph` and `type_graph`.

The JS function being replaced is `schemaToSchemaTree(supergraphSdl: string): SchemaTree` in `web/src/schemaToSchemaTree.ts`. Read that file carefully to understand the exact semantics: federation-internal filtering, cycle detection via ancestor path sets, union "… on X" children, list/non-null flag extraction, leaf detection (scalars, enums, custom scalars).

## What to build

### `dto.rs` — new types

Add these serde-serializable structs. `SchemaTreeField` is recursive so `children` must be `Vec<SchemaTreeField>` (serde handles this; no `Box` needed for serialization, though `Box` may be required for the Rust type to be `Sized` — use judgment):

```rust
#[derive(Debug, serde::Serialize)]
pub struct SchemaTreeField {
    #[serde(rename = "fieldName")]
    pub field_name: String,
    #[serde(rename = "typeName")]
    pub type_name: String,
    #[serde(rename = "isList")]
    pub is_list: bool,
    #[serde(rename = "isNonNull")]
    pub is_non_null: bool,
    #[serde(rename = "isLeaf")]
    pub is_leaf: bool,
    #[serde(rename = "isCycleRef")]
    pub is_cycle_ref: bool,
    pub children: Vec<SchemaTreeField>,
}

#[derive(Debug, serde::Serialize)]
pub struct SchemaTreeNode {
    #[serde(rename = "rootTypeName")]
    pub root_type_name: String,  // "Query" | "Mutation" | "Subscription"
    pub fields: Vec<SchemaTreeField>,
}

#[derive(Debug, serde::Serialize)]
pub struct SchemaTree {
    pub roots: Vec<SchemaTreeNode>,
}
```

### `compose.rs` — new function `build_schema_tree`

Add `pub(crate) fn build_schema_tree(sdl: &str) -> SchemaTree` following the same structure as `build_entity_graph` and `build_type_graph`:

1. Parse the SDL with `apollo_compiler::Schema::builder().adopt_orphan_extensions().ignore_builtin_redefinitions().parse(sdl, "supergraph.graphql").build()`. Return `SchemaTree { roots: vec![] }` on parse failure.
2. Collect all named types into a type map (object, interface, union, scalar, enum) — exclude types where `is_federation_internal(name)` is true or `is_builtin_scalar(name)` is true. Also exclude `Query`, `Mutation`, `Subscription` from the general type map since they are roots.
3. For each of `["Query", "Mutation", "Subscription"]`, look up the root type in the schema. Skip if absent. Collect its fields, then call a recursive helper.
4. Recursive helper `build_children(type_name, schema, ancestor_path)`:
   - If `type_name` is in `ancestor_path` → return a cycle-ref leaf: `SchemaTreeField { field_name: name, type_name, is_list, is_non_null, is_leaf: false, is_cycle_ref: true, children: vec![] }`
   - For union types: iterate `types` and produce `fieldName: "… on MemberType"` children (use the `…` character U+2026, not `...`)
   - For object/interface types: iterate fields, skip federation-internal field names, extract `is_list` and `is_non_null` from the field's type, recurse for non-leaf types
   - Leaf determination: builtin scalars (`String`, `Boolean`, `Int`, `Float`, `ID`), custom scalar types, and enum types are leaves
5. Add `ancestor_path.insert(type_name)` before recursing and `ancestor_path.remove(type_name)` after — same as the JS `Set`-based approach.
6. Wire `build_schema_tree` into the `compose()` success path in `compose.rs` (called with `supergraph_sdl` after composition), serialize as `"schema_tree"`.

### Existing test to update

The `success_path_keys_match_contract` test in `compose.rs` asserts an exact set of keys. Add `"schema_tree"` to that set.

### New Rust tests to add

Add at minimum:
- A test that composes a minimal two-type schema and asserts `schema_tree.roots` contains a `Query` node with the expected fields
- A test that verifies federation-internal types do NOT appear in `schema_tree`
- A test that verifies cycle detection: a self-referential type produces a `isCycleRef: true` node at the recursive position
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cargo test -p gql-core passes with no failures
- [x] #2 The compose success JSON includes a schema_tree field with roots, and roots contains SchemaTreeNode entries with correct rootTypeName and recursive fields
- [x] #3 success_path_keys_match_contract test updated to include schema_tree
- [x] #4 Federation-internal types are absent from schema_tree output (verified by new Rust test)
- [x] #5 Cycle detection test: self-referential type produces isCycleRef: true at the second occurrence
- [x] #6 Union members appear as children with fieldName matching the UTF-8 ellipsis (… on TypeName, not ... on TypeName)
- [x] #7 isList and isNonNull flags are correct for wrapped types ([T!]!, [T], T!, T)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added SchemaTreeField, SchemaTreeNode, SchemaTree structs to dto.rs with serde camelCase renaming. Added build_schema_tree(sdl: &str) -> SchemaTree in compose.rs using apollo_compiler::Schema for parsing; filters federation-internal types (join__, link__, _Service, _Any, _FieldSet, _Entity); cycle detection via mutable HashSet<String> ancestor_path (insert before recurse, remove after); union members emitted as '\u{2026} on MemberType' (U+2026 ellipsis). Wired into compose() success JSON as schema_tree. Updated success_path_keys_match_contract test. Added 3 Rust unit tests: schema_tree_basic_query_fields, schema_tree_excludes_federation_internal_types, schema_tree_cycle_detection. Also updated 3 insta integration snapshots to include schema_tree. cargo test -p gql-core: 77 passed, 1 ignored.
<!-- SECTION:NOTES:END -->
