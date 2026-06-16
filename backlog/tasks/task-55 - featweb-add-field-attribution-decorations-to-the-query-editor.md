---
id: TASK-55
title: "feat(web): add field attribution decorations to the query editor"
status: Done
assignee:
  - "@ralph"
created_date: "2026-06-16 18:46"
updated_date: "2026-06-16 19:16"
labels:
  - visualization
  - query-editor
  - query-plan
  - monaco
  - planned
dependencies: []
references:
  - web/src/App.tsx
  - web/src/core/types.ts
  - web/src/planToMermaid.ts
documentation:
  - >-
    https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IModelDeltaDecoration.html
priority: medium
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

After a query plan is computed, color-code each field selection in the Monaco query editor (bottom-left panel) to show which subgraph will resolve it. This gives users immediate, tangible feedback: adding a field visually reveals whether it adds a new subgraph hop or stays within an already-involved service.

**App placement:**

- Decorations are applied to the existing Monaco query editor in `App.tsx` (the `Editor` component at the bottom-left, path `query-${activeQueryTab}.graphql`).
- A small legend (subgraph → color swatch) is rendered below or overlaid on the query editor.
- No new tab or panel needed — this augments the existing query editing experience.

**Implementation approach:**

- New `planToFieldRanges.ts` utility that walks the `PlanNode` tree and the parsed query AST to produce a mapping of `{ line, col, len, service }` for each field selection served by each Fetch node. The `operation` string on each `Fetch` node contains the sub-selection sent to that subgraph — parse it with `graphql-js` `parse()` (already available as a dependency) to extract field positions relative to the original query.
- Apply decorations via Monaco's `createDecorationsCollection` API (the modern replacement for the deprecated `deltaDecorations`). Each subgraph gets a distinct `inlineClassName` (colored text background using a CSS class) and a `glyphMarginClassName` (colored gutter dot). Enable `glyphMargin: true` in the query editor's `EDITOR_OPTIONS` or via `updateOptions`.
- Decorations should update (via the existing `planResult` state) whenever the plan recomputes. Clear all decorations when `planResult` is null or has errors.
- A consistent color palette per subgraph (deterministic: e.g., hash subgraph name → index into a fixed accent palette in `theme.css`). **This same palette should be reused by the Entity Ownership Graph feature for visual consistency across the app.**

**No additional npm packages required.** Monaco's `createDecorationsCollection` API (added ~v0.34) handles everything. The `hoverMessage` field on decoration options provides free tooltip rendering.

**Design:** Use CSS custom properties from `theme.css` for the color palette. Ensure sufficient contrast on the dark "Ink at Night" theme. Colors should be visually distinct for up to 8–10 subgraphs.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 After a successful plan, each field selection in the query editor has a colored inline highlight matching its source subgraph
- [ ] #2 Each subgraph is assigned a consistent color (same subgraph always gets the same color, deterministic across reruns)
- [ ] #3 A legend is visible near the query editor listing each subgraph name and its assigned color swatch
- [ ] #4 Hovering over a highlighted range shows a Monaco tooltip: 'Resolved by: <subgraph-name>'
- [ ] #5 A gutter icon/dot in the left margin is colored per subgraph (requires glyphMargin: true in editor options)
- [ ] #6 Decorations update automatically when the query changes and a new plan is computed (debounced, matching the existing plan computation timing)
- [ ] #7 All decorations are cleared when the plan fails or has not yet run
- [ ] #8 On mobile, decorations appear correctly in the Monaco query editor within the 'Query' tab
- [ ] #9 The color palette is accessible — sufficient contrast on the dark theme for all swatch colors
- [ ] #10 No new npm packages are added for this feature
- [ ] #11 1:After a successful plan, each field selection in the query editor has a colored inline highlight matching its source subgraph
- [ ] #12 2:Each subgraph is assigned a consistent color (same subgraph always gets the same color, deterministic across reruns)
- [ ] #13 3:A legend is visible near the query editor listing each subgraph name and its assigned color swatch
- [ ] #14 4:Hovering over a highlighted range shows a Monaco tooltip: 'Resolved by: <subgraph-name>'
- [ ] #15 5:A gutter icon/dot in the left margin is colored per subgraph (requires glyphMargin: true in editor options)
- [ ] #16 6:Decorations update automatically when the query changes and a new plan is computed (debounced, matching the existing plan computation timing)
- [ ] #17 7:All decorations are cleared when the plan fails or has not yet run
- [ ] #18 8:On mobile, decorations appear correctly in the Monaco query editor within the 'Query' tab
- [ ] #19 9:The color palette is accessible — sufficient contrast on the dark theme for all swatch colors
- [ ] #20 10:No new npm packages are added for this feature
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->

## Overview

This task adds field-attribution decorations to the Monaco query editor. After a plan is computed, each field selection in the query editor is color-coded to show which subgraph will resolve it. A legend is rendered below the query editor, and hovering a highlighted range shows a Monaco tooltip naming the subgraph.

## Key Design Decisions

- **No new npm packages.** Monaco's built-in `createDecorationsCollection` API handles all decoration lifecycle. The `graphql` package (already a dependency at ^16.14.2) handles query AST parsing.
- **Shared subgraph color palette.** A deterministic palette (hash subgraph name → index into a fixed array of CSS custom properties defined in `theme.css`) is extracted into a standalone `subgraphColors.ts` utility so the Entity Ownership Graph (TASK-56) can import the same palette for visual consistency across the app.
- **No Monaco model URI needed.** The decoration collection is bound directly to the query editor instance via a React ref, not to a model looked up by URI.
- **Clear-on-error contract.** Decorations are cleared when `planResult` is null or `planResult.ok === false`.
- **Mobile works automatically.** The same query Editor component is rendered in the mobile layout; the same effect applies there since the editor instance is shared.

## File Changes

### 1. `web/src/theme.css` — add subgraph accent palette tokens

Add 10 CSS custom properties for the subgraph palette:

```css
/* Subgraph attribution palette — 10 visually distinct accents, sufficient contrast on --surface (#16243a).
   Shared by field-attribution decorations and entity ownership graph. */
--sg-0: #7aa2f7; /* soft blue */
--sg-1: #9ece6a; /* green */
--sg-2: #ff9e64; /* orange */
--sg-3: #f7768e; /* rose */
--sg-4: #2ac3de; /* cyan */
--sg-5: #bb9af7; /* lavender */
--sg-6: #e0af68; /* sand */
--sg-7: #73daca; /* teal */
--sg-8: #ff5f8f; /* pink */
--sg-9: #41a6b5; /* steel blue */
```

These must pass 3:1 contrast against `--surface` (#16243a) per WCAG AA for UI components.

### 2. `web/src/subgraphColors.ts` — palette utility (new file)

```ts
// Deterministic subgraph → CSS custom property name mapping.
// Hash-based: same subgraph name always maps to the same slot, regardless of
// encounter order. Cap at 10 slots; additional subgraphs wrap around.

const PALETTE_SIZE = 10;

/** Returns the CSS variable name for a given subgraph, e.g. "var(--sg-3)". */
export function subgraphColorVar(name: string): string {
  const idx = hashName(name) % PALETTE_SIZE;
  return `var(--sg-${idx})`;
}

/** Returns a hex color string for Monaco inlineClassName injection (CSS class). */
export function subgraphColorHex(name: string, palette: string[]): string {
  return palette[hashName(name) % PALETTE_SIZE];
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
```

Because Monaco's `inlineClassName` needs a CSS class (not a CSS variable), inject a `<style>` element once that defines `.sg-bg-0` … `.sg-bg-9` classes with `background-color: var(--sg-N); color: var(--bg); border-radius: 2px`. Glyph classes `.sg-glyph-0` … `.sg-glyph-9` use the same colors via `background-color`.

### 3. `web/src/planToFieldRanges.ts` — new utility

This is the core logic. It walks the PlanNode tree to find Fetch nodes, parses each Fetch's `operation` string using `graphql`'s `parse()`, and maps field selections back to positions in the original query string.

Interface:

```ts
export interface FieldRange {
  /** 1-based line number in the original query string. */
  line: number;
  /** 1-based column. */
  col: number;
  /** Length of the field token (not including alias colon). */
  len: number;
  /** The subgraph that resolves this field. */
  service: string;
}

export function planToFieldRanges(
  root: PlanNode,
  _originalQuery: string,
): FieldRange[];
```

**Algorithm:**

1. Collect all Fetch nodes from the tree (depth-first), pairing each with its `service`.
2. For each Fetch node, call `parse(node.operation, { noLocation: false })` on the `operation` string. Iterate the first SelectionSet's field selections and read their AST `loc.startToken.line/column` positions. **Note: the Fetch operation may be a projection of the original query, not a verbatim substring**, so positions in the Fetch's operation do not directly correspond to the original query.
3. To correlate back to the original query: parse the original query with `parse()` as well and walk both ASTs together — matching by field name along the path. When a match is found, use the original query AST's `loc` for the position.
4. Return one `FieldRange` per matched field selection, tagged with the `service` from the Fetch node.

**Edge cases:**

- Skip Fetch nodes whose `operation` cannot be parsed (malformed sub-operations should not crash the UI).
- Alias fields: use the alias start position (the alias keyword), not the field name.
- Fragments in the original query: follow `FragmentSpread` → `FragmentDefinition` selections recursively.
- Inline fragments: recurse into their selection sets.
- Fields that appear in multiple Fetch nodes (e.g. `__typename` injected by the router): the last Fetch's color wins.

### 4. `web/src/App.tsx` — wire decorations into the query editor

**Changes:**

1. Add a ref for the decoration collection: `const decorationsRef = useRef<ReturnType<typeof editor.createDecorationsCollection> | null>(null)`.

2. Add a `useEffect` that runs whenever `planResult` or `monacoInstance` changes:

```ts
useEffect(() => {
  const queryEditor = /* get the query editor instance — see note below */;
  if (!queryEditor || !monacoInstance) return;

  // Clear previous decorations.
  decorationsRef.current?.clear();
  decorationsRef.current = null;

  if (!planResult || !planResult.ok) return;

  const ranges = planToFieldRanges(planResult.query_plan, currentQuery);
  if (ranges.length === 0) return;

  const deltaDecorations: monaco.editor.IModelDeltaDecoration[] = ranges.map((r) => ({
    range: new monacoInstance.Range(r.line, r.col, r.line, r.col + r.len),
    options: {
      inlineClassName: `sg-bg-${hashName(r.service) % 10}`,
      glyphMarginClassName: `sg-glyph-${hashName(r.service) % 10}`,
      hoverMessage: { value: `Resolved by: **${r.service}**` },
    },
  }));

  decorationsRef.current = queryEditor.createDecorationsCollection(deltaDecorations);
}, [planResult, monacoInstance, currentQuery]);
```

3. **Enable glyph margin** on the query editor: add `glyphMargin: true` to the `options` spread for the query editor `<Editor>` (both desktop and mobile instances). Since `EDITOR_OPTIONS` is shared, create a `QUERY_EDITOR_OPTIONS` constant that spreads `EDITOR_OPTIONS` and adds `glyphMargin: true`.

4. **Query editor ref.** Currently App.tsx holds `editorRef` / `monacoRef` for the subgraph editor only. Add a `queryEditorRef` via `useRef<_monaco.editor.IStandaloneCodeEditor | null>(null)` and wire it via the query editor's `onMount` callback.

5. Clear decorations when `planResult` becomes null (handled by the same effect above).

### 5. Legend component — render below the query editor

Add a small `SubgraphLegend` component (in a new file `web/src/SubgraphLegend.tsx` or inline in App.tsx) that accepts `services: string[]` and renders a horizontal flex row of colored swatches + subgraph names below the query editor panel.

```tsx
function SubgraphLegend({ services }: { services: string[] }) {
  if (services.length === 0) return null;
  return (
    <div className="subgraph-legend" aria-label="Subgraph legend">
      {services.map((svc) => (
        <span key={svc} className="subgraph-legend__item">
          <span
            className="subgraph-legend__swatch"
            style={{ backgroundColor: `var(--sg-${hashName(svc) % 10})` }}
          />
          {svc}
        </span>
      ))}
    </div>
  );
}
```

Add `.subgraph-legend` and `.subgraph-legend__item` / `.subgraph-legend__swatch` classes to `theme.css`.

Render `<SubgraphLegend services={activePlanServices} />` below the query editor in both the desktop panel and the mobile Query tab. The `activePlanServices` is derived from `planResult` when it's ok: walk the plan tree to collect unique service names (reuse `collectParticipants` logic from `planToMermaid.ts` — extract it into a shared utility or import it).

### 6. `web/src/planToFieldRanges.test.ts` — unit tests

Test the pure `planToFieldRanges` function against a representative set of PlanNode fixtures (mirroring the style of `planToMermaid.test.ts`):

- Single Fetch: returns one FieldRange per top-level field in the query.
- Sequence of two Fetches: fields from both fetches are tagged with their respective services.
- Nested Parallel: all fields accounted for.
- Malformed Fetch operation: skips gracefully, no throw.
- Alias field: position points to alias start.

### 7. CSS injection for Monaco inlineClassName

Monaco's `inlineClassName` needs a CSS class on the document. Add a `useEffect` (or a module-level side-effect) in `App.tsx` (or `subgraphColors.ts`) that injects a `<style>` tag once:

```ts
function injectSubgraphStyles() {
  if (document.getElementById("sg-decoration-styles")) return;
  const el = document.createElement("style");
  el.id = "sg-decoration-styles";
  // Read computed values from :root for the 10 slots
  const root = document.documentElement;
  const lines: string[] = [];
  for (let i = 0; i < 10; i++) {
    const color = getComputedStyle(root).getPropertyValue(`--sg-${i}`).trim();
    lines.push(
      `.sg-bg-${i} { background-color: ${color}33; border-bottom: 1.5px solid ${color}; border-radius: 2px; }`,
    );
    lines.push(
      `.sg-glyph-${i}::before { content: ''; display: block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; margin: auto; }`,
    );
  }
  el.textContent = lines.join("\n");
  document.head.appendChild(el);
}
```

Call `injectSubgraphStyles()` once in a `useEffect(() => { injectSubgraphStyles(); }, [])` inside App.

## Integration Points and Ordering

1. Add CSS tokens to `theme.css` (no code deps)
2. Create `subgraphColors.ts` (depends on tokens)
3. Create `planToFieldRanges.ts` (depends on PlanNode types and graphql-js)
4. Write tests in `planToFieldRanges.test.ts`
5. Update `App.tsx`: add queryEditorRef, QUERY_EDITOR_OPTIONS, decoration effect, legend
6. Add legend CSS to `theme.css`

## Testing and Validation

- Run `pnpm test run` from `web/` to execute vitest unit tests including `planToFieldRanges.test.ts`.
- Run `pnpm tsc --noEmit` to verify types compile.
- Run `pnpm lint` for ESLint.
- Manual verification: load the default demo schema + query, run a plan, confirm each field selection has a colored background, a glyph dot, a tooltip on hover, and the legend appears below the query editor.
- Mobile: switch to the Query tab on a narrow viewport (≤768px) and confirm decorations appear in the Monaco editor there too.

## Risks and Notes

- **PlanNode operation ↔ original query correlation**: the Fetch `operation` field contains a subset of the original query, possibly with router-injected fields (`__typename`, `id` for entity keys). Direct line/col mapping from the sub-operation to the original query is not valid. The correct approach is to parse both ASTs and walk them in parallel, matching fields by name at each level of the selection set. Fields present in the sub-operation but not in the original query (injected by the router) are silently skipped.
- **Multiple Fetch nodes claiming the same field**: when a field appears in parallel fetches from different subgraphs (unusual but possible with aliases), the decoration from the last Fetch wins. This is acceptable for the educational use case.
- **Glyph margin real estate**: enabling `glyphMargin: true` adds ~20px on the left. This is minor and consistent with IDE conventions, but should be verified visually against the dark theme.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->

## Implementation Notes

### Files created

- `web/src/subgraphColors.ts` — deterministic palette utility: `hashSubgraphName`, `subgraphColorVar`, `injectSubgraphStyles`. Shared by TASK-56.
- `web/src/planToFieldRanges.ts` — core logic: collects Fetch nodes, dual-parses Fetch operation + original query, walks ASTs in parallel to find field positions. Exports `planToFieldRanges` and `collectServiceNames`.
- `web/src/planToFieldRanges.test.ts` — 14 unit tests covering single/sequence/parallel fetches, alias fields, malformed operations, fragment spreads, empty plan, etc. All passing.

### Files modified

- `web/src/theme.css` — added 10 `--sg-N` CSS custom properties + legend component styles.
- `web/src/App.tsx` — added: imports for new utilities; `QUERY_EDITOR_OPTIONS` (glyphMargin: true); `SubgraphLegend` component; `queryEditorRef` + `decorationsRef`; `injectSubgraphStyles` effect; decoration update effect keyed on planResult/currentQuery/monacoInstance; `activePlanServices` derived value; wired `onMount` on both desktop and mobile query editors; legend rendered below query editor in both layouts.
- `web/src/setupTests.tsx` — extended test harness with `onMountByPath` and updated mock to keep `onMount` pointing to the subgraph editor for backward compatibility.

### Algorithm

The Fetch sub-operation field positions don't map directly to original query positions (router may inject/rename fields). Solution: parse both ASTs, match by field name at each selection set level. Alias fields: match on underlying field name OR alias name.

### ACs status

- AC#1-#7, #9-#10: satisfied by implementation
- AC#8 (mobile): same Editor component + same queryEditorRef wired in mobile layout
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->

Added field-attribution decorations to the Monaco query editor. After a successful plan, each field selection in the query editor gets a colored inline highlight (translucent background + underline), a glyph margin dot, and a hover tooltip showing the resolving subgraph. A legend listing each subgraph and its color swatch appears below the query editor. The deterministic color palette (10 CSS custom properties in theme.css) is shared with TASK-56. The core planToFieldRanges.ts utility dual-parses the Fetch sub-operation and original query ASTs to correctly map field positions. All 123 tests pass; no new npm packages added.

<!-- SECTION:FINAL_SUMMARY:END -->
