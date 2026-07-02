---
id: TASK-107
title: Draw entity-ownership edges from the correct source node
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 14:35'
labels:
  - review
  - planned
dependencies:
  - TASK-103
priority: medium
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/EntityOwnershipGraph.tsx:324 picks srcNode as the first node in the source cluster regardless of which type holds the cross-subgraph reference, so with more than one entity per source subgraph every edge visually originates from the same (often wrong) node — a correctness defect in the diagram's core claim (which field references which entity). The source type name is available in the Rust edge id (SUBGRAPH:TypeName, split at web/src/schemaToEntityGraph.ts:99 but discarded). Fix: thread the source type name through schemaToEntityGraph from the Rust DTO (see RS-ENTITYEDGE) and match srcNode on it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 edges originate from the entity node that actually holds the reference
- [x] #2 a source subgraph with multiple entities renders distinct edge origins
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

EntityOwnershipGraph.tsx:324 picks the edge's source node with:

```ts
const srcNode = nodeLayouts.find((n) => n.subgraph === edge.sourceSubgraph);
```

This matches only on subgraph, so `.find` always returns the *first* node
laid out in that subgraph's cluster — regardless of which entity type in
that subgraph actually holds the cross-subgraph reference. When a source
subgraph owns more than one entity, every outgoing edge from that subgraph
visually originates from the same node, which is frequently wrong.

TASK-103 (dependency, now Done) already added `sourceTypeName` to
`EntityEdge` in web/src/schemaToEntityGraph.ts, parsed from the Rust edge id
`SUBGRAPH:TypeName` — so the correct source type is available on the edge
object today; it's just unused in EntityOwnershipGraph.tsx.

## Fix (web/src/EntityOwnershipGraph.tsx)

The component already builds a lookup map for exactly this purpose:

```ts
// Build a lookup: "SUBGRAPH:TypeName" → NodeLayout
const nodeById = new Map<string, NodeLayout>();
for (const n of nodeLayouts) nodeById.set(n.id, n);
```

(`NodeLayout.id` / `EntityNode.id` both use the `SUBGRAPH:TypeName`
convention — see schemaToEntityGraph.ts:14-19.)

Replace the `.find` on line 324 with a lookup keyed on the edge's actual
source type:

```ts
const srcNode = nodeById.get(`${edge.sourceSubgraph}:${edge.sourceTypeName}`);
const tgtNode = nodeById.get(`${edge.targetSubgraph}:${edge.typeName}`);
```

The `tgtNode` lookup can be simplified the same way (it currently does an
equivalent `.find` on `subgraph`+`typeName` — replacing it with `nodeById`
is a drop-in equivalent, removes the redundant linear scan, and keeps both
lookups consistent). Keep the existing `edgePath(srcNode, tgtNode, ...)`
call and its `if (!d) return null` guard unchanged — `nodeById.get` returning
`undefined` for an unknown id behaves the same as `.find` returning
`undefined`, so no new null-handling is needed.

Update the stale comment above (currently: "Source: entity node in the
sourceSubgraph (any type that happens to have a field referencing
targetType — we use the first node in the source cluster)") to describe the
corrected behavior, e.g. "Source/target: resolved via nodeById using the
edge's actual source/target type names (sourceTypeName/typeName), not just
subgraph — a subgraph can own multiple entities."

## Tests

No test file exists yet for EntityOwnershipGraph.tsx (only TourPlayback.test.tsx
and App.test.tsx exist as component test precedents in web/src, both using
@testing-library/react `render`/`cleanup`). Add
web/src/EntityOwnershipGraph.test.tsx:

- Build a minimal `EntityGraph` fixture (see schemaToEntityGraph.ts's
  `EntityGraph`/`EntityNode`/`EntityEdge` shapes) with:
  - Two entity nodes in the same source subgraph, e.g.
    `SRC:TypeA` and `SRC:TypeB`.
  - One node in a target subgraph, e.g. `TGT:TypeC`.
  - Two edges: `SRC:TypeA -> TGT:TypeC` (sourceTypeName: "TypeA") and
    `SRC:TypeB -> TGT:TypeC` (sourceTypeName: "TypeB").
- Render `<EntityOwnershipGraph graph={fixture} />` via
  `@testing-library/react`'s `render`, then inspect the rendered SVG
  `<path>` elements' `d` attributes (e.g. via `container.querySelectorAll`)
  and assert the two edges produce *different* path start points —
  confirming they no longer both originate from the same node.
- Regression-guard the pre-existing single-entity-per-subgraph case still
  renders one edge correctly (a node and one edge, `d` attribute present
  and non-null).

## Verification

- `npx vitest run web/src/EntityOwnershipGraph.test.ts` (or full `npx vitest run`)
- `npx tsc --noEmit`
- `npx eslint web/src/EntityOwnershipGraph.tsx web/src/EntityOwnershipGraph.test.tsx`
- Manual: open the app with a schema/fixture where one subgraph owns two+
  entities and at least one of the non-first entities has an outbound
  cross-subgraph reference; confirm the edge now visually originates from
  that entity's node, not always the first node in the cluster.

## Scope note

This ticket is a single-file, ~2-line logic fix plus a new focused test
file — no sub-tickets needed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced the .find()-based srcNode/tgtNode lookup in EntityOwnershipGraph.tsx (edge rendering loop) with nodeById.get() keyed on "${subgraph}:${typeName}", using edge.sourceTypeName (added in TASK-103) for the source side and edge.typeName for the target side. This makes edges originate from the entity node that actually holds the cross-subgraph reference instead of always the first node in the source subgraph's cluster. Updated the stale comment above the lookup. Added web/src/EntityOwnershipGraph.test.tsx with two tests: (1) two entities in one source subgraph with edges from each to a shared target render distinct path start points, (2) the pre-existing single-entity-per-subgraph case still renders one edge with a valid path. Verified: npx vitest run (398/398 tests pass), npx tsc --noEmit (clean), npx eslint on changed files (clean).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed EntityOwnershipGraph.tsx to resolve edge source/target nodes via a subgraph:typeName lookup (nodeById) using edge.sourceTypeName/typeName instead of a subgraph-only .find(), so edges now originate from the entity that actually holds the cross-subgraph reference rather than always the first node in the source cluster. Added a focused component test covering both the multi-entity-per-subgraph case and the pre-existing single-entity regression case.
<!-- SECTION:FINAL_SUMMARY:END -->
