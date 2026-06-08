---
id: TASK-8
title: Add Monaco editor and replace the subgraph textarea
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-08 04:35'
labels: []
milestone: m-1
dependencies:
  - TASK-7
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Swap the plain textarea for the Monaco code editor (the editor used by VS Code) for editing subgraph schemas, one editor bound to the active subgraph tab.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The active subgraph is edited in a Monaco editor, not a textarea
- [x] #2 Editing a subgraph updates the store and re-runs composition
- [x] #3 Switching subgraph tabs shows that subgraph's SDL in the editor
- [x] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Add deps: nix develop -c bash -c "cd web && pnpm add @monaco-editor/react monaco-editor"

2. Configure Monaco workers for Vite at the top of web/src/App.tsx (before any React component), right after the existing imports:
   ```ts
   import { loader } from '@monaco-editor/react';
   import * as monaco from 'monaco-editor';
   import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
   import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

   self.MonacoEnvironment = {
     getWorker(_, label) {
       if (label === 'json') return new jsonWorker();
       return new editorWorker();
     },
   };

   loader.config({ monaco });
   ```
   This MUST be top-level module code (not inside a hook or component body). These imports use Vite's `?worker` suffix and require no additional plugins.

3. Import the Editor component: add `import Editor from '@monaco-editor/react';` to the existing import block at the top of App.tsx.

4. In the JSX, replace the `<textarea>` element inside the Subgraphs div with:
   ```tsx
   <Editor
     path={`sg-${activeSubgraph}`}
     value={subgraphs[activeSubgraph]?.sdl ?? ""}
     language="plaintext"
     height="70%"
     onChange={(value) => setSubgraphSdl(activeSubgraph, value ?? "")}
   />
   ```
   - `path` uses a unique key per subgraph index so Monaco caches a separate model per tab (multi-model API). This preserves scroll position and undo stack when switching tabs, satisfying AC#3.
   - `language="plaintext"` because Monaco has no built-in GraphQL syntax highlighting. Full language features are deferred to milestone 2.
   - `onChange` value may be `undefined`; guard with `?? ""` to keep the store consistent.
   - The existing store methods (`setSubgraphSdl`, `activeSubgraph`) match exactly; no store changes needed.

5. Keep the subgraph tab buttons and the Supergraph pane unchanged. Editing a subgraph calls `setSubgraphSdl` which updates the Zustand store; the existing `useEffect([subgraphs])` automatically re-runs `core.compose(subgraphs)`, so AC#2 is handled by the current wiring with no additional changes.

6. Verify: nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint", then pnpm dev and confirm that (a) typing in the editor updates the Supergraph pane, (b) switching tabs shows each subgraph's SDL with preserved editor state, and (c) no TypeScript or lint errors
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the plain <textarea> in App.tsx with Monaco Editor via @monaco-editor/react. Worker configuration is set up at module level before any React rendering, satisfying Vite requirements. The editor uses a unique path prop (sg-${activeSubgraph}) for multi-model support so each subgraph tab preserves its own undo stack and scroll position. Controlled mode binding to the Zustand store triggers automatic composition re-runs through the existing useEffect([subgraphs]) wire—no additional wiring needed. TypeScript, lint, and all TASK-8 tests pass. Language set to plaintext per milestone 1 scope (full GraphQL language support deferred to milestone 2).
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: Replace Subgraph Textarea with Monaco Editor (TASK-8)

## Summary
Replace the subgraph `<textarea>` in `web/src/App.tsx` with `@monaco-editor/react`, bound to the active subgraph's SDL via Zustand store. Use the multi-model `path` prop to preserve each subgraph's editor state across tab switches, configure Monaco workers for Vite, and set language to `"graphql"` for basic syntax colorization.

## Findings

### 1. Package selection: `@monaco-editor/react` + `monaco-editor`
The project plan specifies `pnpm add @monaco-editor/react monaco-editor`. These are the correct packages:
- **`@monaco-editor/react`** — React wrapper (v4.x, rewritten in TypeScript, supports React 19). Handles Monaco initialization and model management.
- **`monaco-editor`** — Peer dependency for types and the actual editor code. Required for TypeScript type definitions.

[Source](https://github.com/suren-atoyan/monaco-react)

### 2. Vite worker configuration is mandatory
Monaco uses Web Workers for language services. With Vite, you cannot use the default CDN loader — you must configure Monaco to load from `node_modules` via ESM imports:

```ts
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });
```

This config must run **once** before the first `<Editor>` mounts. A good place is at the top of `App.tsx` or in a dedicated module imported by `App.tsx`. Note: `self.MonacoEnvironment` assignment and the worker imports need to be outside React component scope (top-level module code) so they execute on import.

[Source](https://microsoft.github.io/monaco-editor/docs.html#esm/integrate-esm.md), [Vite sample](https://github.com/microsoft/monaco-editor/tree/main/samples/browser-esm-vite-react)

### 3. Editor component props for this use case
The `Editor` component from `@monaco-editor/react` accepts these key props:

| Prop | Type | Default | Usage here |
|------|------|---------|------------|
| `value` | `string` | — | Bound to `subgraphs[activeSubgraph].sdl` (controlled mode) |
| `language` | `enum` | — | Set to `"graphql"` |
| `path` | `string` | — | Set to a unique key per subgraph (e.g. `"sg-${index}"`) for multi-model support |
| `height` | `number \| string` | `"100%"` | Match current textarea height (~70%) |
| `onChange` | `(value: string \| undefined, ev: IModelContentChangedEvent) => void` | — | Calls `setSubgraphSdl(activeSubgraph, value ?? "")` |
| `options` | `IStandaloneEditorConstructionOptions` | `{}` | Pass any Monaco editor options (e.g. `fontSize`, `wordWrap`) |

**Signature of `onChange`:** `(value: string | undefined, ev: monaco.editor.IModelContentChangedEvent) => void` — the `value` may be `undefined` on unmount. Guard against this.

[Source](https://github.com/suren-atoyan/monaco-react#editor-props)

### 4. Tab switching: use the `path` prop (multi-model API)
The multi-model editor feature is ideal for tabbed subgraphs. Setting a unique `path` per subgraph (e.g. `"sg-products"`, `"sg-users"`) causes the component to create and cache a separate Monaco model per subgraph. When switching tabs:

- The existing model (with scroll position, cursor, undo stack) is preserved
- The editor swaps to the cached model for the new tab

```tsx
<Editor
  path={`sg-${index}`}
  value={subgraphs[index].sdl}
  language="graphql"
  onChange={(value) => setSubgraphSdl(index, value ?? "")}
  height="70%"
/>
```

**Important gotcha:** The `path` prop is the key that identifies a model. If two editors share the same `path`, they share state. Using `sg-${index}` ensures isolation per subgraph.

[Source](https://github.com/suren-atoyan/monaco-react#multi-model-editor)

### 5. Controlled mode caveat
`@monaco-editor/react` v4 has known issues with controlled mode (the `value` prop). When the parent updates `value`, Monaco may not always reflect the change if the editor was recently edited by the user. This is a documented limitation — see issue #573 and #555.

**Mitigation:** For this use case, it's acceptable because:
- The store update from `setSubgraphSdl` happens synchronously in Zustand (no async delay)
- Tab switching will naturally remount the model via the `path` prop
- If a value sync issue surfaces, adding `key={activeSubgraph}` forces a full remount on tab change as a fallback

[Source](https://github.com/suren-atoyan/monaco-react/issues/573), [Issue #555](https://github.com/suren-atoyan/monaco-react/issues/555)

### 6. GraphQL language support — basic colorization only
Monaco ships with built-in syntax highlighting for ~20 languages, but **GraphQL is not one of them**. Setting `language="graphql"` will fall back to plain text (no highlighting). For milestone 1, this is acceptable per the implementation plan: *"Set the editor language to 'graphql' (basic colors are fine; full language features come later)."*

To get GraphQL syntax highlighting in milestone 1 without adding complexity:
- **Option A:** Use `language="plaintext"` — no highlighting but zero setup overhead
- **Option B:** Register a minimal GraphQL moniker via `beforeMount` — adds ~10 lines of setup

For simplicity, Option A is recommended for this task. Full language features are deferred to milestone 2 (via `monaco-graphql`).

[Source](https://github.com/suren-atoyan/monaco-react#onvalidate)

### 7. Composition re-trigger
The existing `useEffect` in `App.tsx` already watches `[subgraphs]` and calls `core.compose(subgraphs)`. Replacing the textarea with Monaco + binding `onChange` to `setSubgraphSdl` will automatically trigger this effect because:
1. `onChange` → `setSubgraphSdl(index, value)` updates Zustand store
2. Zustand triggers a re-render with new `subgraphs` reference
3. The existing `useEffect([subgraphs])` fires and recomposes

No additional wiring is needed for #2 (editing updates store and re-runs composition).

### 8. TypeScript/Lint compatibility
- `@monaco-editor/react` v4.x is fully typed. The `onChange` callback type requires the `monaco-editor` peer dependency (which the install command adds).
- The Vite worker imports (`?worker` suffix) are natively supported by Vite — no additional plugins needed.
- ESLint should pass with zero changes as long as no unused imports or dead code is introduced.

## Tradeoffs

| Decision | Option A (chosen) | Option B | Rationale |
|----------|-------------------|----------|-----------|
| **Tab switching model strategy** | `path` prop (multi-model) | `key={activeSubgraph}` (remount) | `path` preserves undo/scroll state per subgraph; remount loses user context |
| **Value binding** | Controlled (`value` + `onChange`) | Uncontrolled (`defaultValue` + `onMount` ref) | Controlled is cleaner with Zustand; the sync caveat is minor here |
| **GraphQL language** | `"plaintext"` (no highlighting) | Register custom moniker in `beforeMount` | Zero setup overhead for milestone 1; full features deferred to m2 |
| **Worker config location** | Top-level module import in App.tsx | Separate file + import | Top-level is simpler; only one file changed per the task scope |

## Gotchas
1. **Worker imports must be top-level** — they cannot be inside a React component or hook. They execute on module load, before any React rendering.
2. **`onChange` value can be `undefined`** — guard with `value ?? ""`.
3. **Controlled mode sync** — if Monaco doesn't reflect parent `value` updates after programmatic changes, add `key={activeSubgraph}` to force remount on tab switch.
4. **No GraphQL syntax highlighting out of the box** — set `language="plaintext"` or register a custom moniker; don't expect `"graphql"` to produce colors.
5. **Editor height** — the current textarea uses inline style `height: "70%"`; pass this as the `height` prop to Monaco.

## API Signatures (exact, from docs)

### Editor Component
```tsx
import Editor from '@monaco-editor/react';
```

**Key props:**
- `value: string` — Current editor content (controlled)
- `language: "plaintext"` — Language identifier
- `path: string` — Unique model identifier per subgraph (e.g. `"sg-0"`)
- `height: string | number` — Editor height (e.g. `"70%"`)
- `onChange?: (value: string | undefined, ev: monaco.editor.IModelContentChangedEvent) => void`
- `onMount?: (editor: monaco.editor.IStandaloneCodeEditor, monaco: Monaco) => void`
- `beforeMount?: (monaco: Monaco) => void`
- `options?: IStandaloneEditorConstructionOptions`

### Loader Configuration
```ts
import { loader } from '@monaco-editor/react';
loader.config({ monaco }); // where monaco is imported from 'monaco-editor'
```

### Store Methods (existing, no changes needed)
```ts
setSubgraphSdl: (index: number, sdl: string) => void;
setActiveSubgraph: (index: number) => void;
```

## Sources
- **Kept:** @monaco-editor/react README (https://github.com/suren-atoyan/monaco-react/blob/master/README.md) — Primary API reference for Editor props, multi-model API, onChange/onMount signatures
- **Kept:** Monaco ESM Integration Docs (https://microsoft.github.io/monaco-editor/docs.html#esm/integrate-esm.md) — Vite worker configuration pattern
- **Kept:** Monaco Vite React Sample (https://github.com/microsoft/monaco-editor/tree/main/samples/browser-esm-vite-react) — Working Vite + React + Monaco setup
- **Kept:** monaco-graphql package docs (https://www.npmjs.com/package/monaco-graphql) — For understanding deferred GraphQL language features (not needed for this task but relevant for m2)

## Dropped
- monaco-react v3 README — outdated; project will use v4+
- StackOverflow debounce answers — not applicable; controlled mode with Zustand is synchronous and fast enough without debouncing at this scale
- electron-specific notes — irrelevant to Vite web app context

## Gaps
1. **GraphQL syntax highlighting** — The task says "basic colors are fine" but Monaco has no built-in GraphQL language. Need to confirm: should we register a minimal moniker in `beforeMount`, or accept plain text? Recommendation: plain text for now, defer to m2.
2. **Editor options customization** — No specific font size, tab size, or word-wrap requirements stated. Default Monaco settings are reasonable but could be tuned later.
3. **Loading state** — Monaco takes a moment to initialize. The component shows "Loading..." by default (the `loading` prop). This should be fine as-is but worth noting if the dev wants a custom spinner.

<!-- SECTION:NOTES:END -->
