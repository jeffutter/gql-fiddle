---
id: TASK-71.1
title: Extend tour step data model with pane visibility flags
status: To Do
assignee: []
created_date: '2026-06-21 01:28'
updated_date: '2026-06-21 01:39'
labels:
  - tour
  - data-model
  - planned
dependencies: []
parent_task_id: TASK-71
priority: medium
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add per-pane visibility flags to the tour step data model so each step can independently control which panes are visible during playback. This is the foundational change that the authoring UI (TASK-72) and playback enforcement (TASK-73) both depend on.

Panes to cover: variables, response, headers — and any other non-schema panes in the current 3-pane tour layout. A missing flag should default to the pane's current default state so existing tours without flags continue to work unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tour step type/schema includes optional visibility flags for each non-schema pane
- [ ] #2 Serialization and deserialization round-trips correctly with and without flags present
- [ ] #3 Missing flags are treated as the pane's default visibility (no breaking change for existing tours)
- [ ] #4 TypeScript types are updated throughout — no untyped casts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Goal
Add optional `paneVisibility` flags to `TourStep` so each step can declare which non-schema panes are visible during playback. This is a pure data-model change — no rendering logic.

### Files to modify
- `web/src/share.ts` — add type and update `TourStep` interface
- `web/src/share.test.ts` — add round-trip and `resolveTourStep` tests covering the new field

### Step 1 — Define the `PaneVisibility` type in `share.ts`

Add after the existing interfaces (before `HASH_PREFIX`):

```ts
export type PaneId = "schema" | "plan";

export interface PaneVisibility {
  schema?: boolean;
  plan?: boolean;
}
```

`schema` controls whether the subgraph-editor panel is visible. `plan` controls whether the query-plan panel is visible. Both are optional — absence means "use the default" (visible). The prose panel is never hidden and is excluded.

### Step 2 — Extend `TourStep`

```ts
export interface TourStep {
  label: string;
  prose: string;
  anchor?: { subgraphIndex: number; typeName: string; fieldName?: string };
  overrides?: Partial<WorkspacePayload>;
  paneVisibility?: PaneVisibility;   // ← new, optional
}
```

### Step 3 — Verify `encodeTour` / `decodeTour` round-trips for free

`encodeTour` and `decodeTour` serialize the full `Tour` object via `JSON.stringify` / `JSON.parse`. The new optional field is included automatically when present and absent when not set. No changes needed to the serialization functions, but tests should confirm this.

### Step 4 — Write tests in `share.test.ts`

Add a new `describe` block after the existing `resolveTourStep` suite:

1. **Round-trip with `paneVisibility`** — encode then decode a tour whose step has `paneVisibility: { schema: false, plan: true }` and assert equality.
2. **Round-trip without `paneVisibility`** — existing tours (no field present) decode without the field (or with `undefined`), confirming backward compat.
3. **`resolveTourStep` passes `paneVisibility` through unchanged** — `resolveTourStep` returns the `WorkspacePayload`, not the `TourStep`, so `paneVisibility` is accessed via `tour.steps[i].paneVisibility` directly. Write a test that reads the flag from the step after round-trip, not from `resolveTourStep`'s return value.

### Acceptance criteria mapping
- AC#1 — the new `paneVisibility?: PaneVisibility` field on `TourStep` covers all non-schema panes.
- AC#2 — absence of the field (`undefined`) is the default; existing tours without the field work unchanged.
- AC#3, AC#4 — these are authoring-UI and serialization concerns handled here: `JSON.stringify` includes the field only when set, and TypeScript types are complete (no `as any` casts).

### Non-goals
- No rendering changes in this task. `TourPlayback` and `TourAuthoringPanel` do not change.
- `store.ts` does not need to change — `setStepAnchor` pattern in the store is a template for a future `setStepPaneVisibility` action that will be added in TASK-71.2.

### Verification
Run `npm test` (or `pnpm test`) in `web/` — all existing tests must pass and new tests must pass.
<!-- SECTION:PLAN:END -->
