---
id: TASK-22
title: Add the query-plan tree view in the web app
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 12:03'
labels: []
milestone: m-3
dependencies:
  - TASK-20
  - TASK-19
  - TASK-40
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a "Query Plan" tab beside the supergraph SDL that draws the plan as an indented tree, updating when the user runs a query.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Query Plan tab shows the plan tree after Run, with subgraph names on Fetch nodes and nesting for Sequence/Parallel/Flatten
- [ ] #2 A failed plan shows an error message instead of crashing
- [ ] #3 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. When Run is pressed (in the results task), also call core.plan(supergraphSdl, query) and store the result.
2. Add a "Query Plan" tab in the top-right area next to the Supergraph SDL. Render the node tree as nested, indented blocks: show each node kind; for Fetch show the subgraph name and the sent operation text; for Flatten show its path; Sequence/Parallel show their children indented.
3. If plan() returns ok:false, show the error text in the tab instead of crashing.
4. Verify with a multi-subgraph query that the tree shows the expected Fetch nodes per subgraph.
<!-- SECTION:PLAN:END -->
