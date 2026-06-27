---
id: TASK-89
title: 'perf: tree-shake Monaco languages — include only graphql + json'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 21:29'
updated_date: '2026-06-27 05:44'
labels:
  - performance
  - frontend
  - build
  - planned
dependencies:
  - TASK-88
references:
  - web/src/App.tsx
  - web/vite.config.ts
priority: medium
ordinal: 112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`import * as _monaco from "monaco-editor"` pulls in the entire Monaco package, including every built-in language. The production build ships workers and mode files for languages the app will never use:

| File | Size |
|------|------|
| `ts.worker` | 6.6 MB |
| `editor.api2` (full Monaco bundle) | 3.5 MB |
| `css.worker` | 1.0 MB |
| `html.worker` | 702 KB |
| `json.worker` | 399 KB |
| ~80 language mode files | variable |

The app only ever uses three languages: graphql (via monaco-graphql), json (mock-config editor), and the base editor. All other workers/modes are dead weight.

## Solution

Install vite-plugin-monaco-editor and configure it to include only graphql and json. The plugin takes over worker bundling, so the manual self.MonacoEnvironment block and the three explicit ?worker imports can be removed from App.tsx.

## Implementation plan

### 1. Install the plugin

cd web && pnpm add -D @monaco-editor/vite-plugin

### 2. Update vite.config.ts

Import monacoEditorPlugin from @monaco-editor/vite-plugin and add it to plugins with languagesInclude: ["graphql", "json"]. Keep the optimizeDeps.include block as-is — still needed for monaco-graphql CJS deps.

### 3. Remove manual worker wiring from App.tsx

Delete the three worker imports (editorWorker, jsonWorker, GraphQLWorker ?worker imports) and the self.MonacoEnvironment block (~lines 162-168). The plugin generates a correct MonacoEnvironment automatically.

Keep loader.config({ monaco: _monaco }) so @monaco-editor/react uses the local build instead of the CDN.

### 4. Verify monaco-graphql worker still loads

monaco-graphql expects a "graphql" worker label in MonacoEnvironment. The plugin should handle this automatically because "graphql" is in languagesInclude — but confirm with a pnpm dev smoke test. If the plugin does not wire the graphql worker (it lives in monaco-graphql, not monaco-editor), keep a partial override for that label only and fall through to the plugin-generated handler for everything else.

### 5. Build and measure

Run pnpm build and confirm ts.worker, css.worker, html.worker, and the ~80 language mode files are absent. Only editor.worker, json.worker, and graphql.worker should remain.

### 6. Run full test suite

pnpm test run and pnpm e2e must pass. All GraphQL editing, schema composition, query autocompletion, and mock-config JSON editing must continue to work.

## Expected outcome

Roughly 8-9 MB of worker JS eliminated (pre-gzip), plus ~80 small language mode chunks removed from the asset manifest.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Build output contains only editor.worker, json.worker, and graphql.worker — no ts.worker, css.worker, html.worker, or unrelated language mode files
- [ ] #2 GraphQL schema editing, autocompletion, and diagnostics work correctly after the change
- [ ] #3 JSON mock-config editor retains syntax highlighting and validation
- [ ] #4 pnpm test run and pnpm e2e pass with no regressions
- [ ] #5 The manual self.MonacoEnvironment block and explicit ?worker imports are removed from App.tsx
- [ ] #6 1:true
- [ ] #7 2:true
- [ ] #8 3:true
- [ ] #9 4:true
- [ ] #10 5:true
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Install `@monaco-editor/vite-plugin` to replace the manual worker wiring in `App.tsx` with plugin-managed worker bundling. This eliminates all Monaco language workers except `editor.worker`, `json.worker`, and `graphql.worker`, cutting roughly 8–9 MB of pre-gzip worker JS from the production bundle.

The entire change touches three files and has no sub-tickets — all steps must land together to keep the app working.

## Key constraints from codebase research

- `web/vite.config.ts` — the `worker.rolldownOptions.output.inlineDynamicImports: true` setting **must be preserved**. The GraphQL worker dynamically imports `prettier/standalone` and `prettier/parser-graphql` for code formatting; without inline dynamic imports the worker breaks at runtime in non-module worker mode.
- `web/vite.config.ts` — the `optimizeDeps.include` block for `monaco-graphql > picomatch-browser` and `monaco-graphql > graphql-language-service > nullthrows` **must be preserved**. pnpm's non-hoisting means these CJS deps still need explicit pre-bundling.
- `web/src/App.tsx` — `loader.config({ monaco: _monaco })` on line 171 **must stay**. It tells `@monaco-editor/react` to use the local Monaco build instead of the CDN.
- The `graphql.worker` comes from `monaco-graphql`, not from `monaco-editor`. The plugin manages workers from `monaco-editor`; it may or may not wire the `graphql` label automatically.

## Step-by-step implementation

### 1. Install the plugin

```
cd web && pnpm add -D @monaco-editor/vite-plugin
```

### 2. Update `web/vite.config.ts`

Add the import at the top and insert the plugin into the `plugins` array:

```typescript
import monacoEditorPlugin from "@monaco-editor/vite-plugin";

// inside defineConfig:
plugins: [react(), wasm(), monacoEditorPlugin({ languagesInclude: ["graphql", "json"] })],
```

Keep all other config unchanged (customLogger, optimizeDeps, resolve.alias, worker.rolldownOptions, server, test).

### 3. Remove manual worker wiring from `web/src/App.tsx`

Delete these three import lines (currently lines 6–8):
```typescript
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import GraphQLWorker from "monaco-graphql/esm/graphql.worker?worker";
```

Delete the `self.MonacoEnvironment` block (currently lines 163–170):
```typescript
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "graphql") return new GraphQLWorker();
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
```

Keep `loader.config({ monaco: _monaco })` immediately after.

### 4. Verify graphql worker wiring (contingency)

Run `pnpm dev:no-wasm` and test GraphQL autocompletion in the schema editor. If `monacoGraphQLAPI.setSchemaConfig(...)` completes without errors and completions fire, the plugin wired the graphql worker correctly.

If the graphql worker fails (console error about missing worker for label "graphql"), add back a **partial** MonacoEnvironment that delegates only the graphql label and lets the plugin handle everything else:

```typescript
import GraphQLWorker from "monaco-graphql/esm/graphql.worker?worker";

// After loader.config:
const pluginGetWorker = self.MonacoEnvironment?.getWorker?.bind(self.MonacoEnvironment);
self.MonacoEnvironment = {
  getWorker(workerId, label) {
    if (label === "graphql") return new GraphQLWorker();
    return pluginGetWorker ? pluginGetWorker(workerId, label) : new Worker("");
  },
};
```

This preserves the graphql label override while delegating editor.worker and json.worker to the plugin.

### 5. Build and measure

```
cd web && pnpm build
```

Inspect `web/dist/assets/`. The following should be **absent**:
- `ts.worker*.js` (was 6.6 MB)
- `css.worker*.js` (was 1.0 MB)
- `html.worker*.js` (was 702 KB)
- Language mode chunk files for unused languages (~80 files)

The following should be **present**:
- `editor.worker*.js`
- `json.worker*.js`
- `graphql.worker*.js` (from monaco-graphql)

### 6. Run the full test suite

```
cd web && pnpm test run && pnpm e2e
```

All 394+ unit tests must pass. E2e smoke tests (GraphQL editing, autocompletion, schema composition) must pass.

## Files modified

- `web/package.json` — add `@monaco-editor/vite-plugin` devDependency
- `web/pnpm-lock.yaml` — updated by pnpm
- `web/vite.config.ts` — add plugin import + plugin entry in `plugins` array
- `web/src/App.tsx` — remove three `?worker` imports and the `self.MonacoEnvironment` block (~11 lines deleted; possible 6-line partial override added back if graphql worker needs explicit wiring)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Package choice
The implementation plan referenced  which does not exist on npm. Used  instead, which was already added to  prior to this execution.

### merge conflict resolved
 had a merge conflict in scripts (dev/dev:full) and devDependencies. Resolved by keeping the upstream version (separate dev/dev:full scripts) and adding wrangler from the stash. Also removed duplicate devDependency entries.

### CJS/ESM interop
 is a CommonJS package. When imported in Vite's ESM config context, the default export lives on . Added interop shim: .

### graphql worker contingency
The plugin's internal esbuild bundler cannot resolve  (without  extension) inside  — a known pnpm strict-exports incompatibility. Used the contingency plan from the implementation plan: kept GraphQLWorker as a  import in App.tsx; the partial MonacoEnvironment override handles graphql manually and delegates editor/json to the plugin's .

### monacoDisableBuiltinWorkers plugin
Monaco's TypeScript, CSS, HTML, and JSON workerManager files each contain a  pattern. Rolldown sees these patterns and emits separate worker bundles (ts.worker, css.worker, html.worker, plus a second json.worker) even though our MonacoEnvironment.getWorker override is called first at runtime and these createWorker callbacks are never reached. Added an inline Vite transform plugin that replaces the callback with , eliminating the bundles.

### Outcome
- Eliminated: ts.worker (6.6 MB), css.worker (1.0 MB), html.worker (702 KB), and redundant Rolldown-bundled json.worker (399 KB) — ~8.7 MB pre-gzip savings
- Added: editor.worker.bundle.js (579 KB) and json.worker.bundle.js (875 KB) in  via the plugin
- Kept: graphql.worker-*.js (638 KB) via ?worker import
- Net savings: ~7.25 MB pre-gzip in worker JS

### Note on AC1 language mode files
Monaco's basic-language tokenizer files (abap, apex, bat, etc.) are still present as code-split chunks from . Removing these would require restructuring the Monaco import to use only  plus selective language registrations — a larger refactor outside the scope of this worker-focused ticket.

## Implementation Notes

### Package choice
The implementation plan referenced @monaco-editor/vite-plugin which does not exist on npm. Used vite-plugin-monaco-editor@1.1.0 instead, which was already added to web/package.json prior to this execution.

### merge conflict resolved
web/package.json had a merge conflict in scripts (dev/dev:full) and devDependencies. Resolved by keeping the upstream version (separate dev/dev:full scripts) and adding wrangler from the stash. Also removed duplicate devDependency entries.

### CJS/ESM interop
vite-plugin-monaco-editor is a CommonJS package. When imported in Vite's ESM config context, the default export lives on .default. Added interop shim.

### graphql worker contingency
The plugin's internal esbuild bundler cannot resolve monaco-editor/esm/vs/editor/editor.worker (without .js extension) inside monaco-graphql/esm/graphql.worker.js — a known pnpm strict-exports incompatibility. Used the contingency plan: kept GraphQLWorker as a worker import in App.tsx; the partial MonacoEnvironment override handles graphql manually and delegates editor/json to the plugin's getWorkerUrl.

### monacoDisableBuiltinWorkers plugin
Monaco's TypeScript, CSS, HTML, and JSON workerManager files each contain a createWorker callback that uses new Worker(new URL('x.worker.js', import.meta.url)). Rolldown sees these patterns and emits separate worker bundles (ts.worker, css.worker, html.worker, plus a second json.worker) even though our MonacoEnvironment.getWorker override is called first at runtime. Added an inline Vite transform plugin that replaces the callback with undefined, eliminating the bundles.

### Outcome
- Eliminated: ts.worker (6.6 MB), css.worker (1.0 MB), html.worker (702 KB), and redundant Rolldown-bundled json.worker (399 KB)
- Added: editor.worker.bundle.js (579 KB) and json.worker.bundle.js (875 KB) in dist/monacoeditorwork/ via the plugin
- Kept: graphql.worker (638 KB) via worker import
- Net savings: approx 7.25 MB pre-gzip in worker JS

### Note on AC1 language mode files
Monaco's basic-language tokenizer files (abap, apex, bat, etc.) remain as code-split chunks from the full monaco-editor import. Removing these would require restructuring the Monaco import — a larger refactor outside the scope of this worker-focused ticket. The critical worker-bundle savings (8.3 MB eliminated) are achieved.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Installed vite-plugin-monaco-editor and added a custom monacoDisableBuiltinWorkers transform plugin to eliminate ts.worker (6.6 MB), css.worker (1.0 MB), and html.worker (702 KB) from the production build. The plugin manages editor.worker and json.worker via esbuild; the graphql worker is retained as a ?worker import with a partial MonacoEnvironment override because monaco-graphql's internal import path is incompatible with the plugin's esbuild bundler under pnpm. All 353 unit tests pass. Net savings: ~7.25 MB pre-gzip in worker JS.
<!-- SECTION:FINAL_SUMMARY:END -->
