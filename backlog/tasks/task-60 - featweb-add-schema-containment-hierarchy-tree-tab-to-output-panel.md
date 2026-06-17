---
id: TASK-60
title: 'feat(web): add schema containment hierarchy tree tab to output panel'
status: To Do
assignee: []
created_date: '2026-06-17 03:24'
labels:
  - visualization
  - schema
  - web
dependencies: []
priority: medium
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Add a new "Schema Tree" (or "Type Hierarchy") tab to the output panel that visualizes the GraphQL schema as a collapsible containment/nesting tree rooted at `Query`, `Mutation`, and `Subscription`.

Unlike the existing schema type graph (which shows connectivity), this view emphasizes **depth and containment** — how types nest inside each other when you traverse the graph. This is useful for:

- Understanding data hierarchy before writing a query (e.g. `Order → LineItem → Product → Variant`)
- SDUI schemas where component nesting maps directly to page structure
- Any schema where you want to understand traversal paths and depth

## Design

### Tree Structure

- Root nodes: `Query`, `Mutation`, `Subscription` entry points
- Each node is a field; its children are the fields of its return type
- Only expand **object/interface/union** types as children — scalar fields are leaves
- Show the field name and return type on each node
- Collapsible/expandable nodes

### Cycle Handling

Schemas commonly have cycles (e.g. `User → friends → [User]`). When a type is encountered that is already an ancestor in the current path, render it as a **reference leaf** (e.g. `→ User (see above)`) rather than expanding it again. This prevents infinite recursion while still communicating the relationship exists.

Types already seen elsewhere in the tree (but not in the current ancestor chain) can optionally be collapsed by default but still expandable.

### Display Details

- Indicate list fields visually (e.g. `[LineItem]` vs `LineItem`)
- Indicate nullable vs non-null fields (e.g. with `?` suffix or muted styling)
- Union/interface slots should show all possible concrete types as expandable children
- Arguments on fields can be shown on hover or as a secondary line

## Implementation Notes

- The existing schema type graph tab (`web/src/`) is a good reference for how schema introspection data is accessed
- Consider reusing tree-rendering patterns from the execution timeline if applicable
- The tree can be built lazily (expand on click) to avoid rendering the full schema up front for large schemas
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new tab appears in the output panel showing the schema containment tree
- [ ] #2 Tree is rooted at Query/Mutation/Subscription entry points
- [ ] #3 Nodes are collapsible and expandable
- [ ] #4 Cycles are detected and rendered as reference leaves rather than infinitely expanding
- [ ] #5 List fields are visually distinguished from singular fields
- [ ] #6 Nullable fields are visually distinguished from non-null fields
- [ ] #7 Union/interface slots show all possible concrete types as children
<!-- AC:END -->
