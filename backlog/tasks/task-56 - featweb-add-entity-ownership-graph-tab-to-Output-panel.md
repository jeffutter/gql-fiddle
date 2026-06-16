---
id: TASK-56
title: 'feat(web): add entity ownership graph tab to Output panel'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-16 18:47'
updated_date: '2026-06-17 01:03'
labels:
  - visualization
  - output-panel
  - schema
  - federation
  - planned
dependencies:
  - TASK-56.1
  - TASK-56.2
  - TASK-56.3
references:
  - web/src/App.tsx
  - web/src/core/types.ts
  - web/src/store.ts
documentation:
  - >-
    https://www.apollographql.com/docs/federation/federated-types/federated-directives/
priority: medium
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a new "Entities" tab to the Output panel that visualizes how entity types (types with `@key` directives) are distributed across subgraphs and how they reference each other across service boundaries. This directly answers schema design questions: "which services are most coupled?", "are there circular entity dependencies?", "how many hops does this entity require to resolve?"

Unlike the full Type Graph (a separate proposed feature), this view is intentionally scoped to entities only, keeping the graph tractable for complex schemas.

**App placement:**
- New "Entities" tab in the Output panel (top-right), alongside Query Plan / Sequence Diagram / Supergraph SDL.
- Driven by the composition result (`compose` state in `App.tsx`) — specifically by parsing `@join__type` and `@join__field` directives from `supergraph_sdl`, or by parsing the individual `subgraphs[]` SDLs for `@key` directives.
- Tab is disabled (greyed out) or shows an informational message when composition has failed.

**Implementation approach:**
- New `schemaToEntityGraph.ts` utility that parses entity ownership from the supergraph SDL: find all types with `@join__type(graph: ...)` to establish ownership, find cross-subgraph references (fields whose return types are entities owned by a different subgraph) to create directed edges. Edge labels carry the `@key(fields: "...")` value.
- Each subgraph rendered as a distinct visual cluster/group; entity types as nodes within their owning subgraph; directed edges between subgraph boundaries with key field labels.
- **Library:** If `@xyflow/react` is already installed by the Type Graph feature (TASK-XXX), reuse it here. Otherwise, given the small node count (typically 5–30 entity nodes, 2–10 subgraphs), a custom SVG layout is viable with a simple cluster-positioning algorithm. Prefer `@xyflow/react` for consistency.
- Circular/bidirectional entity references should be visually distinguishable (e.g., double-headed arrow, or distinct edge color).
- **Subgraph color coding must be consistent with the Field Attribution feature** — the same subgraph should use the same color in both views. Share the deterministic subgraph→color mapping.

**Design:** Respects the "Ink at Night" dark theme. Subgraph cluster backgrounds use a subtle tint of the subgraph's assigned color.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An 'Entities' tab appears in the Output panel tab strip on both desktop and mobile
- [x] #2 The tab shows an informational message (not an error) when composition has failed
- [x] #3 Each subgraph is rendered as a distinct labeled group/cluster
- [x] #4 Entity types (those with @key directives) appear as nodes inside their owning subgraph cluster
- [x] #5 Non-entity types are not shown
- [x] #6 Directed edges connect entity types that reference each other across subgraph boundaries
- [x] #7 Each edge is labeled with the @key field names used for resolution (e.g. 'id', 'sku')
- [x] #8 Bidirectional / circular entity references are visually distinguishable from one-way references
- [x] #9 Hovering an edge shows a tooltip: 'Resolved via @key(fields: "<fields>")'
- [x] #10 Subgraph colors are consistent with those used in the Field Attribution query editor decorations
- [x] #11 The graph remains readable with 2–10 subgraphs and 5–30 entity nodes
- [x] #12 Respects the 'Ink at Night' dark theme via CSS custom properties
<!-- AC:END -->





## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

The Entities tab is delivered in three independently-executable sub-tickets that compose bottom-up:

1. **TASK-56.1** — `schemaToEntityGraph.ts`: pure SDL parsing utility (no React, no rendering). Reads the supergraph SDL, extracts entity types via `@join__type(graph: ..., key: "...")` directives, builds cross-subgraph edges from field return-type references. Ships with a vitest test file.

2. **TASK-56.2** — `EntityOwnershipGraph.tsx`: SVG rendering component. Takes an `EntityGraph` (output of TASK-56.1) and lays out subgraph clusters in a grid, entity nodes within each cluster, Bezier-curve edges between clusters with arrowhead markers. Bidirectional edges rendered in a distinct color (`var(--warning)`). Edge hover triggers a tooltip `Resolved via @key(fields: "...")`. Follows the same SVG + tooltip pattern as `ExecutionTimeline.tsx`. No external libraries — `@xyflow/react` is not yet installed and this feature's small node count makes custom SVG viable and preferable to adding a 65 KB dependency.

3. **TASK-56.3** — App.tsx integration: adds `"entities"` to the `rightTab` union, imports the two new modules, derives `entityGraph` via `useMemo` from the `compose` state, adds the tab button and content slot to both desktop and mobile Output panel render branches.

## Key design decisions

- **No new library dependency.** `@xyflow/react` is not installed. Entity graphs are small (5–30 nodes, 2–10 subgraphs), so a custom SVG layout is sufficient and avoids bundle cost. If TASK-57 (Type Graph) is executed first and installs `@xyflow/react`, the implementer of TASK-56.2 may optionally adopt it for consistency, but it is not required.
- **Color consistency.** `subgraphColorVar()` from `web/src/subgraphColors.ts` is already the single source of truth. TASK-56.2 imports this utility directly. No new color infrastructure is needed — `subgraphColors.ts` was explicitly designed with this feature in mind (see its JSDoc comment).
- **Composition failure state.** TASK-56.3 follows the same guard pattern as all other tabs: `compositionErrorContent ?? (...)`. The `entitiesContent` additionally returns `null` guard text when `compose` is not successful, covering the informational message AC.
- **Supergraph SDL parsing.** The Apollo supergraph SDL encodes entity key information in `@join__type(graph: PRODUCTS, key: "id")` arguments. The `graphql` package (already a dependency) provides the `parse()` AST function to walk these directives without needing `buildASTSchema`.

## Integration and verification steps

After all three sub-tickets are done:
1. Run `pnpm test run` — all new tests in `schemaToEntityGraph.test.ts` must pass.
2. Run `pnpm tsc --noEmit` — no type errors.
3. Run `pnpm lint` — no lint warnings.
4. Start `pnpm dev:no-wasm` and load the app with the default federation example. Navigate to the Entities tab and verify all 12 acceptance criteria.
5. Run `pnpm e2e` — existing Playwright tests must not regress (no new e2e tests required for this feature).

## Execution order

TASK-56.1 → TASK-56.2 → TASK-56.3 (strict sequential; each depends on the previous).
TASK-56.1 is `planned` (trivial well-scoped utility with clear algorithm).
TASK-56.2 is `unplanned` — SVG layout arithmetic and bidirectional edge rendering warrant a focused planning session.
TASK-56.3 is `planned` (mechanical App.tsx wiring, fully specified in description).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

Three new files created:
- `web/src/schemaToEntityGraph.ts`: Pure SDL parser using `graphql` package's `parse()`. Walks ObjectTypeDefinition/Extension nodes collecting `@join__type(graph, key)` directives to identify entity types and their owning subgraphs. Cross-subgraph edges are derived from field return types. Bidirectional edges are both emitted.
- `web/src/schemaToEntityGraph.test.ts`: 14 vitest tests covering empty/invalid SDL, single-subgraph, two-subgraph reference, bidirectional references, non-entity exclusion, ID format, and multiple @key values.
- `web/src/EntityOwnershipGraph.tsx`: Custom SVG rendering component with cluster-grid layout (up to 3 columns), Bezier-curve edges, bidirectional edges in `var(--warning)` color, and tooltip on edge hover. Uses `subgraphColorVar()` from subgraphColors.ts for color consistency. No external libraries.

App.tsx changes:
- Added `useMemo` import
- Added imports for the two new modules
- Extended `rightTab` union type with `"entities"`
- Added `entityGraph` memoized from compose state
- Added `entitiesContent` JSX
- Added Entities tab button between Timeline and Supergraph SDL in both desktop and mobile Output panel nav strips
- Wired `entitiesContent` into both desktop and mobile render branches

All tests pass, TypeScript reports no errors, lint is clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the Entities tab for the Output panel: a pure SDL-parsing utility (schemaToEntityGraph.ts), a custom SVG rendering component (EntityOwnershipGraph.tsx), and App.tsx integration adding the Entities tab to both desktop and mobile Output panels. All 14 new tests pass, TypeScript is clean, lint is clean.
<!-- SECTION:FINAL_SUMMARY:END -->
