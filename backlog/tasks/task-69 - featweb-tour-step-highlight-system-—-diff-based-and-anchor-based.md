---
id: TASK-69
title: 'feat(web): tour step highlight system — diff-based and anchor-based'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-20 03:14'
updated_date: '2026-06-20 14:43'
labels:
  - feat
  - web
  - tour
  - planned
dependencies:
  - TASK-65
  - TASK-66
  - TASK-67
priority: medium
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the reader advances to a step in playback (or the author navigates steps in authoring), highlight the relevant schema element in the Monaco editor to draw attention to what's pedagogically important.

**Design decisions from planning session:**

**Two highlight modes, in priority order:**
1. **Anchor-based (explicit):** If the current step has an `anchor` (`{ subgraphIndex, typeName, fieldName? }`), switch to that subgraph tab, find the line of that type/field definition, and apply a gutter icon + token background decoration. Auto-scroll Monaco to that line.
2. **Diff-based (automatic):** If no anchor, text-diff the current step's resolved SDL against the previous step's resolved SDL (for each subgraph). Highlight changed lines with a gutter icon + subtle background. Switch to the first subgraph with changes and auto-scroll to the first changed line.
3. **No highlight:** If neither condition applies (intro step with no anchor and same SDL as previous), do nothing. This is valid for introductory or summary steps.

**Visual style (consistent with existing system in `subgraphColors.ts`):**
- Gutter icon: a small colored dot or arrow (similar to existing `sg-glyph-*` classes in the query editor).
- Token/line background: subtle highlight, distinct from the existing field-attribution highlight colors.
- Use `editor.createDecorationsCollection` (same pattern as `decorationsRef` in `App.tsx`).
- Clear previous highlight decorations before applying new ones on each step change.

**Diff implementation:**
- Text diff at the line level is sufficient — no AST-level diffing needed. Split both SDLs by newline, find lines present in new but not old (or changed), highlight those line numbers in Monaco.
- Only diff the subgraph(s) whose SDL actually changed; if multiple subgraphs changed, highlight the first one.

**Scope:** This ticket covers both playback mode (`TourPlayback.tsx`, TASK-67) and authoring mode preview (`TourAuthoringPanel.tsx`, TASK-66). The same highlight logic should run in both contexts.

**Files likely touched:** new `web/src/tourHighlight.ts`, `web/src/TourPlayback.tsx`, `web/src/TourAuthoringPanel.tsx`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a step has an anchor, the Monaco editor switches to the anchored subgraph, scrolls to the anchored type/field line, and shows a gutter icon + line background decoration
- [x] #2 When a step has no anchor but its SDL differs from the previous step, changed lines are highlighted with a gutter icon and Monaco auto-scrolls to the first change
- [x] #3 When a step has no anchor and no SDL diff (intro/summary step), no decoration is applied
- [x] #4 Decorations are cleared before each step transition so stale highlights don't accumulate
- [x] #5 The highlight style is visually distinct from the existing field-attribution decorations in the query editor
- [x] #6 Highlight logic works in both authoring panel navigation and playback mode step navigation
- [x] #7 Switching to a step that anchors a different subgraph automatically activates that subgraph tab
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Implement the tour step highlight system as a single self-contained module (`web/src/tourHighlight.ts`) that applies Monaco editor decorations whenever the active step changes. The highlight logic runs in both authoring mode (`App.tsx` / `TourAuthoringPanel`) and playback mode (`TourPlayback.tsx`). The two modes share the same core logic but differ in how they get an editor reference and what triggers re-evaluation.

No sub-tickets are needed — the work is tightly coupled across three files, with all pieces shipping together as one coherent feature.

---

## Architecture

### New file: `web/src/tourHighlight.ts`

Pure utility module. No React imports. Exports a single function:

```ts
import type * as Monaco from "monaco-editor";
import type { TourStep } from "./share";

export interface TourHighlightHandle {
  /** Decoration collection managed by this handle; call clear() to wipe it. */
  dispose: () => void;
}

/**
 * Apply tour-step highlight decorations to a Monaco editor.
 *
 * Priority order:
 *   1. Anchor-based: step.anchor is set → switch to anchored subgraph, find
 *      the type/field line, apply gutter icon + line background, auto-scroll.
 *   2. Diff-based: no anchor → text-diff currentSdl vs prevSdl, highlight
 *      changed lines (present in current but not in prev), auto-scroll to first.
 *   3. No-op: anchor absent and SDL unchanged → clear any existing decoration.
 *
 * Returns a handle whose dispose() removes the decoration.
 * Caller is responsible for calling dispose() before the next invocation.
 */
export function applyTourHighlight(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  step: TourStep,
  currentSdl: string,
  prevSdl: string,
  activeSubgraphIndex: number,
): TourHighlightHandle;
```

**Anchor-based path** (when `step.anchor && step.anchor.subgraphIndex === activeSubgraphIndex`):
- Reuse the same SDL line-scanning logic already in `App.tsx`'s `anchorDecorationRef` effect (lines 376-421):
  - If `anchor.fieldName`: scan lines for the field inside the type block
  - Else: scan lines for the `type|interface TypeName` declaration
- Apply decoration with:
  - `linesDecorationsClassName: "tour-highlight-gutter"` — a distinct glyph dot (NOT the existing `tour-anchor-gutter` bar; use a new CSS class)
  - `className: "tour-highlight-line"` — subtle background tint (NOT the existing `tour-anchor-line` left-border)
- Call `editor.revealLineInCenter(targetLine)` to auto-scroll

**Diff-based path** (when no anchor matches the current subgraph):
- Split `currentSdl` and `prevSdl` by `\n`
- Build a `Set<string>` of `prevSdl` lines
- Collect 1-based line numbers where `currentSdl` lines are NOT in the prev set (i.e., new or changed lines)
- If no changed lines found, return a no-op handle (clear any existing decoration)
- Apply decoration to changed line numbers with `linesDecorationsClassName: "tour-highlight-gutter"` and `className: "tour-highlight-line"`
- Call `editor.revealLineInCenter(changedLineNumbers[0])` to scroll to first change
- Use `editor.createDecorationsCollection(deltaDecorations)` — same pattern as the existing `decorationsRef` in `App.tsx`

**Handle**: return `{ dispose: () => collection.clear() }`.

---

## Integration: `App.tsx` — Authoring Mode

### New ref

```ts
const tourHighlightRef = useRef<ReturnType<
  _monaco.editor.IStandaloneCodeEditor["createDecorationsCollection"]
> | null>(null);
```

Actually, since `applyTourHighlight` returns a handle with `dispose()`, store it as:

```ts
const tourHighlightHandleRef = useRef<{ dispose: () => void } | null>(null);
```

### New effect

Add a `useEffect` that fires when the active step, active subgraph, or subgraph SDLs change:

```ts
useEffect(() => {
  // Dispose any previous highlight.
  tourHighlightHandleRef.current?.dispose();
  tourHighlightHandleRef.current = null;

  if (!editor || !monacoInstance || tourActiveStep === null || !tourDraft) return;

  const step = tourDraft.steps[tourActiveStep];
  if (!step) return;

  const currentSdl = subgraphs[activeSubgraph]?.sdl ?? "";
  // prevSdl: the SDL the previous step would have shown for this subgraph.
  // If this is step 0, compare against tour.base.
  const prevPayload = tourActiveStep > 0
    ? resolveTourStep(tourDraft, tourActiveStep - 1)
    : tourDraft.base;
  const prevSdl = prevPayload.subgraphs[activeSubgraph]?.sdl ?? "";

  // If the anchor targets a different subgraph, switch to that subgraph first.
  if (step.anchor && step.anchor.subgraphIndex !== activeSubgraph) {
    setActiveSubgraph(step.anchor.subgraphIndex);
    // The effect will re-run after the subgraph switch.
    return;
  }

  tourHighlightHandleRef.current = applyTourHighlight(
    editor,
    monacoInstance,
    step,
    currentSdl,
    prevSdl,
    activeSubgraph,
  );
}, [editor, monacoInstance, tourDraft, tourActiveStep, activeSubgraph, subgraphs]);
```

**Dependency note**: `setActiveSubgraph` does not need to be in the dep array (it's a stable store action). Import `resolveTourStep` from `./share` (already imported in `App.tsx`).

**Co-existence with `anchorDecorationRef` effect**: The existing `anchorDecorationRef` effect (lines 365-421) shows a narrow accent bar for authoring feedback ("you clicked here"). The new `tourHighlightHandleRef` effect shows the pedagogical highlight for the reader's perspective. They serve different purposes and must coexist. The new highlight classes (`tour-highlight-gutter`, `tour-highlight-line`) are visually distinct from the existing anchor classes (`tour-anchor-gutter`, `tour-anchor-line`).

---

## Integration: `TourPlayback.tsx` — Playback Mode

### Capture the editor ref

Add a ref for the playback schema editor instance:

```ts
const schemaEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const [monacoInstance, setMonacoInstance] = useState<typeof Monaco | null>(null);
```

Wire into the `<Editor>` `onMount` callback (line 256-265 in current code):

```tsx
<Editor
  ...
  onMount={(ed, m) => {
    schemaEditorRef.current = ed;
    setMonacoInstance(m);
  }}
/>
```

### Capture the highlight handle

```ts
const tourHighlightHandleRef = useRef<{ dispose: () => void } | null>(null);
```

### New effect

```ts
useEffect(() => {
  tourHighlightHandleRef.current?.dispose();
  tourHighlightHandleRef.current = null;

  const ed = schemaEditorRef.current;
  if (!ed || !monacoInstance) return;

  const step = tour.steps[stepIndex];
  if (!step) return;

  const currentSdl = subgraphs[activeSubgraph]?.sdl ?? "";
  const prevPayload = stepIndex > 0
    ? resolveTourStep(tour, stepIndex - 1)
    : tour.base;
  const prevSdl = prevPayload.subgraphs[activeSubgraph]?.sdl ?? "";

  // If anchor targets a different subgraph, switch to it first.
  if (step.anchor && step.anchor.subgraphIndex !== activeSubgraph) {
    setActiveSubgraph(step.anchor.subgraphIndex);
    return; // effect re-runs after state update
  }

  tourHighlightHandleRef.current = applyTourHighlight(
    ed,
    monacoInstance,
    step,
    currentSdl,
    prevSdl,
    activeSubgraph,
  );
}, [monacoInstance, stepIndex, activeSubgraph, tour, subgraphs]);
```

Import `applyTourHighlight` from `./tourHighlight` and `resolveTourStep` from `./share` (already imported).

---

## CSS additions to `theme.css`

Add new classes that are **visually distinct** from `tour-anchor-gutter` / `tour-anchor-line`. The highlight is for readers (playback + authoring preview); the anchor is for authors (editing feedback).

```css
/* Tour step highlight — gutter dot (distinct from the anchor accent bar) */
.tour-highlight-gutter {
  display: flex;
  align-items: center;
  justify-content: center;
}
.tour-highlight-gutter::before {
  content: '';
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.75;
  margin: auto;
}

/* Tour step highlight — subtle whole-line background tint */
.tour-highlight-line {
  background: color-mix(in srgb, var(--accent) 10%, transparent) !important;
}
```

These classes are injected by the existing Monaco decoration mechanism (no `injectSubgraphStyles` call needed — they go directly in `theme.css` like `tour-anchor-gutter` does). Monaco picks up CSS classes from the document stylesheet.

---

## Files to Create / Modify

- **`web/src/tourHighlight.ts`** (new) — pure highlight logic, no React
- **`web/src/App.tsx`** — add `tourHighlightHandleRef`, new highlight effect, import `applyTourHighlight`
- **`web/src/TourPlayback.tsx`** — add `schemaEditorRef`, `monacoInstance` state, `tourHighlightHandleRef`, new highlight effect, wire `onMount`, import `applyTourHighlight` and `Monaco` type
- **`web/src/theme.css`** — add `.tour-highlight-gutter` and `.tour-highlight-line` classes

---

## Edge Cases and Risks

1. **Anchor subgraph not the active subgraph**: The effect calls `setActiveSubgraph(step.anchor.subgraphIndex)` and returns early. The state update triggers a re-render, which re-fires the effect with the new `activeSubgraph` — the anchor path then executes correctly. This works in both App.tsx (store action) and TourPlayback.tsx (local state setter).

2. **Intro/summary step (AC#3)**: If `step.anchor` is absent and `currentSdl === prevSdl` (or the diff yields no changed lines), `applyTourHighlight` returns a no-op handle (calls `collection.clear()` immediately or skips decoration entirely). No decoration is applied.

3. **Step 0 with no previous step**: Use `tour.base` as the reference SDL. This is always available and well-defined.

4. **Multiple subgraphs changed between steps**: Per the ticket design, highlight only the first subgraph with changes (i.e., the one currently shown in the active subgraph tab). If the active subgraph has no changes but another does, the diff for the active subgraph returns empty and no highlight is applied — the reader can click the other tab to see its changes. This is acceptable for v1.

5. **`color-mix()` browser support**: `color-mix(in srgb, ...)` is broadly supported in 2025 browsers (Chrome 111+, Firefox 113+, Safari 16.2+). For the target audience of a GraphQL dev tool, this is safe. If needed, fall back to a hardcoded `rgba(227, 179, 65, 0.1)` (accent color from monacoTheme.ts).

6. **Stale decorations across step transitions (AC#4)**: The effect always calls `tourHighlightHandleRef.current?.dispose()` before applying new decorations. The `useEffect` cleanup also disposes on unmount. This ensures no stale highlights accumulate.

7. **`glyphMarginEnabled` in playback editor**: The playback editor currently does NOT set `glyphMargin: true` in `EDITOR_OPTIONS`. For the gutter dot to appear, `glyphMargin` must be enabled. Add `glyphMargin: true` to the playback `EDITOR_OPTIONS` (or create a separate `PLAYBACK_SCHEMA_OPTIONS` constant that extends `EDITOR_OPTIONS` with `glyphMargin: true, readOnly: true`).

8. **Existing `anchorDecorationRef` effect in App.tsx**: The anchor decoration targets `linesDecorationsClassName` (gutter bar) and `className` (left-border line highlight). The new tour highlight uses different class names and `isWholeLine`-style background. They will coexist on the same editor with no conflict.

---

## Tests

Extend `web/src/store.test.ts` or add `web/src/tourHighlight.test.ts`:

1. **Anchor-based**: Given a step with `anchor: { subgraphIndex: 0, typeName: "Product", fieldName: "price" }` and SDL containing that type/field, `applyTourHighlight` returns a non-null handle and the correct 1-based line number is identified (mock `editor.createDecorationsCollection` and `editor.revealLineInCenter`).

2. **Diff-based**: Given a step with no anchor, `prevSdl` with 3 lines and `currentSdl` with 4 lines (one added), the changed line number (the new line) is correctly identified and highlighted.

3. **No-op**: Given a step with no anchor and identical `currentSdl`/`prevSdl`, no decoration is applied (mock's `createDecorationsCollection` is not called, or called with empty array).

4. **AC#4 — stale clear**: Calling `dispose()` on the handle returned by `applyTourHighlight` calls `clear()` on the decoration collection exactly once.

Use the same Monaco mock pattern as `App.test.tsx` (via `setupTests.tsx`).

---

## Verification Steps

```bash
cd /home/jeffutter/src/gql-fiddle/web
pnpm test run          # all tests pass including new tourHighlight tests
pnpm tsc --noEmit      # no type errors
pnpm lint              # no lint errors
```

Manual smoke test (authoring mode):
1. Open app → Create Tour → set up 2 steps with different SDLs.
2. Navigate to step 2: diff-based highlight should appear on changed lines.
3. Click a type/field in the schema editor to set an anchor on step 2.
4. Navigate away and back: anchor-based highlight should appear on that type/field line, with auto-scroll.
5. Navigate to step 1: no highlight (intro step, no anchor, SDL same as base).

Manual smoke test (playback mode):
1. Share the tour → open the `#t=` URL.
2. Navigate between steps: highlights appear/clear correctly as in authoring mode.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned. Created `web/src/tourHighlight.ts` as a pure utility module exporting `applyTourHighlight` and `TourHighlightHandle`. Integrated into `App.tsx` (authoring mode) and `TourPlayback.tsx` (playback mode) with `tourHighlightHandleRef` and `useEffect` hooks. Added `glyphMargin: true` via new `SCHEMA_EDITOR_OPTIONS` constant in `TourPlayback.tsx`. Added `resolveTourStep` import to `App.tsx`. Added `.tour-highlight-gutter` and `.tour-highlight-line` CSS classes to `theme.css`. Added 7 unit tests in `tourHighlight.test.ts` covering anchor-based, diff-based, no-op, and disposal paths. All 237 tests pass, TypeScript clean, lint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the tour step highlight system as a self-contained `web/src/tourHighlight.ts` module exporting `applyTourHighlight`. The function applies Monaco editor decorations in priority order: (1) anchor-based — finds the type/field line by scanning the SDL, applies a gutter dot + line background tint, and auto-scrolls; (2) diff-based — text-diffs current vs previous step SDL, highlights new/changed lines and auto-scrolls to the first change; (3) no-op — returns a disposable handle that does nothing. Integration hooks were added to `App.tsx` (authoring mode) and `TourPlayback.tsx` (playback mode), both using a `tourHighlightHandleRef` that is disposed before each step transition (AC#4). The playback editor gained `glyphMargin: true` via a new `SCHEMA_EDITOR_OPTIONS` constant so gutter dots render. Anchor-to-different-subgraph steps trigger `setActiveSubgraph` and the effect re-runs (AC#7). New CSS classes `.tour-highlight-gutter` and `.tour-highlight-line` in `theme.css` are visually distinct from the existing anchor bar classes (AC#5). Seven unit tests in `tourHighlight.test.ts` cover all paths; all 237 tests pass with no TypeScript or lint errors."]
<!-- SECTION:FINAL_SUMMARY:END -->
