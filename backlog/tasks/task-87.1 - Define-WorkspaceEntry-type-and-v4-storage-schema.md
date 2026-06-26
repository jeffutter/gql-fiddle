---
id: TASK-87.1
title: Define WorkspaceEntry type and v4 storage schema
status: Done
assignee: []
created_date: '2026-06-26 13:08'
updated_date: '2026-06-26 17:54'
labels:
  - task
  - planned
dependencies: []
parent_task_id: TASK-87
priority: high
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the `WorkspaceEntry` interface to `share.ts` (or a dedicated `types.ts`) and document the v4 localStorage shape.

**Changes:**
- Add `WorkspaceEntry` interface: `{ name, subgraphs, activeSubgraph, queryTabs, activeQueryTab, seed, mockConfig, tourDraft }`
- Document the v4 root shape: `{ workspaces: WorkspaceEntry[], activeWorkspaceIndex: number, vimMode: boolean }`

No runtime behavior changes — this is purely a type definition that all subsequent sub-tickets reference.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add `WorkspaceEntry` to `web/src/share.ts` (alongside the existing `WorkspacePayload`, `Tour`, etc.):

```ts
export interface WorkspaceEntry {
  name: string;
  subgraphs: SubgraphInput[];
  activeSubgraph: number;
  queryTabs: QueryTab[];
  activeQueryTab: number;
  seed: number;
  mockConfig: string;
  tourDraft: Tour | null;
}
```

Note: `SubgraphInput` and `QueryTab` are imported from `./core/types` in `store.ts` but not currently exported from `share.ts`. Either re-export them via share.ts or place `WorkspaceEntry` in a new `web/src/types.ts` that imports from both `share.ts` and `core/types`.

Also add a JSDoc comment documenting the v4 root shape for the `"graphql-playground"` localStorage key:
```
v4 localStorage root (key: "graphql-playground"):
{ workspaces: WorkspaceEntry[], activeWorkspaceIndex: number, vimMode: boolean }
```

This is a type-only addition; no functional code changes are needed.
<!-- SECTION:PLAN:END -->
