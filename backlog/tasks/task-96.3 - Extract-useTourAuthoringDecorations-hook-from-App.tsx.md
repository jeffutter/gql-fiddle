---
id: TASK-96.3
title: Extract useTourAuthoringDecorations() hook from App.tsx
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 22:58'
labels:
  - review
  - planned
dependencies: []
parent_task_id: TASK-96
priority: low
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pull the three tour-authoring editor effects — click-to-anchor onMouseDown, anchor decoration, and tour-step highlight (web/src/App.tsx ~458-635, ~180 lines) — into a hook taking editor/monacoInstance/tourDraft/tourActiveStep/activeSubgraph. Removes the heaviest ref-juggling from the component body.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tour decoration and disposal bookkeeping live in one hook
- [x] #2 behavior is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Sequencing: no upstream dependency. TASK-112 (auto-run deps) and TASK-113 (Monaco singleton/vim) touch unrelated code (the debounced-compose effect ~L693-725 and the vim/completion effects further down) — neither overlaps the three tour-authoring effects this ticket moves (current L511-688). TASK-96.1/TASK-96.2 also touch disjoint effects (Monaco singleton wiring, compose/validate/run pipeline). This ticket can proceed independently of all four; no `--dep` needed.

Current state (web/src/App.tsx, verified by line number as of this planning pass — re-verify at execution time since TASK-96.1/96.2 will shift line numbers when they land):
- L328-330: `anchorDecorationRef` — Monaco decorations collection ref for the anchor gutter/line highlight. Used only by the anchor-decoration effect (L584-639) below. Move into the hook.
- L332: `anchorMouseListenerRef` — disposable ref for the schema editor's onMouseDown listener. Used only by the click-to-anchor effect (L513-581) below. Move into the hook.
- L334: `tourHighlightHandleRef: TourHighlightHandle | null` — used only by the tour-step-highlight effect (L645-688) below. Move into the hook; `TourHighlightHandle` type import (`./tourHighlight`) moves with it (verify it isn't used elsewhere in App.tsx before deleting the import — it currently is not).
- L513-581: click-to-anchor effect. Deps: `editor, monacoInstance, tourDraft, tourAuthoringOpen, tourActiveStep, activeSubgraph, subgraphs, setStepAnchor`. Registers `editor.onMouseDown`, resolves the clicked schema position via `loadCore()` + `core.nodeAtPosition(sdl, line, col)`, then toggles/sets the active step's anchor via `setStepAnchor`. Reads a **fresh** anchor snapshot mid-closure via `activeWorkspace(useWorkspace.getState()).tourDraft?.steps[tourActiveStep]?.anchor` (not the effect's own `tourDraft` closure variable) to avoid stale-closure toggle bugs on rapid clicks — preserve this exact pattern, do not simplify to the closed-over `tourDraft`. Needs `activeWorkspace` and `useWorkspace` imports from `./store`.
- L584-639: anchor-decoration effect. Deps: `tourDraft, tourActiveStep, activeSubgraph, editor, monacoInstance`. Reads `editor.getModel()!.getValue()` directly (does NOT need `subgraphs`), locates the anchor's type/field line via regex scan, and sets `anchorDecorationRef.current` via `editor.createDecorationsCollection(...)`.
- L645-688: tour-step-highlight effect. Deps: `editor, monacoInstance, tourDraft, tourActiveStep, activeSubgraph, subgraphs, setActiveSubgraph`. If the current step's anchor targets a different subgraph, calls `setActiveSubgraph(...)` and returns early (effect re-fires after the subgraph switches). Otherwise computes `currentSdl`/`prevSdl` from `subgraphs[activeSubgraph]` and `resolveTourStep(tourDraft, tourActiveStep - 1)` (or `tourDraft.base` for step 0), then calls `applyTourHighlight(editor, monacoInstance, step, currentSdl, prevSdl, activeSubgraph)`, storing the disposable handle in `tourHighlightHandleRef`.
- None of `anchorDecorationRef`, `anchorMouseListenerRef`, `tourHighlightHandleRef` are read/written anywhere else in App.tsx (verified by grep) — safe to move wholesale.
- `tourAuthoringOpen` (L283, local `useState`) is read elsewhere in App.tsx (JSX at ~L1767, ~L2454) and must stay declared in App.tsx; pass it into the hook as a parameter, don't move its `useState`.
- `setStepAnchor` and `setActiveSubgraph` come from `useWorkspace()` (L252, L258) and are also used elsewhere in App.tsx (`setActiveSubgraph` by the subgraph tab click handler ~L1225; `setStepAnchor` only here) — keep both destructured in App.tsx, pass through as hook params.
- `subgraphs`, `activeSubgraph`, `tourDraft`, `tourActiveStep`, `editor`, `monacoInstance` are all read elsewhere in App.tsx too (JSX, other effects) — stay as-is in App.tsx, passed into the hook as params, not moved.

Implementation:

1. Create `web/src/useTourAuthoringDecorations.ts`:
   - Imports: `useEffect, useRef` from `"react"`; `* as _monaco` from `"monaco-editor"`; `loadCore` from `"./core"`; `resolveTourStep` from `"./share"`; `type { Tour } from "./share"`; `applyTourHighlight` from `"./tourHighlight"`; `type { TourHighlightHandle } from "./tourHighlight"`; `type { SubgraphInput } from "./core/types"`; `activeWorkspace, useWorkspace` from `"./store"`.
   - Export:
     ```ts
     export function useTourAuthoringDecorations(params: {
       editor: _monaco.editor.IStandaloneCodeEditor | null;
       monacoInstance: typeof _monaco | null;
       tourDraft: Tour | null;
       tourActiveStep: number | null;
       activeSubgraph: number;
       tourAuthoringOpen: boolean;
       subgraphs: SubgraphInput[];
       setStepAnchor: (
         stepIndex: number,
         anchor: { subgraphIndex: number; typeName: string; fieldName?: string } | undefined,
       ) => void;
       setActiveSubgraph: (index: number) => void;
     }): void
     ```
   - Destructure `params` inside the hook body (mirrors the App.tsx style used by `useGraphQLPipeline`'s params object).
   - Declare the three refs (`anchorDecorationRef`, `anchorMouseListenerRef`, `tourHighlightHandleRef`) exactly as today.
   - Move the three effects verbatim (bodies, cleanup functions, and dependency arrays unchanged — dependency arrays now reference the destructured params instead of component-local variables, which is a no-op since they're the same identifiers).
   - No return value — this hook is pure side-effect wiring (App.tsx doesn't consume any output from these three effects today).

2. Edit `web/src/App.tsx`:
   - Add `import { useTourAuthoringDecorations } from "./useTourAuthoringDecorations";`.
   - Remove the `TourHighlightHandle` type import (L30) if `applyTourHighlight`/`TourHighlightHandle` are no longer referenced directly in App.tsx after the move (re-check: `applyTourHighlight` L29 import should also be removed if unused elsewhere — verify via grep before deleting either import).
   - Remove the three ref declarations (L328-334, keeping the unrelated `decorationsRef` and `mockConfigFieldKeysRef`/etc. that live in the same block).
   - Remove the three effects (L513-581, L584-639, L645-688) in their entirety.
   - Immediately after the removed block (where the effects used to be, before the `composeTimeoutRef` declaration), add:
     ```ts
     useTourAuthoringDecorations({
       editor,
       monacoInstance,
       tourDraft,
       tourActiveStep,
       activeSubgraph,
       tourAuthoringOpen,
       subgraphs,
       setStepAnchor,
       setActiveSubgraph,
     });
     ```

3. Verification:
   - `pnpm --dir web exec tsc --noEmit` — confirms no dangling references to the removed refs/imports and correct typing on the new hook's params.
   - `pnpm --dir web lint` — confirms `react-hooks/exhaustive-deps` is satisfied inside the new hook file for all three effects.
   - `pnpm --dir web test run App.test.tsx` — must pass unmodified (no existing test in App.test.tsx exercises click-to-anchor/anchor-decoration/tour-highlight directly, per grep — this is a pure move with no test coverage change expected).
   - `pnpm --dir web test run tourHighlight.test.ts` — unaffected (tests `applyTourHighlight` directly, not this hook), run anyway to catch incidental regressions.
   - Manually grep App.tsx afterward for `anchorDecorationRef`, `anchorMouseListenerRef`, `tourHighlightHandleRef` — should return zero matches, confirming the extraction is complete.
   - Manual smoke check (no automated coverage exists for this interaction): open the tour authoring panel, select a step, click a type/field in the schema editor, confirm the anchor toggles and the gutter/line decoration appears; step through tour steps and confirm the highlight decoration updates and switches subgraphs when an anchor targets a different one.
   - Run the full `pnpm --dir web test run` once to catch incidental regressions from the import/effect reshuffle.

No new sub-tickets: this is a single, tightly-coupled mechanical extraction (one new file + corresponding removals in App.tsx) that should ship as one change; splitting the three effects into separate tickets would fragment one coherent hook for no benefit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created web/src/useTourAuthoringDecorations.ts, moving the three tour-authoring editor effects (click-to-anchor onMouseDown, anchor gutter/line decoration, tour-step highlight) verbatim out of App.tsx, along with their three private refs (anchorDecorationRef, anchorMouseListenerRef, tourHighlightHandleRef). App.tsx now calls useTourAuthoringDecorations({editor, monacoInstance, tourDraft, tourActiveStep, activeSubgraph, tourAuthoringOpen, subgraphs, setStepAnchor, setActiveSubgraph}). Removed now-unused imports from App.tsx: applyTourHighlight, TourHighlightHandle, resolveTourStep. App.tsx shrank from 2547 to 2371 lines. Verified: tsc --noEmit clean, lint shows only 2 pre-existing unrelated warnings (doRun/activeWorkspaceIndex exhaustive-deps, confirmed present before this change via git stash), full test suite (393 tests, 18 files) passes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted the three tour-authoring editor effects (click-to-anchor, anchor decoration, tour-step highlight) and their associated refs from App.tsx into a new useTourAuthoringDecorations() hook, shrinking App.tsx by ~176 lines with no behavior change. All tests pass and typecheck/lint are clean.
<!-- SECTION:FINAL_SUMMARY:END -->
