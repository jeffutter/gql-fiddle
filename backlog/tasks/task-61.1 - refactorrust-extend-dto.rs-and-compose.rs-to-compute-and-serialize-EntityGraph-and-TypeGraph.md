---
id: TASK-61.1
title: >-
  refactor(rust): extend dto.rs and compose.rs to compute and serialize
  EntityGraph and TypeGraph
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-17 04:31'
updated_date: '2026-06-17 11:45'
labels:
  - architecture
  - rust
  - wasm
  - planned
dependencies: []
references:
  - crates/gql-core/src/compose.rs
  - crates/gql-core/src/dto.rs
parent_task_id: TASK-61
priority: medium
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the Rust half of TASK-61. Currently `compose()` discards the fully-parsed supergraph immediately after serializing `supergraph_sdl`, `api_schema_sdl`, and `hints`. The web layer then re-parses the SDL with `graphql-js` in `schemaToEntityGraph.ts` and `schemaToTypeGraph.ts` to derive the same information from federation directives.

## Goal

Add `EntityGraph` and `TypeGraph` DTO structs and populate them inside `compose.rs` by walking the composed supergraph before returning.

## Implementation guidance

**`dto.rs`** — add:
```rust
#[derive(Serialize)]
pub struct GraphNode { pub id: String, pub label: String, pub subgraphs: Vec<String> }

#[derive(Serialize)]
pub struct GraphEdge { pub source: String, pub target: String, pub label: Option<String> }

#[derive(Serialize)]
pub struct EntityGraph { pub nodes: Vec<GraphNode>, pub edges: Vec<GraphEdge>, pub subgraphs: Vec<String> }

#[derive(Serialize)]
pub struct TypeGraph  { pub nodes: Vec<GraphNode>, pub edges: Vec<GraphEdge>, pub subgraphs: Vec<String> }
```

**`compose.rs`** — after successful composition:
- Walk `ObjectTypeDefinition`s in the supergraph schema
- For **EntityGraph**: collect types with `@join__type(key:)` directives; emit an edge when a field's return type is also an entity type owned by a different subgraph
- For **TypeGraph**: collect all named domain types (skip built-ins and `join__*`/`link__*` federation internals); emit edges for field return-type relationships and union member relationships; read `@join__type(graph:)` for subgraph attribution
- Add `entity_graph` and `type_graph` fields to the success JSON payload

## Output

The WASM boundary JSON for a successful compose result gains two new optional fields:
```json
{ "ok": true, "supergraph_sdl": "...", "api_schema_sdl": "...", "hints": [],
  "entity_graph": { "nodes": [...], "edges": [...], "subgraphs": [...] },
  "type_graph":   { "nodes": [...], "edges": [...], "subgraphs": [...] } }
```

TASK-61.2 consumes this output.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Successful compose result includes `entity_graph` and `type_graph` fields in the JSON payload
- [ ] #2 Entity graph nodes include one node per (type, subgraph) pair with correct ids and labels
- [ ] #3 Type graph includes all domain types and field-return-type edges, excluding built-ins and federation internals
- [ ] #4 The `success_path_keys_match_contract` test is updated to include the new fields
- [ ] #5 A new test verifies entity_graph and type_graph are populated for a schema with entities
- [ ] #6 `cargo test -p gql-core` passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

Extend `compose.rs` to walk the composed supergraph schema and produce `EntityGraph` and `TypeGraph` structures, then add them to the success JSON payload. Add the corresponding DTO types to `dto.rs`.

### Step 1 — Add DTO types to `dto.rs`

Add the following to `crates/gql-core/src/dto.rs`:

```rust
#[derive(Debug, serde::Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub subgraphs: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct EntityGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub subgraphs: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct TypeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub subgraphs: Vec<String>,
}
```

Note: `EntityGraph` and `TypeGraph` are type aliases at the Rust level (same shape, different semantic meaning). They are kept as separate named structs for clarity.

### Step 2 — Add `build_entity_graph` in `compose.rs`

After the successful composition call, parse the supergraph SDL string (which is already serialized to `sdl: String`) via `apollo_compiler::Schema::parse`. Walk `ObjectTypeDefinition`s:

```rust
fn build_entity_graph(sdl: &str) -> crate::dto::EntityGraph {
    use apollo_compiler::Schema;
    use std::collections::{HashMap, HashSet, BTreeMap, BTreeSet};

    let Ok(schema) = Schema::parse_and_validate(sdl, "supergraph.graphql") else {
        return crate::dto::EntityGraph { nodes: vec![], edges: vec![], subgraphs: vec![] };
    };

    // Pass 1: collect entity ownership — types with @join__type(key:) directives.
    // Map: type_name → { subgraph_enum_value → [key_fields] }
    let mut entity_ownership: BTreeMap<String, BTreeMap<String, Vec<String>>> = BTreeMap::new();

    for (type_name, type_def) in schema.types.iter() {
        // Skip built-ins and federation internals
        if type_name.starts_with("join__") || type_name.starts_with("link__")
            || type_name.starts_with("federation__")
            || matches!(type_name.as_str(), "_Service" | "_Any" | "_FieldSet" | "_Entity"
                       | "Query" | "Mutation" | "Subscription" | "String" | "Boolean"
                       | "Int" | "Float" | "ID") {
            continue;
        }
        let ExtendedType::Object(obj) = type_def else { continue };
        for directive in obj.directives.iter() {
            if directive.name.as_str() != "join__type" { continue; }
            let graph_arg = directive.argument_by_name("graph")
                .and_then(|v| v.as_enum())
                .map(|e| e.as_str().to_string());
            let key_arg = directive.argument_by_name("key")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if let (Some(graph), Some(key)) = (graph_arg, key_arg) {
                entity_ownership
                    .entry(type_name.to_string())
                    .or_default()
                    .entry(graph)
                    .or_default()
                    .push(key);
            }
        }
    }

    // Build nodes from ownership map.
    let mut nodes = vec![];
    let mut subgraph_set: BTreeSet<String> = BTreeSet::new();
    for (type_name, by_subgraph) in &entity_ownership {
        let sg_list: Vec<String> = by_subgraph.keys().cloned().collect();
        for sg in &sg_list { subgraph_set.insert(sg.clone()); }
        // One node per (type, subgraph) pair — id = "SUBGRAPH:TypeName"
        for sg in &sg_list {
            nodes.push(crate::dto::GraphNode {
                id: format!("{}:{}", sg, type_name),
                label: type_name.clone(),
                subgraphs: sg_list.clone(),
            });
        }
    }

    // Pass 2: cross-subgraph edges from field return types.
    let mut edge_set: HashSet<String> = HashSet::new();
    let mut edges = vec![];
    for (type_name, src_ownership) in &entity_ownership {
        let Some(ExtendedType::Object(obj)) = schema.types.get(type_name.as_str()) else { continue };
        for (_field_name, field_def) in obj.fields.iter() {
            let ret_type = field_def.ty.inner_named_type().as_str().to_string();
            let Some(tgt_ownership) = entity_ownership.get(&ret_type) else { continue };
            for src_sg in src_ownership.keys() {
                for (tgt_sg, tgt_keys) in tgt_ownership {
                    if src_sg == tgt_sg { continue; }
                    let edge_key = format!("{}->{}", src_sg, tgt_sg);
                    if edge_set.insert(edge_key) {
                        edges.push(crate::dto::GraphEdge {
                            source: format!("{}:{}", src_sg, type_name),
                            target: format!("{}:{}", tgt_sg, ret_type),
                            label: tgt_keys.first().cloned(),
                        });
                    }
                }
            }
        }
    }

    let subgraphs: Vec<String> = subgraph_set.into_iter().collect();
    crate::dto::EntityGraph { nodes, edges, subgraphs }
}
```

Note: Use `apollo_compiler::Schema::parse_and_validate` (or `parse` if validation is too slow). The supergraph SDL is already composed and valid; a lightweight parse is sufficient. If the apollo-compiler API differs from the pseudocode above, consult `api_schema.rs` for working examples of schema traversal in this codebase.

### Step 3 — Add `build_type_graph` in `compose.rs`

Similar walk but includes all domain types (objects, interfaces, unions, inputs, scalars, enums), skipping built-ins, federation internals, and root operation types. Use `@join__type(graph:)` for subgraph attribution. Emit edges for field-return-type and union-member relationships.

```rust
fn build_type_graph(sdl: &str) -> crate::dto::TypeGraph { ... }
```

Follow the same pattern as the TS `schemaToTypeGraph.ts` for which types to include/exclude. The `isFederationInternal` and `BUILTIN_SCALARS` filtering logic should be mirrored in Rust.

### Step 4 — Wire into `compose()` success path

In the `Ok(supergraph)` branch of `compose.rs`:

```rust
let entity_graph = build_entity_graph(&sdl);
let type_graph = build_type_graph(&sdl);
json!({
    "ok": true,
    "supergraph_sdl": sdl,
    "api_schema_sdl": api_schema_sdl,
    "hints": hints,
    "entity_graph": entity_graph,
    "type_graph": type_graph,
})
```

### Step 5 — Update the failing test in `compose.rs`

The `success_path_keys_match_contract` test asserts exactly `["ok", "supergraph_sdl", "api_schema_sdl", "hints"]`. Update it to also include `"entity_graph"` and `"type_graph"` in the expected key list.

### Step 6 — Add a Rust unit test for graph content

Add a test that composes two subgraphs sharing an entity and asserts:
- `entity_graph.nodes` is non-empty
- `entity_graph.subgraphs` contains both subgraph names
- `type_graph.nodes` is non-empty

### Consulting existing code for API shape

Check `crates/gql-core/src/api_schema.rs` to see how the supergraph SDL is currently re-parsed with `apollo_compiler` — use the same pattern for re-parsing in the graph builders. This avoids needing to navigate the `apollo-federation` supergraph object directly (its API is opaque), relying instead on parsing the already-serialized SDL string.

### Files to change

- `crates/gql-core/src/dto.rs` — add `GraphNode`, `GraphEdge`, `EntityGraph`, `TypeGraph` structs
- `crates/gql-core/src/compose.rs` — add `build_entity_graph`, `build_type_graph` helpers; wire into success path; update test
<!-- SECTION:PLAN:END -->
