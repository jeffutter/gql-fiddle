---
id: TASK-64
title: 'feat(web): define Tour data model and share encoding (#t= prefix)'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-20 03:12'
updated_date: '2026-06-20 13:55'
labels:
  - feat
  - web
  - tour
  - planned
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
- [x] #1 Tour and TourStep types are exported from web/src/core/types.ts
- [x] #2 encodeTour produces a string starting with #t=
- [x] #3 decodeTour round-trips a Tour value losslessly
- [x] #4 decodeTour throws a clear error if the prefix is not #t=
- [x] #5 tourDraft persists across page reloads via localStorage
- [x] #6 resolveTourStep merges base and overrides correctly — overrides replace at the top-level key granularity (subgraphs, queryTabs, seed) not per-subgraph
- [x] #7 resolveTourStep with undefined overrides returns base unchanged
- [x] #8 Unit tests cover encode/decode round-trip and resolveTourStep merge logic
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Scope
All changes span three files: `web/src/share.ts`, `web/src/store.ts`, and `web/src/share.test.ts`. No sub-tickets needed — the work is tightly coupled and ships as one unit.

### Circular-dependency note
The ticket proposes putting `Tour`/`TourStep` in `types.ts`, but `TourStep.overrides` references `WorkspacePayload` (defined in `share.ts`), and `encodeTour`/`decodeTour` in `share.ts` need `Tour`. Importing `Tour` from `types.ts` into `share.ts` while `types.ts` imports `WorkspacePayload` from `share.ts` is a circular dependency. Resolution: define `Tour` and `TourStep` directly in `share.ts` alongside `WorkspacePayload`. Acceptance criterion #1 ('exported from types.ts') is satisfied by re-exporting: `export type { Tour, TourStep } from './share'` in `types.ts` if needed by consumers, but the canonical home is `share.ts`.

---

### Step 1 — Add types to `web/src/share.ts`

After the existing `WorkspacePayload` interface, add:

```ts
export interface TourStep {
  label: string;
  prose: string;
  anchor?: { subgraphIndex: number; typeName: string; fieldName?: string };
  overrides?: Partial<WorkspacePayload>;
}

export interface Tour {
  title: string;
  base: WorkspacePayload;
  steps: TourStep[];
}
```

Also add the new hash-prefix constant near the existing `HASH_PREFIX`:

```ts
const TOUR_HASH_PREFIX = '#t=';
```

---

### Step 2 — Add `encodeTour` to `web/src/share.ts`

Mirrors the existing `encode` implementation exactly, just with a different prefix:

```ts
export function encodeTour(tour: Tour): string {
  const json = JSON.stringify(tour);
  const compressed = pako.gzip(json);
  return TOUR_HASH_PREFIX + uint8ToBase64url(compressed);
}
```

---

### Step 3 — Add `decodeTour` to `web/src/share.ts`

```ts
export function decodeTour(hash: string): Tour {
  if (!hash.startsWith(TOUR_HASH_PREFIX) || hash.length === TOUR_HASH_PREFIX.length) {
    throw new Error('Invalid tour hash: must start with #t= and contain encoded data');
  }
  const encoded = hash.slice(TOUR_HASH_PREFIX.length);
  const bytes = base64urlToUint8(encoded);
  const json = pako.inflate(bytes, { to: 'string' });
  return JSON.parse(json) as Tour;
}
```

Throws clearly if the prefix is not `#t=` or if payload is empty — no backward-compat branch needed (new format, no legacy data).

---

### Step 4 — Add `resolveTourStep` to `web/src/share.ts`

Pure function, no side effects. Top-level key granularity merge (spread):

```ts
export function resolveTourStep(tour: Tour, stepIndex: number): WorkspacePayload {
  const step = tour.steps[stepIndex];
  if (!step.overrides) return tour.base;
  return { ...tour.base, ...step.overrides };
}
```

---

### Step 5 — Update `web/src/store.ts`

1. Import `Tour` from `./share`.

2. Add to `WorkspaceState` interface:
   ```ts
   tourDraft: Tour | null;
   setTourDraft: (tour: Tour | null) => void;
   ```

3. Add to the initial state object inside `create`:
   ```ts
   tourDraft: null,
   setTourDraft: (tour) => set({ tourDraft: tour }),
   ```

4. Add `tourDraft` to the `partialize` config:
   ```ts
   partialize: (state) => ({
     subgraphs:      state.subgraphs,
     activeSubgraph: state.activeSubgraph,
     queryTabs:      state.queryTabs,
     activeQueryTab: state.activeQueryTab,
     seed:           state.seed,
     tourDraft:      state.tourDraft,   // ← new
   }),
   ```

---

### Step 6 — Tests in `web/src/share.test.ts`

Add a new `describe('tour encode/decode')` block:

1. **Round-trip:** `decodeTour(encodeTour(tour))` deep-equals original
2. **Prefix:** `encodeTour()` result starts with `#t=`
3. **URL-safe chars:** payload after prefix matches `^[A-Za-z0-9_-]+$`
4. **Error: wrong prefix:** `decodeTour('#w=...')` throws
5. **Error: empty string:** `decodeTour('')` throws
6. **Error: prefix only:** `decodeTour('#t=')` throws

Add a separate `describe('resolveTourStep')` block:

7. **No overrides:** returns `tour.base` reference unchanged
8. **With overrides:** merged result has overrides keys win, unaffected keys from base survive
9. **Partial override:** only overriding `seed` leaves `subgraphs`/`queryTabs` from base

Use a `SAMPLE_TOUR` fixture (inline const, matching pattern of existing `SAMPLE_PAYLOAD`).

---

### Verification

```bash
cd web && npm test -- --run   # all share tests pass
```

Manually verify localStorage persistence: open app, call `useWorkspace.getState().setTourDraft({...})` in console, reload — value should survive.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented Tour/TourStep types in web/src/share.ts (canonical home, avoids circular dependency with types.ts). Re-exported via `export type { Tour, TourStep } from '../share'` in web/src/core/types.ts to satisfy AC#1. Added encodeTour, decodeTour, and resolveTourStep to share.ts. Updated store.ts to add tourDraft: Tour | null state with setTourDraft action, included in partialize for localStorage persistence. Added 10 new tests in share.test.ts covering round-trip, prefix validation, error cases, and resolveTourStep merge logic. All 205 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the Tour data model and #t= URL encoding as the foundational data layer for the guided tour feature. Tour and TourStep interfaces are defined in web/src/share.ts (canonical home to avoid circular imports with types.ts) and re-exported from web/src/core/types.ts. Added encodeTour/decodeTour (gzip+base64url with #t= prefix) and resolveTourStep (top-level spread merge of base + overrides) to share.ts. Extended the Zustand store with tourDraft: Tour | null and setTourDraft action, included in partialize so it persists to localStorage. Added 10 tests covering encode/decode round-trip, prefix validation, error cases (wrong prefix, empty string, prefix-only), and resolveTourStep merge semantics. All 205 tests pass."
<!-- SECTION:FINAL_SUMMARY:END -->
