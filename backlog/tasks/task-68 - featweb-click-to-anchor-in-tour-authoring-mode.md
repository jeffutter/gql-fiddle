---
id: TASK-68
title: 'feat(web): click-to-anchor in tour authoring mode'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-20 03:13'
updated_date: '2026-06-20 14:33'
labels:
  - feat
  - web
  - tour
  - planned
dependencies:
  - TASK-64
  - TASK-65
  - TASK-66
priority: medium
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While the tour authoring panel is open, clicking on a type or field name in the schema editor sets that node as the anchor for the current step. The anchor is used by the highlight system (TASK-69) to draw attention to a specific schema element in playback.

**Design decisions from planning session:**
- Click handler is active only when the authoring panel is open (not in normal fiddle mode).
- On click, call the WASM `nodeAtPosition(sdl, line, col)` export (from TASK-65) with the Monaco cursor position.
- If the result is non-null `{ typeName, fieldName? }`, store it as `step.anchor = { subgraphIndex: activeSubgraph, typeName, fieldName }` on the current step.
- If the result is null (click landed on whitespace, a directive argument, etc.), do nothing.
- Visual feedback: the anchored line gets a distinct Monaco decoration (e.g. a small pin icon in the gutter, or a subtle left-border highlight) so the author knows what's anchored. A small "clear anchor" button appears in the authoring panel next to the anchor display.
- Clicking the same line again, or clicking "clear anchor," removes the anchor from the step.
- Only one anchor per step.

**Monaco integration:**
- Register a click handler on the schema editor instance via `editor.onMouseDown` when authoring mode is active. Remove it when authoring mode exits.
- Use `editor.createDecorationsCollection` for the anchor indicator decoration (same pattern as existing field-attribution decorations in `App.tsx`).

**Files likely touched:** `web/src/App.tsx` (or `TourAuthoringPanel.tsx`), `web/src/core/index.ts` (wire up new WASM export).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking a type declaration line in the schema editor while authoring sets anchor.typeName with no fieldName
- [x] #2 Clicking a field line sets both anchor.typeName and anchor.fieldName
- [x] #3 Clicking whitespace or a directive argument does not change the anchor
- [x] #4 The anchored line is visually indicated in the Monaco editor (gutter decoration or similar)
- [x] #5 The authoring panel shows the current anchor (e.g. 'Product.price') with a clear button
- [x] #6 Clicking 'clear anchor' removes the anchor and the Monaco decoration
- [x] #7 Clicking a different line replaces the existing anchor
- [x] #8 The click handler is only active when the authoring panel is open
- [x] #9 Anchor is saved when 'Save Step' or 'Add Step' is called
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add click-to-anchor to the tour authoring workflow. When the authoring panel is open, clicking a type or field declaration in the schema editor calls `nodeAtPosition` (from TASK-65 WASM export), stores the result as `step.anchor` on the active tour step, and decorates the anchored line in Monaco with a gutter indicator. The authoring panel shows the current anchor and a clear button.

No sub-tickets needed — all pieces (click handler, decoration, store update, panel display) are tightly coupled and ship together as one unit.

---

## Scope

All changes are in the web frontend. No Rust/WASM changes needed (TASK-65 already exported `nodeAtPosition`).

**Files to modify:**
- `web/src/App.tsx` — register `editor.onMouseDown` when authoring is active; manage anchor decoration ref
- `web/src/TourAuthoringPanel.tsx` — display current anchor and clear button in the active step card
- `web/src/store.ts` — add `setStepAnchor` action (or update via `snapshotCurrentToStep` pattern; see note below)
- `web/src/theme.css` — add `.tour-anchor-*` CSS classes for the decoration and panel display

---

## Step 1 — Add `setStepAnchor` to store.ts

The anchor for the active step must be written into `tourDraft.steps[i].anchor`. Add a new action:

```ts
// In WorkspaceState interface:
setStepAnchor: (
  stepIndex: number,
  anchor: { subgraphIndex: number; typeName: string; fieldName?: string } | undefined
) => void;
```

Implementation in the `create(...)` body:

```ts
setStepAnchor: (stepIndex, anchor) =>
  set((state) => {
    if (!state.tourDraft) return state;
    const updatedSteps = state.tourDraft.steps.map((step, i) =>
      i === stepIndex ? { ...step, anchor } : step
    );
    return { tourDraft: { ...state.tourDraft, steps: updatedSteps } };
  }),
```

This is separate from `snapshotCurrentToStep` (which captures overrides) — anchors are set independently and immediately on click.

---

## Step 2 — Register click handler in App.tsx

### 2a. New refs

Add two refs alongside the existing `decorationsRef`:

```ts
// Anchor decoration on the schema editor (one line highlighted when a step anchor is set).
const anchorDecorationRef = useRef<ReturnType<
  _monaco.editor.IStandaloneCodeEditor["createDecorationsCollection"]
> | null>(null);

// Disposable for the onMouseDown listener — needed to clean it up.
const anchorMouseListenerRef = useRef<_monaco.IDisposable | null>(null);
```

### 2b. Destructure new store values

In the `useWorkspace()` destructure, add:

```ts
tourActiveStep,
setStepAnchor,
activeSubgraph,  // already present
```

(`tourAuthoringOpen` is already local state.)

### 2c. Register/unregister `onMouseDown` effect

Add a `useEffect` that depends on `[editor, monacoInstance, tourDraft, tourAuthoringOpen, tourActiveStep, activeSubgraph]`:

```ts
useEffect(() => {
  // Clean up any previous listener.
  anchorMouseListenerRef.current?.dispose();
  anchorMouseListenerRef.current = null;

  // Only active when the authoring panel is open and there is an active step.
  if (!editor || !monacoInstance || !tourDraft || !tourAuthoringOpen || tourActiveStep === null) {
    return;
  }

  const listener = editor.onMouseDown(async (e) => {
    // Only handle clicks on content (not the gutter or scrollbar).
    if (e.target.type !== monacoInstance.editor.MouseTargetType.CONTENT_TEXT &&
        e.target.type !== monacoInstance.editor.MouseTargetType.CONTENT_EMPTY) {
      return;
    }
    const pos = e.target.position;
    if (!pos) return;

    const sdl = subgraphs[activeSubgraph]?.sdl ?? "";
    const core = await loadCore();
    const result = core.nodeAtPosition(sdl, pos.lineNumber, pos.column);

    if (result === null) {
      // Clicked whitespace/directive arg — no-op (do not clear existing anchor).
      return;
    }

    const newAnchor = {
      subgraphIndex: activeSubgraph,
      typeName: result.typeName,
      ...(result.fieldName ? { fieldName: result.fieldName } : {}),
    };

    // If clicking the same anchor that's already set, toggle it off (clear).
    const currentAnchor = tourDraft.steps[tourActiveStep]?.anchor;
    if (
      currentAnchor &&
      currentAnchor.subgraphIndex === newAnchor.subgraphIndex &&
      currentAnchor.typeName === newAnchor.typeName &&
      currentAnchor.fieldName === newAnchor.fieldName
    ) {
      setStepAnchor(tourActiveStep, undefined);
    } else {
      setStepAnchor(tourActiveStep, newAnchor);
    }
  });

  anchorMouseListenerRef.current = listener;

  return () => {
    anchorMouseListenerRef.current?.dispose();
    anchorMouseListenerRef.current = null;
  };
}, [editor, monacoInstance, tourDraft, tourAuthoringOpen, tourActiveStep, activeSubgraph, subgraphs, setStepAnchor]);
```

**Note on `MouseTargetType`:** Monaco exposes `editor.MouseTargetType` as an enum. The relevant values are `CONTENT_TEXT` (click on actual text) and `CONTENT_EMPTY` (click on empty space within a line). Clicking the gutter produces `GUTTER_*` values. We want both text and empty-line clicks to trigger the lookup (an empty line inside a type block should still map to the enclosing type via `nodeAtPosition`'s span logic from TASK-65).

### 2d. Update anchor decoration effect

Add another `useEffect` that updates the Monaco anchor decoration whenever the active step's anchor changes:

```ts
useEffect(() => {
  const schemaEditor = editor;
  if (!schemaEditor || !monacoInstance) {
    anchorDecorationRef.current?.clear();
    return;
  }

  // Clear any existing anchor decoration.
  anchorDecorationRef.current?.clear();
  anchorDecorationRef.current = null;

  if (tourActiveStep === null || !tourDraft) return;

  const anchor = tourDraft.steps[tourActiveStep]?.anchor;
  if (!anchor || anchor.subgraphIndex !== activeSubgraph) return;

  // Find the line number of the anchored node by calling nodeAtPosition in reverse.
  // We don't store the line number — instead we scan for the declaration line
  // by walking the model lines and calling nodeAtPosition for each until we
  // find a match. But this is O(n) over lines.
  //
  // Better approach: store the line number transiently, OR use a simpler heuristic:
  // scan the model for the text pattern "type TypeName" / "  fieldName:" and
  // highlight that line. A text search is fast and doesn't need WASM.

  const model = schemaEditor.getModel();
  if (!model) return;

  const sdl = model.getValue();
  const lines = sdl.split("\n");
  let targetLine: number | null = null;

  if (anchor.fieldName) {
    // Find "  fieldName:" inside the type block.
    // Search for the field name pattern within the context of the type.
    let inType = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(type|interface)\s+\w/.test(line) && line.includes(anchor.typeName)) {
        inType = true;
      } else if (inType && /^\}/.test(line)) {
        inType = false;
      } else if (inType) {
        // Match field name at start of content (allowing leading whitespace).
        const fieldPattern = new RegExp(`^\\s+${anchor.fieldName}\\s*[:(]`);
        if (fieldPattern.test(line)) {
          targetLine = i + 1; // Monaco lines are 1-based
          break;
        }
      }
    }
  } else {
    // Find "type TypeName" or "interface TypeName" declaration line.
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^(type|interface)\\s+${anchor.typeName}[\\s{@]`).test(lines[i])) {
        targetLine = i + 1;
        break;
      }
    }
  }

  if (targetLine === null) return;

  anchorDecorationRef.current = schemaEditor.createDecorationsCollection([
    {
      range: new monacoInstance.Range(targetLine, 1, targetLine, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: "tour-anchor-gutter",
        className: "tour-anchor-line",
      },
    },
  ]);
}, [tourDraft, tourActiveStep, activeSubgraph, editor, monacoInstance]);
```

**Note on line finding:** The regex-based scan is fast (O(lines)) and avoids an async WASM call in a pure display effect. It handles the typical GraphQL SDL format. Edge cases (types with the same prefix) are acceptable — the anchor identifies by `typeName`/`fieldName` semantically; the decoration is cosmetic.

---

## Step 3 — Display anchor in TourAuthoringPanel.tsx

### 3a. Destructure new store action

In `TourAuthoringPanel`, add to the `useWorkspace()` destructure:

```ts
setStepAnchor,
```

### 3b. Add anchor display in the active step card

In the step card JSX, after `{isEditing && <textarea ... />}` and before `{isActive && <div className="tour-step__actions">}`, add an anchor display section:

```tsx
{isActive && (
  <div className="tour-step__anchor">
    {step.anchor ? (
      <>
        <span className="tour-step__anchor-label">
          {step.anchor.fieldName
            ? `${step.anchor.typeName}.${step.anchor.fieldName}`
            : step.anchor.typeName}
        </span>
        <button
          className="btn btn--icon tour-step__anchor-clear"
          onClick={() => setStepAnchor(i, undefined)}
          title="Clear anchor"
          aria-label="Clear anchor"
        >
          ×
        </button>
      </>
    ) : (
      <span className="tour-step__anchor-empty">
        Click a type or field in the schema editor to set an anchor
      </span>
    )}
  </div>
)}
```

---

## Step 4 — Add CSS to theme.css

Append after the `.tour-step__actions` block:

```css
/* Anchor indicator row inside an active step card */
.tour-step__anchor {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  min-height: 24px;
  font-size: 11px;
}

.tour-step__anchor-label {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tour-step__anchor-empty {
  flex: 1;
  color: var(--text-faint);
  font-style: italic;
}

.tour-step__anchor-clear {
  flex-shrink: 0;
  font-size: 12px;
}

/* Monaco anchor decoration — gutter indicator (pin icon via content) */
.tour-anchor-gutter {
  background: var(--accent);
  width: 3px !important;
  border-radius: 2px;
  margin-left: 3px;
}

/* Monaco anchor decoration — subtle left-border on the anchored line */
.tour-anchor-line {
  border-left: 3px solid var(--accent);
  padding-left: 1px;
  opacity: 0.6;
}
```

---

## Step 5 — Acceptance Criteria Coverage

- AC#1 Type declaration click → `anchor.typeName` set, no `fieldName` — covered by `nodeAtPosition` returning `{ typeName }` and the click handler writing it.
- AC#2 Field line click → both `typeName` and `fieldName` set.
- AC#3 Whitespace/directive arg → `nodeAtPosition` returns `null`, handler returns early, no change.
- AC#4 Anchored line gets Monaco decoration (`tour-anchor-line` className + `tour-anchor-gutter`).
- AC#5 Authoring panel shows anchor (`tour-step__anchor-label`) or hint when none.
- AC#6 Clear button calls `setStepAnchor(i, undefined)`, decoration effect clears on next render.
- AC#7 Clicking a different line replaces the anchor (same click handler, no guard against existing anchor unless same identity).
- AC#8 Click handler only registered when `tourAuthoringOpen && tourActiveStep !== null`.
- AC#9 Anchor saved when Save Step / Add Step is called — `step.anchor` is already on the step object in `tourDraft`; `snapshotCurrentToStep` merges it in naturally since it only touches `overrides`, not `anchor`. **Verify:** `snapshotCurrentToStep` must NOT clear `anchor` — check the implementation. It currently does `{ ...step, overrides }` which preserves `anchor`. No change needed.

---

## Step 6 — Testing

Extend `web/src/store.test.ts`:
1. `setStepAnchor(0, { subgraphIndex: 0, typeName: 'Product' })` — sets anchor on step 0
2. `setStepAnchor(0, undefined)` — clears anchor
3. `snapshotCurrentToStep(0)` after anchor is set — anchor is preserved in the updated step

No JSDOM test for the Monaco click handler (Monaco can't mount in jsdom). The click interaction is verified manually.

**Manual smoke test:**
1. Open app → Create Tour → Add Step
2. Click on `type Product` line in schema editor → authoring panel shows `Product`, Monaco line is highlighted
3. Click on `  id: ID!` line → panel shows `Product.id`
4. Click same line again → anchor cleared
5. Click whitespace-only line → no change
6. Click "×" clear button → anchor removed, decoration cleared
7. Click "Save Step" → anchor persists in the step (can verify via `useWorkspace.getState()` in console)

---

## Verification

```bash
cd /home/jeffutter/src/gql-fiddle/web
pnpm test run          # store tests pass
pnpm tsc --noEmit      # no type errors
pnpm lint              # no lint errors
```
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented all changes in the web frontend only (no Rust/WASM changes needed — `nodeAtPosition` was already exported from TASK-65).

**Files modified:**
- `web/src/store.ts` — added `setStepAnchor` action to `WorkspaceState` interface and implementation
- `web/src/App.tsx` — added `anchorDecorationRef` and `anchorMouseListenerRef` refs; added `tourActiveStep`/`setStepAnchor` to `useWorkspace()` destructure; registered `onMouseDown` effect and anchor decoration effect
- `web/src/TourAuthoringPanel.tsx` — added `setStepAnchor` to `useWorkspace()` destructure; added anchor display row (`.tour-step__anchor`) with label and clear button
- `web/src/theme.css` — added `.tour-step__anchor*` and `.tour-anchor-*` CSS classes
- `web/src/store.test.ts` — added 4 new tests covering `setStepAnchor` and anchor preservation through `snapshotCurrentToStep`

**Key design note:** The click handler reads fresh state from `useWorkspace.getState()` inside the async callback to avoid stale closure issues with `tourDraft`. The anchor decoration effect scans SDL lines with regex to find the declaration line (O(lines), avoids async WASM call in a sync effect).

All 230 tests pass, TypeScript clean, lint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added click-to-anchor to the tour authoring workflow. When the authoring panel is open and a step is selected, clicking a type or field declaration in the schema editor calls `nodeAtPosition` (WASM), stores the result as `step.anchor` on the active tour step, and decorates the anchored line in Monaco with a gutter bar and line highlight. The authoring panel shows the current anchor (e.g. 'Product.price') with a clear button. All 9 acceptance criteria are met. 4 new store tests added (230 total, all passing). TypeScript and lint clean."
<!-- SECTION:FINAL_SUMMARY:END -->
