---
id: TASK-56
title: 'feat(web): add entity ownership graph tab to Output panel'
status: To Do
assignee: []
created_date: '2026-06-16 18:47'
labels:
  - visualization
  - output-panel
  - schema
  - federation
dependencies: []
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
- [ ] #1 An 'Entities' tab appears in the Output panel tab strip on both desktop and mobile
- [ ] #2 The tab shows an informational message (not an error) when composition has failed
- [ ] #3 Each subgraph is rendered as a distinct labeled group/cluster
- [ ] #4 Entity types (those with @key directives) appear as nodes inside their owning subgraph cluster
- [ ] #5 Non-entity types are not shown
- [ ] #6 Directed edges connect entity types that reference each other across subgraph boundaries
- [ ] #7 Each edge is labeled with the @key field names used for resolution (e.g. 'id', 'sku')
- [ ] #8 Bidirectional / circular entity references are visually distinguishable from one-way references
- [ ] #9 Hovering an edge shows a tooltip: 'Resolved via @key(fields: "<fields>")'
- [ ] #10 Subgraph colors are consistent with those used in the Field Attribution query editor decorations
- [ ] #11 The graph remains readable with 2–10 subgraphs and 5–30 entity nodes
- [ ] #12 Respects the 'Ink at Night' dark theme via CSS custom properties
<!-- AC:END -->
