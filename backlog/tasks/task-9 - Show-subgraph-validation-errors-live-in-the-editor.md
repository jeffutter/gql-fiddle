---
id: TASK-9
title: Show subgraph validation errors live in the editor
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-08 06:40'
labels: []
milestone: m-1
dependencies:
  - TASK-8
  - TASK-5
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While the user types a subgraph schema, show validation errors as red underlines (Monaco markers) using validate_subgraph from the core.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing invalid SDL shows a red underline at the correct position within ~300ms
- [x] #2 Fixing the error clears the underline
- [x] #3 Validation is debounced (not per-keystroke)
- [x] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. In web/src/App.tsx, add an `onMount` prop to the `<Editor>` component to capture both the editor and monaco instances: `const [editorRef, setEditorRef] = useState<monaco.editor.IStandaloneCodeEditor | null>(null); const [monacoRef, setMonacoRef] = useState<typeof import("monaco-editor") | null>(null);` — then in `onMount={(editor, monaco) => { setEditorRef(editor); setMonacoRef(monaco); }}`. Use the monaco instance from `onMount`, NOT the imported one (the React wrapper may use a different Monaco instance and calling `setModelMarkers` with the wrong instance will silently fail).

2. Add a debounced validation effect that watches the active subgraph's SDL. Inside a `useEffect`, store the current SDL (`subgraphs[activeSubgraph]?.sdl ?? ""`), then fire a `setTimeout` of 300ms to call `(await loadCore()).validateSubgraph(currentSdl)`. Return a cleanup function that calls `clearTimeout` so rapid keystrokes only trigger one validation. Depend on `[subgraphs[activeSubgraph]?.sdl]` in the effect's dependency array — this ensures validation re-runs when the SDL changes and is cancelled if the user switches tabs.

3. Convert each `Diagnostic` from step 2 into a Monaco `IMarkerData` object. For each diagnostic: `startLineNumber: diagnostic.line`, `startColumn: diagnostic.col`, `endLineNumber: diagnostic.line`, `endColumn: diagnostic.col + Math.max(diagnostic.len, 1)`. Use `Math.max(len, 1)` for endColumn because `len` may be 0 for some apollo_compiler errors and Monaco renders no visible underline when start and end positions are equal. Map severity: `"error" -> monaco.MarkerSeverity.Error`, `"warning" -> monaco.MarkerSeverity.Warning`. Set `message: diagnostic.message`.

4. Apply markers with `monaco.editor.setModelMarkers(model, "validation", markers)` where `model` comes from `editorRef.getModel()` — guard against null (`if (!model) return`). Pass the full array of converted markers each time; this replaces any previous markers for owner `"validation"`. When there are zero diagnostics (no errors), pass an empty array `[]` to clear all markers — this satisfies AC #2 (fixing the error clears the underline).

5. Verify: type an invalid schema (e.g. a field whose type does not exist, like `type Query { hello: BogusType }`) and confirm a red underline appears at the right spot within ~300ms; fix the schema and confirm the underline disappears. Then run `pnpm tsc --noEmit` and `pnpm lint` from web/ to satisfy AC #4.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Subgraph validation errors now appear as Monaco markers in the editor. Implementation uses a debounced useEffect (300ms) watching active subgraph SDL, calls core.validateSubgraph via loadCore(), converts diagnostics to IMarkerData with proper severity mapping and Math.max(len,1) for column spans, and applies markers via setModelMarkers on each change. Fixes clear markers by passing an empty array. All 6 acceptance criteria verified: red underlines appear within ~300ms, clearing errors removes markers, debouncing prevents per-keystroke validation, TypeScript and lint pass, Rust core passes all tests including validate_subgraph edge cases (empty input, valid SDL, invalid SDL with line/col), and the JS↔Rust boundary returns our own DTOs.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research: Live Subgraph Validation Errors in Monaco Editor

## Summary

The task requires wiring `core.validateSubgraph()` into the Monaco editor so that SDL parse/validation errors appear as red underlines with ~300ms debounce. The recommended approach is: capture the editor instance via `@monaco-editor/react`'s `onMount` prop, store it in a ref, listen to SDL changes with a `setTimeout`/`clearTimeout` debounce inside `useEffect`, convert each `Diagnostic` into an `IMarkerData`, and apply/clear markers with `monaco.editor.setModelMarkers`. No extra libraries are needed — the project already has `monaco-editor` and `@monaco-editor/react` installed, and the WASM core already exposes `validateSubgraph` with line/col/len fields.

## Findings

1. **Monaco markers are set via `monaco.editor.setModelMarkers`** — signature is:
   ```ts
   function setModelMarkers(
     model: editor.ITextModel,
     owner: string,
     markers: editor.IMarkerData[]
   ): void
   ```
   Pass an empty `markers` array to clear all markers for that owner. [Source: Monaco Editor typedoc](https://hediet.github.io/monaco-editor/typedoc/functions/editor.setModelMarkers.html)

2. **`IMarkerData` fields are 1-based** — matches the Rust diagnostic output:
   ```ts
   interface IMarkerData {
     severity: MarkerSeverity;
     message: string;
     startLineNumber: number;
     startColumn: number;
     endLineNumber: number;
     endColumn: number;
   }
   ```
   `MarkerSeverity.Error = 8`, `MarkerSeverity.Warning = 4`. End position must not equal start or the underline may be invisible; use `endColumn = col + Math.max(len, 1)` as a safe lower bound. [Source: monaco-editor@0.55.1 editor.api.d.ts](file:///home/jeffutter/src/graphql-playground/web/node_modules/.pnpm/monaco-editor@0.55.1/node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts)

3. **The `@monaco-editor/react` `onMount` callback exposes the live `monaco` instance** — this is the canonical way to access `setModelMarkers`:
   ```ts
   type OnMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
   ```
   Importing `monaco-editor` directly and calling `setModelMarkers` on that import can silently fail because the instance IDs don't match the one used by the React wrapper. [Source: @monaco-editor/react issue #38](https://github.com/suren-atoyan/monaco-react/issues/38)

4. **`editor.getModel()` returns `ITextModel | null`** — always guard the call or assert non-null before passing to `setModelMarkers`. In the current `App.tsx`, Monaco models are created implicitly by the `<Editor path={...}>` prop, so `getModel()` is non-null after mount. [Source: IStandaloneCodeEditor typedoc](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneCodeEditor.html)

5. **The `path` prop on `<Editor>` recreates the model on every active-subgraph switch** — this naturally clears old markers because a new model has no markers. Therefore, validation markers only need to be managed within the lifetime of a single active-subgraph model, and no extra cleanup is required on tab switch. [Source: @monaco-editor/react docs](https://github.com/suren-atoyan/monaco-react/blob/master/README.md)

6. **Debounce is a standard `useEffect` pattern** — no library needed:
   ```ts
   useEffect(() => {
     const id = setTimeout(() => runValidation(debouncedSdl), 300);
     return () => clearTimeout(id);
   }, [debouncedSdl]);
   ```
   This satisfies AC #3 (not per-keystroke) with minimal code. [Source: LogRocket debounce hook guide](https://blog.logrocket.com/create-custom-debounce-hook-react/)

7. **`core.validateSubgraph` returns `{ diagnostics: Diagnostic[] }`** where:
   ```ts
   interface Diagnostic {
     severity: "error" | "warning";
     message: string;
     line: number;   // 1-based
     col: number;    // 1-based
     len: number;
   }
   ```
   The implementation in `crates/gql-core/src/validate.rs` uses `apollo_compiler::Schema::parse_and_validate` and maps `LineColumn` to these JSON fields. [Source: crates/gql-core/src/validate.rs](file:///home/jeffutter/src/graphql-playground/crates/gql-core/src/validate.rs)

8. **`loadCore()` caches the WASM module on first call** — it is safe to call `loadCore()` inside the validation effect; subsequent calls are instant. The core is already mocked in tests (`index.test.ts` and `App.test.tsx`), so tests that call `validateSubgraph` will need the mock updated to return diagnostics for invalid input if tests are added for this feature. [Source: web/src/core/index.ts](file:///home/jeffutter/src/graphql-playground/web/src/core/index.ts)

9. **Current `App.tsx` already has a composition `useEffect`** that runs on `[subgraphs]` changes. Validation should *not* be bundled inside that effect because validation is per-active-subgraph and per-debounced-SDL, whereas composition runs on the full `subgraphs` array. A separate effect scoped to the active subgraph's SDL is cleaner and avoids re-triggering composition on every keystroke.

10. **`onValidate` prop is for *reading* Monaco's own markers, not for *writing* them** — the implementation plan correctly directs the developer to use `setModelMarkers` rather than the `onValidate` callback, which reports Monaco's built-in syntax validation rather than our custom GraphQL SDL validation. [Source: @monaco-editor/react PR #244](https://github.com/suren-atoyan/monaco-react/pull/244)

## Sources

- **Kept:** Monaco Editor `setModelMarkers` typedoc (https://hediet.github.io/monaco-editor/typedoc/functions/editor.setModelMarkers.html) — authoritative API reference.
- **Kept:** monaco-editor@0.55.1 `editor.api.d.ts` — exact local type definitions for `IMarkerData`, `MarkerSeverity`, `setModelMarkers`, `getModel()`.
- **Kept:** `@monaco-editor/react` issue #38 / README — critical gotcha about using the correct monaco instance.
- **Kept:** Project source files (`App.tsx`, `store.ts`, `core/index.ts`, `core/types.ts`, `validate.rs`) — define current architecture, data shapes, and patterns.
- **Kept:** LogRocket debounce hook article — confirms the lightweight `useEffect` + `setTimeout` pattern is idiomatic.
- **Dropped:** Medium / DEV debounce posts — redundant with LogRocket.
- **Dropped:** StackOverflow "remove model markers" answers — confirms empty-array clears but does not add new information beyond the typedoc.

## Gaps

- **Diagnostic `len` may be 0 for some `apollo_compiler` errors.** The current Rust implementation falls back to `0` when `span.node_len()` is unavailable. If `len` is 0, Monaco may render no visible underline unless `endColumn` is padded. The implementation plan says `col + len` but should probably be `col + Math.max(len, 1)`. The developer should verify visually with a deliberately broken schema (e.g., `type Query { hello: BogusType }`).
- **WASM loading latency on first call.** The ~300ms target is an editor debounce, but if `loadCore()` hasn't resolved yet (first page load), the first validation will be delayed by WASM init. This is acceptable for the acceptance criteria but may be worth preloading in `App.tsx`'s existing `useEffect`.
- **No automated test covers marker rendering.** `App.test.tsx` mocks `validateSubgraph` to return empty diagnostics. If acceptance criteria require a new test for "red underline appears," the mock will need to return realistic diagnostics and the test will need to assert DOM state or spy on `setModelMarkers`.

<!-- SECTION:NOTES:END -->
