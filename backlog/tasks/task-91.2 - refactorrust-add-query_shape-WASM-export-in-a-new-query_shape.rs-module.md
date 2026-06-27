---
id: TASK-91.2
title: 'refactor(rust): add query_shape() WASM export in a new query_shape.rs module'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-27 17:15'
updated_date: '2026-06-27 18:25'
labels:
  - rust
  - wasm
  - planned
dependencies:
  - TASK-91.1
  - TASK-90.2
references:
  - web/src/queryToQueryShape.ts
  - crates/gql-core/src/validate.rs
  - crates/gql-core/src/plan.rs
  - crates/gql-core/src/lib.rs
  - crates/gql-core/src/dto.rs
parent_task_id: TASK-91
priority: medium
ordinal: 91200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the Rust half of TASK-91. TASK-91.1 (snapshot tests) and TASK-90.2 (which adds `SchemaTreeField` to `dto.rs`) must both be complete before this task begins.

The JS function being replaced is `queryToQueryShape(apiSchemaSdl: string, query: string): QueryShapeTree` in `web/src/queryToQueryShape.ts`. Read that file in full before implementing — it documents the exact semantics including:
- Fragment inlining (fragment spreads are expanded inline, not wrapped)
- Inline fragment rendering as `"… on TypeName"` children
- `__typename` introspection field handled as an unknown field (leaf, no crash)
- Named vs anonymous operation headers (`"query GetUser"` vs `"query"`)
- Schema SDL is the **API schema** (clean, no federation directives) — not the supergraph SDL

## New module: `crates/gql-core/src/query_shape.rs`

Create this file. It will be `mod query_shape;` in `lib.rs`.

### `pub fn query_shape(api_schema_sdl: &str, query: &str) -> serde_json::Value`

1. **Parse the API schema SDL** using `apollo_compiler::Schema::builder().parse(api_schema_sdl, "api.graphql").build()`. Return `json!({ "operations": [] })` on failure.
2. **Parse the query** using `apollo_compiler::ExecutableDocument::parse_and_validate(&schema, query, "query.graphql")`. Return `json!({ "operations": [] })` on failure.
3. **Build a type map** from the parsed schema: for each named type in the schema, determine its kind (object, interface, union, scalar, enum) and collect its fields (name, type reference) or union members. The API schema has no federation directives, so no filtering needed beyond built-in scalar exclusion.
4. **Walk each OperationDefinition** in the query document:
   - Compute `header`: `"{operation_kind} {name}"` if named, else just `"{operation_kind}"`
   - Determine root type name: `"Query"`, `"Mutation"`, or `"Subscription"` based on `operation.operation_type`
   - Call a recursive `build_shape_fields(selection_set, parent_type_name, &type_map, &fragment_map)` helper
5. **`build_shape_fields`** mirrors the JS `buildShapeFields` exactly:
   - `Field` selection: look up the field in the parent type's fields. If found, extract `typeName`, `isList`, `isNonNull`, recurse for non-leaf. If not found (e.g. `__typename`), emit a leaf with `typeName` equal to field name (or `"__typename"` for introspection).
   - `FragmentSpread`: look up the named fragment in `fragment_map`, recurse into its `selection_set` using the fragment's type condition — emit children directly (no wrapper node for the spread).
   - `InlineFragment`: emit a `"… on TypeName"` (U+2026) child node with children from the fragment's selection set. Use the type condition's name, or `parentTypeName` if absent.
6. **Collect all `FragmentDefinition`s** into a `fragment_map: HashMap<&str, &FragmentDefinition>` before walking operations.
7. **Return** `json!({ "operations": [...] })` where each operation is `{ "header": ..., "fields": [...] }`.

## Reuse `SchemaTreeField` from TASK-90.2

The output field shape is identical to `SchemaTreeField` in `dto.rs`. Re-use that type for the `fields` arrays in the output. The `QueryShapeOperation` wrapper only adds `header`.

Add a new DTO to `dto.rs`:
```rust
#[derive(Debug, serde::Serialize)]
pub struct QueryShapeOperation {
    pub header: String,
    pub fields: Vec<SchemaTreeField>,
}

#[derive(Debug, serde::Serialize)]
pub struct QueryShapeTree {
    pub operations: Vec<QueryShapeOperation>,
}
```

## Wire into `lib.rs`

```rust
mod query_shape;

#[wasm_bindgen]
pub fn query_shape(api_schema_sdl: &str, query: &str) -> String {
    query_shape::query_shape(api_schema_sdl, query).to_string()
}
```

## Rust tests to add

In `query_shape.rs` `#[cfg(test)]` block, add:
- Empty input returns `{ operations: [] }`
- Simple scalar query returns a single operation with one leaf field
- Named operation produces the correct `header`
- Fragment spread is inlined (no wrapper node)
- Inline fragment produces `"… on TypeName"` child
- `__typename` field is handled as a leaf without panic
- List and non-null flags are correct
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 crates/gql-core/src/query_shape.rs exists and is wired via mod query_shape in lib.rs
- [x] #2 query_shape is exported as a #[wasm_bindgen] function in lib.rs
- [x] #3 cargo test -p gql-core passes with all new and existing tests
- [x] #4 The export returns { operations: [] } for empty, invalid SDL, and invalid query inputs without panicking
- [x] #5 Fragment spreads are inlined — no wrapper node in the output (verified by Rust test)
- [x] #6 Inline fragments produce children with fieldName starting with the UTF-8 ellipsis character …
- [x] #7 QueryShapeOperation and QueryShapeTree DTO types added to dto.rs and reuse SchemaTreeField
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plan: Add query_shape() WASM export in Rust

### Prerequisites

- TASK-91.1 (snapshot tests) must be complete — the snapshots are the regression guard
- TASK-90.2 is already done — `SchemaTreeField`, `SchemaTreeNode`, `SchemaTree` are already in `dto.rs`

### Step 1: Add DTO types to `crates/gql-core/src/dto.rs`

Append two new structs after the existing `SchemaTree` block:

```rust
/// One operation entry in the query shape tree.
#[derive(Debug, serde::Serialize)]
pub struct QueryShapeOperation {
    /// e.g. "query GetUser" or "query"
    pub header: String,
    /// Top-level selected fields (reuses SchemaTreeField for identical shape).
    pub fields: Vec<SchemaTreeField>,
}

/// The query shape tree: only the fields selected by the active query.
#[derive(Debug, serde::Serialize)]
pub struct QueryShapeTree {
    /// One entry per OperationDefinition in the query document.
    pub operations: Vec<QueryShapeOperation>,
}
```

No `serde(rename)` needed on the outer structs; `header` and `fields` are already camelCase compatible. The inner `SchemaTreeField` fields are already `#[serde(rename)]`'d.

### Step 2: Create `crates/gql-core/src/query_shape.rs`

```rust
//! Query-driven schema slice: computes the shape of a query's response fields.
//!
//! Mirrors the JS `queryToQueryShape` function in `web/src/queryToQueryShape.ts`.
//! The API schema SDL is the clean, federation-free client schema — no filtering needed.

use apollo_compiler::{ExecutableDocument, Schema};
use apollo_compiler::ast::OperationType;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::dto::{QueryShapeOperation, QueryShapeTree, SchemaTreeField};
```

#### Internal type map

Build a `HashMap<String, TypeInfo>` from the parsed schema:

```rust
enum TypeKind { Object, Interface, Union, Scalar, Enum }

struct FieldInfo {
    name: String,
    type_name: String,   // unwrapped named type
    is_list: bool,
    is_non_null: bool,
}

struct TypeInfo {
    kind: TypeKind,
    fields: Vec<FieldInfo>,
    members: Vec<String>,  // union member type names
}
```

Walk `schema.types` using `apollo_compiler::schema::ExtendedType` variants:
- `Object(obj)` → kind Object, collect `obj.fields` (iterate `name, field_def`, extract `field_def.ty` for is_list/is_non_null/inner_named_type)
- `Interface(iface)` → kind Interface
- `Union(u)` → kind Union, collect `u.members` names
- `ScalarType(_)` → kind Scalar (skip built-ins: String/Boolean/Int/Float/ID)
- `EnumType(_)` → kind Enum
- Skip all `is_federation_internal` names (but this is the API schema — shouldn't have any)

#### Type flag helpers (mirror JS `typeFlags` / `namedTypeName`)

Use `apollo_compiler::ty::Type` methods:
- `ty.is_list()` → `is_list`
- outermost wrapper is_non_null: `matches!(ty, Type::NonNull(_))`
- `ty.inner_named_type().as_str()` → `type_name`

#### `pub fn query_shape(api_schema_sdl: &str, query: &str) -> Value`

```rust
pub fn query_shape(api_schema_sdl: &str, query: &str) -> Value {
    if api_schema_sdl.is_empty() || query.trim().is_empty() {
        return json!({ "operations": [] });
    }

    // 1. Parse the API schema (clean, no federation directives)
    let schema = match Schema::parse_and_validate(api_schema_sdl, "api.graphql") {
        Ok(s) => s,
        Err(_) => return json!({ "operations": [] }),
    };

    // 2. Parse and validate the query document
    let doc = match ExecutableDocument::parse_and_validate(&schema, query, "query.graphql") {
        Ok(d) => d,
        Err(_) => return json!({ "operations": [] }),
    };

    // 3. Build type map
    let type_map = build_type_map(&schema);

    // 4. Collect fragment definitions
    let fragment_map: HashMap<&str, &_> = doc.fragments.iter()
        .map(|(name, frag)| (name.as_str(), frag))
        .collect();

    // 5. Walk each operation
    let mut operations: Vec<QueryShapeOperation> = Vec::new();
    for (name, op) in &doc.named_operations {
        let op_kind = match op.operation_type {
            OperationType::Query => "query",
            OperationType::Mutation => "mutation",
            OperationType::Subscription => "subscription",
        };
        let header = match name {
            Some(n) => format!("{} {}", op_kind, n),
            None => op_kind.to_string(),
        };
        let root_type = match op.operation_type {
            OperationType::Query => "Query",
            OperationType::Mutation => "Mutation",
            OperationType::Subscription => "Subscription",
        };
        let fields = build_shape_fields(&op.selection_set, root_type, &type_map, &fragment_map);
        operations.push(QueryShapeOperation { header, fields });
    }
    // Also handle the anonymous operation if present
    if let Some(anon) = &doc.anonymous_operation {
        let op_kind = match anon.operation_type {
            OperationType::Query => "query",
            OperationType::Mutation => "mutation",
            OperationType::Subscription => "subscription",
        };
        let root_type = match anon.operation_type {
            OperationType::Query => "Query",
            OperationType::Mutation => "Mutation",
            OperationType::Subscription => "Subscription",
        };
        let fields = build_shape_fields(&anon.selection_set, root_type, &type_map, &fragment_map);
        operations.push(QueryShapeOperation { header: op_kind.to_string(), fields });
    }

    let tree = QueryShapeTree { operations };
    serde_json::to_value(&tree).unwrap_or_else(|_| json!({ "operations": [] }))
}
```

#### `build_shape_fields` recursive helper

Mirrors JS `buildShapeFields` exactly:

```rust
fn build_shape_fields(
    selection_set: &apollo_compiler::executable::SelectionSet,
    parent_type_name: &str,
    type_map: &HashMap<String, TypeInfo>,
    fragment_map: &HashMap<&str, &FragmentDefinition>,
) -> Vec<SchemaTreeField> {
    let mut result = Vec::new();
    for selection in &selection_set.selections {
        match selection {
            Selection::Field(field) => {
                let field_name = field.name.as_str();
                if let Some(parent_info) = type_map.get(parent_type_name) {
                    if let Some(field_def) = parent_info.fields.iter().find(|f| f.name == field_name) {
                        let type_name = field_def.type_name.clone();
                        let is_leaf = is_leaf_type(&type_name, type_map);
                        let children = if !is_leaf {
                            if let Some(ss) = &field.selection_set {
                                build_shape_fields(ss, &type_name, type_map, fragment_map)
                            } else { vec![] }
                        } else { vec![] };
                        result.push(SchemaTreeField {
                            field_name: field_name.to_string(),
                            type_name,
                            is_list: field_def.is_list,
                            is_non_null: field_def.is_non_null,
                            is_leaf,
                            is_cycle_ref: false,
                            children,
                        });
                    } else {
                        // Unknown field (e.g. __typename introspection)
                        result.push(SchemaTreeField {
                            field_name: field_name.to_string(),
                            type_name: if field_name == "__typename" { "__typename" } else { field_name }.to_string(),
                            is_list: false, is_non_null: false, is_leaf: true,
                            is_cycle_ref: false, children: vec![],
                        });
                    }
                } else {
                    // Parent type not in type_map — emit as leaf
                    result.push(SchemaTreeField {
                        field_name: field_name.to_string(),
                        type_name: field_name.to_string(),
                        is_list: false, is_non_null: false, is_leaf: true,
                        is_cycle_ref: false, children: vec![],
                    });
                }
            }
            Selection::FragmentSpread(spread) => {
                // Inline the named fragment's fields — no wrapper node
                if let Some(frag) = fragment_map.get(spread.fragment_name.as_str()) {
                    let frag_type = frag.type_condition().name.as_str();
                    let inlined = build_shape_fields(&frag.selection_set, frag_type, type_map, fragment_map);
                    result.extend(inlined);
                }
            }
            Selection::InlineFragment(inline) => {
                // Emit a "… on TypeName" wrapper node with children
                let type_cond = inline.type_condition()
                    .map(|tc| tc.name.as_str())
                    .unwrap_or(parent_type_name);
                let children = build_shape_fields(&inline.selection_set, type_cond, type_map, fragment_map);
                result.push(SchemaTreeField {
                    field_name: format!("\u{2026} on {}", type_cond),  // U+2026 ellipsis
                    type_name: type_cond.to_string(),
                    is_list: false, is_non_null: false, is_leaf: false,
                    is_cycle_ref: false, children,
                });
            }
        }
    }
    result
}
```

#### `is_leaf_type` helper

```rust
const BUILTIN_SCALARS: &[&str] = &["String", "Boolean", "Int", "Float", "ID"];

fn is_leaf_type(type_name: &str, type_map: &HashMap<String, TypeInfo>) -> bool {
    if BUILTIN_SCALARS.contains(&type_name) { return true; }
    match type_map.get(type_name) {
        None => true,  // unknown type treated as leaf
        Some(info) => matches!(info.kind, TypeKind::Scalar | TypeKind::Enum),
    }
}
```

#### Unit tests in `#[cfg(test)]` block

- Empty SDL returns `{ "operations": [] }`
- Empty query returns `{ "operations": [] }`
- Invalid SDL returns `{ "operations": [] }`
- Simple scalar query: one operation, one leaf field, correct typeName/isLeaf
- Named operation: header is "query OpName"
- Anonymous operation: header is "query"
- Fragment spread is inlined (no wrapper node)
- Inline fragment produces "… on TypeName" child
- __typename is a leaf without panic
- List and NonNull flags correct

### Step 3: Wire into `crates/gql-core/src/lib.rs`

Add `mod query_shape;` to the module list and add the export:

```rust
mod query_shape;

#[wasm_bindgen]
pub fn query_shape(api_schema_sdl: &str, query: &str) -> String {
    query_shape::query_shape(api_schema_sdl, query).to_string()
}
```

### Step 4: Verify

```bash
cargo test -p gql-core
```

All new and existing tests must pass. Check that the anonymous operation path works (the JS has no wrapper distinction; `doc.anonymous_operation` may be a separate field in apollo-compiler vs `doc.named_operations`). Read the apollo-compiler `ExecutableDocument` API carefully — the document walker API may differ slightly from the pseudocode above; adjust as needed while keeping semantics identical to the JS.

### Key implementation risks

- **apollo-compiler API surface**: `ExecutableDocument` field access, `SelectionSet` iteration, `FragmentDefinition` API may differ from the pseudocode. Consult `validate.rs` and `plan.rs` for working examples of how these types are used.
- **Anonymous vs named operations**: `doc.anonymous_operation` and `doc.named_operations` are separate fields. The JS document walker iterates `queryDoc.definitions` in order. The Rust output order must match (anonymous first or named in definition order).
- **`parse_and_validate` vs `parse`**: For the API schema (a clean schema, no federation), `Schema::parse_and_validate` is appropriate. For the query, `ExecutableDocument::parse_and_validate` validates against the schema — invalid queries return `Err`, which we map to `{ "operations": [] }`.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created crates/gql-core/src/query_shape.rs with pub fn query_shape(api_schema_sdl, query) -> Value. Added QueryShapeOperation and QueryShapeTree DTOs to dto.rs. Wired query_shape() as a #[wasm_bindgen] export in lib.rs. Used ExecutableDocument::parse (not parse_and_validate) to match JS permissiveness for queries with missing optional arguments. The implementation uses field.definition.ty directly from the linked ExecutableDocument (no separate type map needed), special-cases __typename to emit typeName: \"__typename\" with isList/isNonNull both false (matching JS behavior), inlines fragment spreads without a wrapper node, and wraps inline fragments with \"… on TypeName\" nodes. All 17 Rust unit tests in query_shape.rs pass; cargo test -p gql-core runs 92 tests with no failures.
<!-- SECTION:FINAL_SUMMARY:END -->
