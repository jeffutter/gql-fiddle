---
id: TASK-64
title: 'feat(web): define Tour data model and share encoding (#t= prefix)'
status: To Do
assignee: []
created_date: '2026-06-20 03:12'
labels:
  - feat
  - web
  - tour
dependencies: []
priority: high
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the TypeScript types for the guided tour feature and wire up URL encoding/decoding. This is the foundational data layer that all other tour tickets depend on.

**Design decisions from planning session:**
- A tour has a `base` workspace (shared across steps) and per-step `overrides` (only what differs), to avoid repeating full subgraph payloads N times in the URL.
- Tours use a new `#t=` URL hash prefix, separate from the existing `#w=` workspace prefix. The app checks the prefix on load to decide between normal fiddle and tour playback mode.
- Tour draft (in-progress authoring) persists to localStorage via Zustand, same pattern as the workspace.

**Types to add to `web/src/core/types.ts`:**
```ts
export interface Tour {
  title: string;
  base: WorkspacePayload;
  steps: TourStep[];
}

export interface TourStep {
  label: string;
  prose: string;
  anchor?: { subgraphIndex: number; typeName: string; fieldName?: string };
  overrides?: Partial<WorkspacePayload>;
}
```

`WorkspacePayload` is already defined in `web/src/share.ts`.

**`web/src/share.ts` additions:**
- `encodeTour(tour: Tour): string` — JSON → gzip → base64url → `#t=` prefix (same compression as existing `encode`)
- `decodeTour(hash: string): Tour` — inverse; throws if prefix is not `#t=`

**`web/src/store.ts` additions:**
- Add `tourDraft: Tour | null` to `WorkspaceState`
- Add `setTourDraft(tour: Tour | null)` action
- Include `tourDraft` in the `partialize` config so it persists to localStorage
- A helper `resolveTourStep(tour: Tour, stepIndex: number): WorkspacePayload` that merges `tour.base` with `tour.steps[stepIndex].overrides` — pure function, can live in `share.ts` or a new `tour.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tour and TourStep types are exported from web/src/core/types.ts
- [ ] #2 encodeTour produces a string starting with #t=
- [ ] #3 decodeTour round-trips a Tour value losslessly
- [ ] #4 decodeTour throws a clear error if the prefix is not #t=
- [ ] #5 tourDraft persists across page reloads via localStorage
- [ ] #6 resolveTourStep merges base and overrides correctly — overrides replace at the top-level key granularity (subgraphs, queryTabs, seed) not per-subgraph
- [ ] #7 resolveTourStep with undefined overrides returns base unchanged
- [ ] #8 Unit tests cover encode/decode round-trip and resolveTourStep merge logic
<!-- AC:END -->
