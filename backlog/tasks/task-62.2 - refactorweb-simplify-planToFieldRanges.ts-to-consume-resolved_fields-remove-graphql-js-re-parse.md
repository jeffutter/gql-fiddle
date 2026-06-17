---
id: TASK-62.2
title: >-
  refactor(web): simplify planToFieldRanges.ts to consume resolved_fields,
  remove graphql-js re-parse
status: To Do
assignee: []
created_date: '2026-06-17 04:32'
labels:
  - architecture
  - web
dependencies:
  - TASK-62.1
references:
  - web/src/planToFieldRanges.ts
  - web/src/core/types.ts
  - web/src/App.tsx
parent_task_id: TASK-62
priority: medium
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the web half of TASK-62. TASK-62.1 annotates each `PlanNode::Fetch` with `resolved_fields: [{ field_name, type_condition }]`. This task strips the `graphql-js` re-parsing from `planToFieldRanges.ts` and replaces it with a straight traversal over the pre-computed data.

## Goal

`planToFieldRanges.ts` should no longer parse operation strings with `graphql-js`. It should:
1. Walk the plan tree collecting `Fetch` nodes (unchanged)
2. Read `resolved_fields` from each Fetch node (new)
3. Parse the *original user query* once with `graphql-js` — only to get source positions for Monaco decorations (this part stays)
4. Match `field_name` + `type_condition` from `resolved_fields` against the original query AST positions

## Implementation guidance

**`web/src/core/types.ts`** — add to the `Fetch` variant (done in TASK-62.1):
```ts
resolved_fields: Array<{ field_name: string; type_condition: string | null }>
```

**`web/src/planToFieldRanges.ts`**:
- Remove: all `graphql-js` parsing of Fetch sub-operation strings
- Remove: `_entities` detection heuristics
- Remove: inline-fragment string scanning
- Keep: single parse of the original query for `loc` source positions
- Keep: Monaco `FieldRange` output shape (so `App.tsx` callers are unchanged)
- New: for each Fetch node, iterate `resolved_fields`; for each entry look up matching field positions in the original query AST using `field_name` and `type_condition` as the selector

## Verification

- Monaco editor field coloring works correctly for both simple and entity-fetch query plans
- No `graphql-js` parse calls remain on Fetch sub-operation strings
<!-- SECTION:DESCRIPTION:END -->
