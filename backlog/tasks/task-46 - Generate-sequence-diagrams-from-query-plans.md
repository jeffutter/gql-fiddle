---
id: TASK-46
title: Generate sequence diagrams from query plans
status: To Do
assignee: []
created_date: '2026-06-12 21:00'
labels:
  - ux
  - visualization
  - query-plan
dependencies:
  - TASK-45
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Query Plan tab currently shows a tree view (`PlanTree.tsx`). A sequence diagram would better communicate the *ordering* and *data flow* between subgraphs — particularly which service is called first, which calls are parallel, and what key fields are passed between them for entity resolution.

**What the diagram should show**

- **Participants**: the client/router plus each subgraph `service` that appears in a `Fetch` node.
- **Arrows**: one arrow per `Fetch`, directed from the router to the target service, in the order dictated by `Sequence`/`Parallel` structure.
- **Parallel blocks**: `Parallel` nodes should be grouped visually (e.g. Mermaid `par` blocks) to show concurrent fetches.
- **Fetch labels**: include the top-level selection(s) from `operation` (not the full query — just enough to identify what's being fetched, e.g. `query { users { ... } }`).
- **Join annotations**: when a `Fetch` has a non-empty `requires` field, annotate the arrow or add a note showing the key fields being passed (e.g. `requires: { __typename, id }`). These are the `@key` fields used for entity joins.
- **Flatten context**: when a `Fetch` is wrapped in a `Flatten`, include the `path` (e.g. `@ users.@`) as a note to indicate which type the entity resolution is stitching into.

**Rendering approach — open question**

Two options to evaluate before/during implementation:

1. **Mermaid** — walk the `PlanNode` tree and emit a Mermaid `sequenceDiagram` string; render it in the browser via the `mermaid` npm package. Pros: no SVG math, built-in styling. Cons: limited control over layout; `par` blocks in Mermaid can look cluttered for deeply nested parallel plans; adds ~200 KB to the bundle.

2. **Direct SVG** — compute participant columns and arrow rows from the plan tree, then emit SVG elements. Pros: full control, no extra dependency. Cons: significantly more implementation work (layout arithmetic, text measurement).

The implementer should prototype both and choose based on how cleanly `Parallel` nesting renders. A note on the decision should be left in the task.

**Where to surface it**

Add a "Sequence" tab alongside the existing "Query Plan" tab in the right-hand pane (top row), or replace/extend the existing tab. The tree view should remain available.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A sequence diagram is rendered for the current query plan whenever a plan is available.
- [ ] #2 Each subgraph service that appears in a Fetch node is shown as a named participant.
- [ ] #3 Arrows reflect the execution order imposed by Sequence and Parallel nodes; parallel fetches are visually grouped.
- [ ] #4 Fetch arrows are labelled with the top-level selection name(s) from the operation string.
- [ ] #5 When a Fetch has a non-empty `requires` array, the key fields are shown on or near the arrow (e.g. `requires: __typename, id`).
- [ ] #6 When a Fetch is inside a Flatten, the flatten path is shown as a note or annotation.
- [ ] #7 The existing tree view remains accessible (either as a separate tab or toggle).
- [ ] #8 The diagram updates whenever the query plan changes.
- [ ] #9 All existing tests continue to pass.
<!-- AC:END -->
