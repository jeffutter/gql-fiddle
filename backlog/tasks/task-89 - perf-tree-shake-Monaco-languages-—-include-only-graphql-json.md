---
id: TASK-89
title: 'perf: tree-shake Monaco languages — include only graphql + json'
status: To Do
assignee: []
created_date: '2026-06-26 21:29'
labels:
  - performance
  - frontend
  - build
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
<!-- AC:END -->
