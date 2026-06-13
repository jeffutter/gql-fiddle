---
id: TASK-42
title: Improve intellisense in the query and variables editors
status: Done
assignee:
  - developer
created_date: '2026-06-12 19:44'
updated_date: '2026-06-13 07:17'
labels:
  - dx
  - editor
  - graphql
dependencies: []
priority: medium
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The query editor (bottom-left) and variables editor should offer rich autocomplete tied to the live supergraph schema and the active query's variable types.

**Current state**
- `monaco-graphql` is initialized and `setSchemaConfig` is called with the API schema SDL on every successful compose (`App.tsx` ~line 168–176).
- The query editor uses `path="query-N.graphql"` and `fileMatch: ["**/*.graphql"]`, so the graphql worker *should* pick up the schema — but only after the first successful compose, and it is unclear whether updates propagate correctly.
- The variables editor is a plain `<textarea>` with no autocomplete at all.

**Goal**
1. Ensure the query editor always has up-to-date GraphQL autocomplete (field names, argument names, types, directives) against the current composed supergraph schema.
2. Upgrade the variables editor to a Monaco JSON editor that receives a JSON Schema derived from the active query's variable definitions, so users get autocomplete and validation for the variables they need to provide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Typing in the query editor offers field/argument/type autocomplete drawn from the current supergraph schema (Ctrl+Space or trigger character).
- [x] #2 Query editor autocomplete updates automatically when the subgraph SDL is edited and a new compose succeeds — no page reload required.
- [x] #3 Query editor shows inline diagnostics (red squiggles) for invalid field names or type mismatches against the current schema.
- [x] #4 The variables editor is a Monaco editor (language: json) rather than a plain textarea.
- [x] #5 The variables editor receives a JSON Schema derived from the active query's variable definitions and offers autocomplete + validation for those variables.
- [x] #6 Switching query tabs updates the variables editor's JSON Schema to match the newly active query's variables.
- [x] #7 All existing query-tab and compose tests continue to pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan

## Key Files
- `web/src/App.tsx` — Add setModeConfiguration after init; add setDiagnosticSettings with validateVariablesJson mapping on every compose and tab change; replace variables <textarea> with Monaco JSON <Editor language="json">.
- `web/src/App.test.tsx` — Extend mock to include setModeConfiguration and setDiagnosticSettings; update textarea count assertion from 1 to 0.
- `web/e2e/smoke.spec.ts` (if needed) — Update any <textarea> selectors for variables editor to use Monaco contenteditable divs.

## Phase 1: Query editor language features (AC #1, #2, #3)

Step 1: Call setModeConfiguration after initializeMode() returns:
  api.setModeConfiguration({ documentFormattingEdits: true, completionItems: true, hovers: true, documentSymbols: true, diagnostics: true });
This is a one-time call. Diagnostics: true enables red squiggles (AC #3). CompletionItems: true drives autocomplete (AC #1).

Step 2: Schema update propagation (AC #2) — No new code needed. Existing setSchemaConfig on each debounced compose success already triggers worker schema cache reset and updates all matching files automatically.

TDD (Phase 1, write in App.test.tsx):
  1. Test: setModeConfiguration called on init with all features enabled. Criticality: 9
  2. Test: diagnostics flag is true in mode config. Criticality: 8
  3. Existing test at line ~140 (AC#3: calls setSchemaConfig with api_schema_sdl) verifies AC #2 — keep it.

Extended mock:
  jest.mock('monaco-graphql', () => ({
    initializeMode: jest.fn().mockResolvedValue({
      setSchemaConfig: setSchemaConfigMock,
      setModeConfiguration: modeConfigMock,       // NEW
      setDiagnosticSettings: diagSettingsMock,     // NEW
    }),
  }));

## Phase 2: Variables editor — Monaco JSON with auto-schema (AC #4, #5)

Step 3: Replace <textarea> with:
  <Editor height="100%" language="json" path={`/variables-query-${activeQueryTab}.json`} value={variables} onChange={(val) => setVariables(val || '')} options={{ minimap: { enabled: false }, wordWrap: 'on' }} />

Step 4: Call setDiagnosticSettings after every successful compose:
  const opUri = `/query-${activeQueryTab}.graphql`;
  const varUri = `/variables-query-${activeQueryTab}.json`;
  api.setDiagnosticSettings({
    validateVariablesJson: { [opUri]: [varUri] },
    jsonDiagnosticSettings: { allowComments: true },
  });
The monaco-graphql worker watches the query for variable definitions, generates JSON Schema automatically, and applies it to the linked variables model. No third-party library needed.

TDD (Phase 2):
  4. Test: variables editor is a Monaco JSON editor (<textarea> gone). Criticality: 9
  5. Test: setDiagnosticSettings called with correct validateVariablesJson mapping. Criticality: 9
  6. Test: jsonDiagnosticSettings.allowComments is true. Criticality: 7

## Phase 3: Tab switching updates variables JSON Schema (AC #6)

Step 5: useEffect on activeQueryTab change:
  useEffect(() => {
    if (!api) return;
    const opUri = `/query-${activeQueryTab}.graphql`;
    const varUri = `/variables-query-${activeQueryTab}.json`;
    api.setDiagnosticSettings({ validateVariablesJson: { [opUri]: [varUri] }, jsonDiagnosticSettings: { allowComments: true } });
  }, [api, activeQueryTab]);
Note: setDiagnosticSettings overwrites (not merges). Since only one tab is active at a time, this is correct.

TDD (Phase 3):
  7. Test: switching tabs calls setDiagnosticSettings with new URIs. Criticality: 9
  8. Test: variables editor loads correct value for new tab. Criticality: 8

## Phase 4: Regression (AC #7)

Step 6: Update App.test.tsx line ~25 — change expect(textareas).toHaveLength(1) to .toHaveLength(0).
Step 7: Run cd web && pnpm test run. Verify full suite passes.

## API Calls (exact signatures from research brief)
- api.setModeConfiguration({ completionItems: true, diagnostics: true, hovers: true, documentSymbols: true, documentFormattingEdits: true })
- api.setDiagnosticSettings({ validateVariablesJson: { [opUri]: [varUri] }, jsonDiagnosticSettings: { allowComments: true } })

## Risks
- Model lifecycle leaks on tab removal: mitigate with monaco.editor.getModel(uri)?.dispose() in cleanup.
- setDiagnosticSettings overwrite vs merge: overwrite is correct for single active tab, but verify during Phase 3 testing.
- E2e smoke test may use <textarea> selectors: update to contenteditable divs if needed.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implements full intellisense for query and variables editors. Query editor now has explicit setModeConfiguration() enabling completionItems, diagnostics (red squiggles), hovers, documentSymbols, and formattingEdits. Variables editor upgraded from plain textarea to Monaco JSON editor with automatic JSON Schema generation from GraphQL variable definitions via monaco-graphql's validateVariablesJSON feature. Tab switching correctly updates the variables schema mapping via a useEffect on activeQueryTab. All 76 existing tests pass after updating the textarea count assertion and fixing selectors for the new Monaco-based variables editor.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: Improve Intellisense in Query and Variables Editors (TASK-42)

## Summary

The query editor already uses `monaco-graphql` but lacks explicit mode configuration — it relies on the default worker setup without calling `setModeConfiguration()` or `setDiagnosticSettings()`, so autocomplete, hover, and schema-driven diagnostics are likely not wired up. The variables editor is a plain `<textarea>`; monaco-graphql provides built-in JSON variables validation via `setDiagnosticSettings({ validateVariablesJson: { ... } })` which maps an operation model URI to a variables model URI and generates the JSON Schema on-the-fly from the GraphQL variable definitions. No third-party library is needed for the conversion — it's handled internally by `monaco-graphql`'s worker.

## Findings

### 1. Query editor: autocomplete and diagnostics are not explicitly enabled

**Current state:** `App.tsx` calls `initializeMode()` (which returns a `MonacoGraphQLAPI`) and then `setSchemaConfig()` on every successful compose. However, it never calls `setModeConfiguration()` to enable the language features (completion, hover, diagnostics). The monaco-graphql worker *does* provide these features by default, but there's no guarantee they're wired up correctly because:

- `initializeMode()` is called lazily only after the first successful compose. Before that, the query editor has no schema context at all.
- There's no `setModeConfiguration()` call — so if any feature was disabled in a later version, it would silently be off.
- The query editor uses `<Editor language="graphql" path="query-N.graphql">` with `fileMatch: ["**/*.graphql"]`, which should match, but the schema is only set *after* compose succeeds.

**Recommended approach:** Call `api.setModeConfiguration()` immediately after `initializeMode()`:

```ts
monacoGraphQLAPI.setModeConfiguration({
  documentFormattingEdits: true,
  completionItems: true,
  hovers: true,
  documentSymbols: true,
  diagnostics: true,   // ← enables red squiggles / schema validation
});
```

**Key API:** `monaco.languages.graphql.api.setModeConfiguration(config: ModeConfiguration)` — toggles each language feature. All are enabled by default when using the full `initializeMode()`, but calling it explicitly is safer and documents intent. [Source](https://github.com/graphql/graphiql/blob/main/packages/monaco-graphql/README.md)

**Gotcha:** `setSchemaConfig()` *resets* the entire schema configuration — all language features are reloaded. This means every compose call triggers a worker reset. For this app that's acceptable (compose is debounced at 300ms), but be aware of the performance implication.

### 2. Schema updates propagate correctly via `setSchemaConfig`

**Finding:** When `setSchemaConfig()` is called after a successful compose with the new `api_schema_sdl`, the monaco-graphql worker reloads its schema cache. All matching files (`fileMatch: ["**/*.graphql"]`) get updated autocomplete and diagnostics automatically — no page reload needed. This directly satisfies AC #2 (autocomplete updates when subgraph SDL changes and compose succeeds).

**Gotcha:** `setSchemaConfig()` overwrites the *entire* schema config array. If you ever add a second schema (e.g., for type-definition files), you must include both in every call: `[...previousSchemas, newSchema]`. Currently there's only one schema so this isn't an issue.

### 3. Variables editor: use monaco-graphql's built-in `validateVariablesJson` — no external library needed

**Finding:** monaco-graphql already provides a mechanism to generate JSON Schema from GraphQL variable definitions automatically. The API is `setDiagnosticSettings()`:

```ts
monacoGraphQLAPI.setDiagnosticSettings({
  validateVariablesJson: {
    // Maps operation model URI → variables model URI(s)
    [operationModelUri]: [variablesModelUri],
  },
  jsonDiagnosticSettings: {
    allowComments: true,  // JSONC support — useful for dev UX
  },
});
```

When this is configured, the monaco-graphql worker:
1. Watches changes on the operation model (the query editor)
2. Extracts variable definitions from the GraphQL operations in that model
3. Generates a JSON Schema describing the expected structure of variables
4. Applies that schema to the linked variables model for validation + autocomplete

This is handled entirely inside the worker — **no third-party library** like `json-schema-from-graphql` or `graphql-to-json-schema` is needed. The conversion is built into `monaco-graphql`.

**Reference:** [monaco-graphql README — Variables JSON Support](https://github.com/graphql/graphiql/blob/main/packages/monaco-graphql/README.md)

### 4. Variables editor: upgrade from `<textarea>` to Monaco JSON editor

**Current state:** The variables editor is a plain `<textarea>` with manual `JSON.parse()` validation only on Run click.

**Recommended approach:** Replace the `<textarea>` with a Monaco editor instance using `language: 'json'`. Since `monaco-graphql` already imports `monaco-editor` and configures workers for both `graphql` and `json` languages, the JSON mode is available. Use `@monaco-editor/react`'s `<Editor>` component (already imported) with `language="json"`.

**Key integration point:** The variables editor model needs a URI that matches the mapping in `validateVariablesJson`:

```ts
// Create a model for each query tab's variables
const variablesModelUri = monaco.Uri.parse(`/variables-query-${tabIndex}.json`);
const variablesModel = monaco.editor.createModel(
  currentVariables,
  'json',
  variablesModelUri,
);
```

Then in `setDiagnosticSettings`:
```ts
[operationModelUri]: [variablesModelUri],
```

**Gotcha — model lifecycle:** Each query tab needs its own variables model. When a tab is removed, call `monaco.editor.setModelDispose(variablesModel)` to avoid memory leaks. When switching tabs, just change the editor's model (or create/destroy models).

### 5. Switching query tabs updates variables JSON Schema automatically

**Finding:** The `validateVariablesJson` mapping is keyed by operation model URI. When the user switches query tabs:
- The operation model changes (different path = different URI)
- The worker detects the new operation content
- It re-generates the JSON Schema from the new variable definitions
- The linked variables model gets updated diagnostics and completions

**Implementation:** Create a one-to-one mapping:
```ts
const operationModelUri = monaco.Uri.parse(`/query-${activeQueryTab}.graphql`);
const variablesModelUri = monaco.Uri.parse(`/variables-query-${activeQueryTab}.json`);

monacoGraphQLAPI.setDiagnosticSettings({
  validateVariablesJson: {
    [operationModelUri.toString()]: [variablesModelUri.toString()],
  },
  jsonDiagnosticSettings: { allowComments: true },
});
```

When `activeQueryTab` changes, update both the operation model (via the existing query editor) and create/update the variables model with the new URI. The worker handles the rest.

### 6. Known issue: recursive/nested input types can break variable JSON schema generation

**Finding:** There's a known bug in monaco-graphql where deeply nested or recursive input types (e.g., `_and: [issues_where_input!]` inside `issues_where_input`) can cause infinite recursion in `getVariablesJSONSchema`, breaking the variables editor entirely. This was fixed in PR [#2917](https://github.com/graphql/graphiql/pull/2917) — ensure you're on monaco-graphql ≥ 1.5.3 (the fix landed after v1.5.0).

**Current version:** `monaco-graphql@^1.8.0` — the fix is included. No workaround needed. [Source](https://github.com/graphql/graphiql/issues/2685)

### 7. Existing tests: what needs to pass

The test file (`App.test.tsx`) mocks `initializeMode` and `setSchemaConfig`. The new implementation will need to also mock `setModeConfiguration` and `setDiagnosticSettings` if they're called in the render path. The test at line ~140 ("AC#3: calls setSchemaConfig with api_schema_sdl") will continue to work — it just needs the new mocks added.

**Critical:** The variables editor currently has exactly 1 `<textarea>` on the page (line ~25 of the tests). After upgrading to a Monaco JSON editor, there will be **zero** `<textarea>`s — all three editors (subgraph, query, variables) will be Monaco instances. This test assertion needs updating:

```ts
// OLD: expects exactly 1 textarea (the variables editor)
expect(textareas).toHaveLength(1);

// NEW: expects 0 textareas (all are Monaco editors)
expect(textareas).toHaveLength(0);
```

## Sources

### Kept
- **monaco-graphql README** (https://github.com/graphql/graphiql/blob/main/packages/monaco-graphql/README.md) — Primary API reference for `setSchemaConfig`, `setModeConfiguration`, `setDiagnosticSettings`, `validateVariablesJson`, and the variables JSON workflow. Defines all key signatures.
- **monaco-graphql CHANGELOG** (https://github.com/graphql/graphiql/blob/main/packages/monaco-graphql/CHANGELOG.md) — Version history showing recursive variable fix in PR #2917, worker stability improvements, and API changes across versions.
- **monaco-graphql GitHub repo** (https://github.com/graphql/graphiql/tree/main/packages/monaco-graphql) — Source of truth for the library's implementation details.
- **Monaco Editor JSON contribution** (https://github.com/microsoft/monaco-editor/blob/b8fa85f6/src/language/json/monaco.contribution.ts) — Reference for `jsonDefaults.setDiagnosticsOptions()` and JSON language mode configuration.
- **App.test.tsx** (web/src/App.test.tsx) — Existing test suite defining what must continue to pass; includes the textarea count assertion that will need updating.
- **smoke.spec.ts** (web/e2e/smoke.spec.ts) — Playwright E2E test for compose → query → results flow.

### Dropped
- `json-schema-from-graphql` npm package — Third-party library not needed; monaco-graphql handles the conversion internally.
- `graphql-to-json-schema` / `graphql-2-json-schema` — Same reason; built-in worker does this.
- `@monaco-editor/react` docs — Already imported and used in the project; no new integration patterns needed beyond standard usage.

## Gaps

1. **Exact TypeScript types for `setDiagnosticSettings`** — The README shows the shape but not the full TS interface. The developer should check the typedoc at https://graphiql-test.netlify.app/typedoc/classes/monaco_graphql.monacoMonacoGraphQLAPI.html for the exact `DiagnosticSettings` type definition.

2. **Behavior of `setDiagnosticSettings` when called multiple times** — Does it merge or overwrite? The README implies it overwrites. The developer should verify this behavior and ensure tab switching calls it with the correct mapping each time.

3. **How to create a Monaco JSON editor model dynamically per-tab** — The exact pattern for creating/disposing models on tab add/remove/switch isn't fully documented in the monaco-graphql README. The developer may need to reference the webpack example at https://github.com/graphql/graphiql/tree/main/examples/monaco-graphql-webpack/src/editors.ts for the model lifecycle pattern.

4. **Whether `@monaco-editor/react`'s `<Editor>` component supports model reuse** — When switching tabs, should we swap models on an existing editor instance, or create a new Editor per tab? This affects rendering performance and state management. The developer should test both approaches.

5. **Test mocking strategy for the new APIs** — The existing tests mock `initializeMode` to return `{ setSchemaConfig }`. Adding `setModeConfiguration` and `setDiagnosticSettings` to that mock is straightforward, but the variables editor Monaco instances will need their own mocks or a different testing approach (e.g., Testing Library queries for `.monaco-editor` containers).

<!-- SECTION:NOTES:END -->
