---
id: TASK-103
title: Fix cross-subgraph entity edges dropped for multi-type subgraph pairs
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 00:28'
labels:
  - review
  - planned
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
- [x] #1 a schema where A references two B-owned entities yields two distinct entity edges
- [x] #2 the edge DTO exposes the source type name
- [x] #3 entity-graph tests updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

`build_entity_graph` in crates/gql-core/src/compose.rs (~line 224) dedups
cross-subgraph entity edges with `edge_key = format!("{}->{}", src_sg, tgt_sg)`,
i.e. keyed only on the subgraph pair. The comment above it claims the key
mirrors the TS id "SRC->TGT:TargetType", but the target type is not actually
in the key. Result: when subgraph A has fields referencing two different
entity types both owned by subgraph B (e.g. A.field1 -> B:TypeX and
A.field2 -> B:TypeY), only the first (src_sg, tgt_sg) edge survives
`edge_set.insert(edge_key)` — the second is silently dropped even though it
is a distinct entity relationship. web/src/schemaToEntityGraph.ts:105
reconstructs an edge id as `${sourceSubgraph}->${targetSubgraph}:${typeName}`
and the UI (EntityOwnershipGraph.tsx) expects one rendered edge per distinct
target type, so real relationships silently vanish from the diagram today.

## Fix (crates/gql-core/src/compose.rs, ~line 224-231)

Change the edge key to include the target type name, matching what the
comment already claims and what the TS side reconstructs:

```rust
// Edge key mirrors the TS: "SRCSUB->TGTSUB:TargetType"
let edge_key = format!("{}->{}:{}", src_sg, tgt_sg, ret_type);
if edge_set.insert(edge_key) {
    edges.push(GraphEdge {
        source: format!("{}:{}", src_sg, type_name),
        target: format!("{}:{}", tgt_sg, ret_type),
        label: tgt_keys.first().cloned(),
    });
}
```

Note `GraphEdge.source` already encodes `"{src_sg}:{type_name}"` (the same
`SUBGRAPH:TypeName` convention used for node ids) — the source type name is
already present on the wire. No change to the `GraphEdge` Rust struct
(crates/gql-core/src/dto.rs) is needed for this.

## AC #2 — expose the source type name on the edge DTO consumed by the web layer

TASK-107 (blocked on this ticket) needs to match the SVG source node by its
actual entity type, not just by subgraph, and currently `EntityEdge` in
web/src/schemaToEntityGraph.ts only exposes `sourceSubgraph` /
`targetSubgraph` / `typeName` (the *target* type), discarding the type
portion of `e.source` during parsing (~line 99-100).

Add `sourceTypeName` to `EntityEdge` (web/src/schemaToEntityGraph.ts) and
populate it by parsing `e.source` the same way `typeName` is already parsed
from `e.target`:

```ts
export interface EntityEdge {
  id: string;
  sourceSubgraph: string;
  targetSubgraph: string;
  /** The entity type on the source side that holds the cross-subgraph reference. */
  sourceTypeName: string;
  typeName: string;
  keyFields: string;
}
```

```ts
const srcColon = e.source.indexOf(":");
const sourceTypeName = srcColon >= 0 ? e.source.slice(srcColon + 1) : e.source;
...
return { id, sourceSubgraph, sourceTypeName, targetSubgraph, typeName, keyFields: e.label ?? "" };
```

This is additive (new field, existing fields untouched) so it does not
require touching EntityOwnershipGraph.tsx — TASK-107 will consume
`sourceTypeName` separately to fix the srcNode lookup.

## Tests to update/add (AC #3)

Rust (crates/gql-core/src/compose.rs, near the existing
`entity_graph_and_type_graph_populated_for_entity_schema` test at ~line 1185):
- Add a focused test with three subgraphs where subgraph A has two fields
  referencing two different entity types both owned by subgraph B (e.g.
  `type Query { user: User }` shape reused, plus a second B-owned entity
  type referenced from A). Assert `entity_graph.edges` contains two distinct
  edges (by target id / by count), not deduped down to one, e.g. targets
  `"B:TypeX"` and `"B:TypeY"` both present.
- Optionally add a regression assertion to the existing populated-graph test
  that edge count/targets are as expected (not just non-empty).

Web (web/src/schemaToEntityGraph.test.ts):
- Extend `makeTwoSubgraphEntityReferenceGraph` (or add a new fixture) with
  two edges sharing the same `sourceSubgraph`/`targetSubgraph` but different
  target types (e.g. `ORDERS:Order -> USERS:User` and
  `ORDERS:Order -> USERS:Account`), and assert both produce distinct `id`s
  and are both present in `schemaToEntityGraph(...).edges`.
- Assert `sourceTypeName` is populated correctly on mapped edges (e.g. for
  `source: "ORDERS:Order"` expect `sourceTypeName: "Order"`).

## Verification

- `cargo test -p gql-core` (or repo-standard Rust test command per AGENTS.md)
  for the compose.rs changes.
- `npm test` / vitest for web/src/schemaToEntityGraph.test.ts.
- Manually confirm via the app (or an existing fixture schema) that a
  subgraph referencing two different entity types owned by the same other
  subgraph now renders two edges instead of one.

## Out of scope

- TASK-107's actual srcNode-matching fix in EntityOwnershipGraph.tsx — this
  ticket only needs to make `sourceTypeName` available for TASK-107 to
  consume; it does not need to change the SVG rendering logic itself.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation:
- crates/gql-core/src/compose.rs (build_entity_graph): edge_key now includes
  the target type name (`format!("{}->{}:{}", src_sg, tgt_sg, ret_type)`),
  matching the comment's stated intent and the TS-side id reconstruction.
  Previously two entity types owned by the same target subgraph collapsed to
  one edge; now each distinct (src_sg, tgt_sg, target_type) triple survives.
- Added a focused Rust test
  entity_graph_emits_distinct_edges_for_multiple_target_types_in_same_subgraph_pair
  with subgraph "orders" (entity Order) referencing two catalog-owned
  entities (Product, Warehouse) — asserts both edges are present and every
  edge source encodes the source type name.
- Updated the existing three_subgraphs_users_posts_and_comments insta
  snapshot: it exercised exactly this bug (Comment/Post/User cross-refs
  collapsing multiple target types per subgraph pair down to one edge) and
  now correctly shows 10 edges instead of 6.
- web/src/schemaToEntityGraph.ts: added `sourceTypeName` to EntityEdge,
  parsed from `e.source` the same way `typeName` is parsed from `e.target`
  (additive change; EntityOwnershipGraph.tsx untouched, per plan's stated
  out-of-scope for the srcNode-matching fix, which is TASK-107).
- web/src/schemaToEntityGraph.test.ts: added a
  makeMultiTargetTypeSameSubgraphPairGraph fixture and two new tests
  (distinct edges per target type; sourceTypeName populated), plus a
  sourceTypeName assertion on the existing two-subgraph edge test.

Verification: cargo test -p gql-core (94 passed), cargo fmt --check, cargo
clippy --all-targets -D warnings (clean), npx tsc --noEmit (clean), npx
vitest run (396 passed), npx eslint on changed files (clean).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the entity-edge dedup key in build_entity_graph (compose.rs) to include the target type name, so subgraph pairs with multiple distinct entity-type edges no longer collapse to one; also added sourceTypeName to the TS EntityEdge DTO (additive, unblocking TASK-107) and covering tests on both the Rust and TS sides.
<!-- SECTION:FINAL_SUMMARY:END -->
