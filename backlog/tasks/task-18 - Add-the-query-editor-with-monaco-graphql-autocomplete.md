---
id: TASK-18
title: Add the query editor with monaco-graphql autocomplete
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-10 23:29'
labels: []
milestone: m-2
dependencies:
  - TASK-8
  - TASK-14
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the bottom Query editor using Monaco with GraphQL language features (autocomplete, validation) driven by the composed API schema, so the user gets schema-aware help while writing queries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 compose() success result includes api_schema_sdl and the ComposeResult ok type is updated
- [x] #2 The query editor is a Monaco editor wired to the store query
- [x] #3 Autocomplete suggests fields from the currently composed API schema
- [x] #4 Editing subgraphs updates the autocomplete schema to match
- [x] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions. The full Research Brief in the Notes section below is authoritative — read it before starting; this plan references its sections.

1. Add deps: run `nix develop -c bash -c "cd web && pnpm add monaco-graphql graphql"`.
   - These are NOT yet installed (only @monaco-editor/react ^4.7.0 and monaco-editor ^0.55.1 are present). `graphql` is a required peer dependency of `monaco-graphql`. `prettier` is already a devDependency, so do not add it.

2. Expose the API schema from the WASM core (AC#1). Edit `crates/gql-core/src/compose.rs`:
   - In the `Ok(supergraph)` success branch, after the existing `sdl` and `hints` are computed, derive the API schema and add it to the returned JSON object:
     ```rust
     let api_schema_sdl = crate::api_schema::derive_api_schema(&sdl)
         .unwrap_or_default(); // empty string on unexpected error; safe because a composed supergraph derives cleanly in practice
     json!({
         "ok": true,
         "supergraph_sdl": sdl,
         "api_schema_sdl": api_schema_sdl,
         "hints": hints,
     })
     ```
   - `derive_api_schema` is already `pub(crate)` in `crates/gql-core/src/api_schema.rs` — no visibility change needed. Match the exact variable name the existing code uses for the SDL string (the brief shows `let sdl = supergraph.schema().schema().to_string();`).
   - MUST FIX TEST: the existing test `success_path_keys_match_contract` in compose.rs asserts the success object's keys are EXACTLY `["ok", "supergraph_sdl", "hints"]`. Update that expected key set to `["ok", "supergraph_sdl", "api_schema_sdl", "hints"]`. The error-path test is unaffected.
   - Run the Rust tests: `nix develop -c bash -c "cd crates/gql-core && cargo test"` and confirm the contract test passes.

3. Rebuild the WASM bindings: `nix develop -c bash -c "cd web && pnpm build:wasm"`.
   - This regenerates `web/src/wasm/gql_core.js` and `web/src/wasm/gql_core.d.ts`. Do NOT hand-edit those generated files.

4. Update the TypeScript ComposeResult type (AC#1). In `web/src/core/types.ts`, add `api_schema_sdl: string` to the `ok: true` branch of the `ComposeResult` union:
   ```typescript
   export type ComposeResult =
     | { ok: true; supergraph_sdl: string; api_schema_sdl: string; hints: CompositionHint[] }
     | { ok: false; errors: CompositionError[] };
   ```
   - No change is needed in `web/src/core/index.ts`; its `compose()` wrapper passes through whatever JSON the WASM returns.

5. Extend the Zustand store (`web/src/store.ts`) to track the API schema (supports AC#4):
   - Add `apiSchemaSdl: string | null` to `WorkspaceState`, initialized to `null`.
   - Update `setComposeResult` to set `apiSchemaSdl` from `result.api_schema_sdl` on success and clear it (or leave the prior value per the existing stale-schema convention) on failure — follow the exact same pattern already used for `supergraphSdl`.
   - The `setQuery` action already exists; reuse it unchanged.

6. Register the monaco-graphql web worker for Vite in `web/src/App.tsx` (required for autocomplete to work — AC#3):
   - Add the import: `import GraphQLWorker from 'monaco-graphql/esm/graphql.worker?worker';`
   - Extend the existing `self.MonacoEnvironment.getWorker` switch (which already handles `editorWorker` and `jsonWorker`) to return `new GraphQLWorker()` when `label === 'graphql'`:
     ```typescript
     self.MonacoEnvironment = {
       getWorker(_, label) {
         if (label === 'graphql') return new GraphQLWorker();
         if (label === 'json') return new jsonWorker();
         return new editorWorker();
       },
     };
     ```

7. Initialize monaco-graphql once and wire it to the composed schema (AC#3, AC#4) in `web/src/App.tsx`:
   - At MODULE level (outside the `App` component, so it is not re-created on re-render), declare a singleton:
     ```typescript
     import { initializeMode } from 'monaco-graphql/initializeMode';
     import type { MonacoGraphQLAPI } from 'monaco-graphql';
     let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;
     ```
   - In the EXISTING debounced compose `useEffect` (the one that calls `core.compose(subgraphs)` and dispatches `setComposeResult`), inside the `if (result.ok)` branch, after dispatching the store update, push the schema into monaco-graphql:
     ```typescript
     if (!monacoGraphQLAPI) {
       monacoGraphQLAPI = initializeMode();
     }
     monacoGraphQLAPI.setSchemaConfig([
       {
         documentString: result.api_schema_sdl,
         uri: 'api-schema.graphql',
         fileMatch: ['**/*.graphql'],
       },
     ]);
     ```
   - Use `documentString` (a plain SDL string) — NOT `schema` (a GraphQLSchema object cannot cross the JS→WebWorker boundary). The SDL from `derive_api_schema()` is already the correct format.
   - `setSchemaConfig` triggers a full worker reload, so call it only from this already-debounced effect (existing `COMPOSE_DEBOUNCE_MS = 300`). Do NOT call it per keystroke. Because this runs whenever composition succeeds, editing subgraphs naturally updates the autocomplete schema (AC#4).

8. Replace the query placeholder with a Monaco GraphQL editor (AC#2) in `web/src/App.tsx`:
   - Replace the bottom `<section>`'s `<pre style={{ fontFamily: "monospace" }}>{query}</pre>` placeholder with the `@monaco-editor/react` `<Editor>` component (already imported and used for the subgraph editor):
     ```tsx
     <Editor
       language="graphql"
       path="query.graphql"
       value={query}
       onChange={(v) => setQuery(v ?? "")}
     />
     ```
   - The `path` prop becomes the Monaco model URI and MUST match the `fileMatch` glob from step 7. The pair `fileMatch: ['**/*.graphql']` + `path="query.graphql"` matches. The `language` MUST be `'graphql'` (not `'plaintext'`).
   - Wire `value` to the store `query` and `onChange` to the existing `setQuery` action.

9. Verify functional behavior (AC#2, AC#3, AC#4):
   - Run the dev server: `nix develop -c bash -c "cd web && pnpm dev"`.
   - Confirm the bottom Query section is now a Monaco editor bound to the store query.
   - Type in the query editor and confirm autocomplete offers fields from the composed API schema (e.g. fields on `Query`).
   - Edit a subgraph SDL, wait for re-composition, and confirm the autocomplete suggestions update to match the new schema. An unknown field should show a validation error.

10. Verify quality gates (AC#5): run both, fix any errors, and confirm clean:
    - `nix develop -c bash -c "cd web && pnpm tsc --noEmit"`
    - `nix develop -c bash -c "cd web && pnpm lint"`
    (Pre-commit also enforces these.)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-18 implemented the Monaco GraphQL query editor with schema-aware autocomplete. The Rust core now exposes `api_schema_sdl` in the `compose()` success envelope (federation internals stripped via `derive_api_schema`), and the TypeScript `ComposeResult` type was updated to match. `App.tsx` wires a singleton `monacoGraphQLAPI` (initialized on first successful compose) that receives `setSchemaConfig` calls with the composed API schema SDL, enabling field autocomplete in the query editor. The bottom pane was replaced with a `language="graphql"` Monaco Editor bound to the store `query` field. All 38 Rust tests pass (including 3 compose snapshot tests updated to include the new `api_schema_sdl` field), 44 TypeScript/React tests pass, and `tsc --noEmit` and `eslint` both pass cleanly. The implementation correctly avoids `panic!`/`unwrap()` in production code paths and keeps the JS boundary free of apollo-federation internals.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-18 — Query Editor with monaco-graphql Autocomplete

## 1. Codebase Snapshot

### 1.1 Rust/WASM: `crates/gql-core/src/`

**`lib.rs`** — WASM boundary. Exports thin `#[wasm_bindgen]` wrappers. `compose()` takes JSON-encoded subgraphs and returns a JSON string. No panic on bad input.

**`compose.rs`** — `pub fn compose(subgraphs: &[SubgraphInput]) -> Value`
- On success returns: `{ ok: true, supergraph_sdl: String, hints: Vec<{code, message}> }`
- On failure returns: `{ ok: false, errors: Vec<{code, message, locations}> }`
- **Critical constraint**: `compose.rs` has a test `success_path_keys_match_contract` that asserts the success object contains **exactly** the keys `["ok", "supergraph_sdl", "hints"]`. Adding `api_schema_sdl` will break this test. The test must be updated when AC#1 is implemented.

**`api_schema.rs`** — `pub(crate) fn derive_api_schema(supergraph_sdl: &str) -> Result<String, FederationError>`
- Uses `Supergraph::new(supergraph_sdl)?.to_api_schema(ApiSchemaOptions::default())?.schema().to_string()`
- Already implemented and tested. Strips federation internals (`@join__`, `_entities`, `_Service`). Returns client-facing SDL string.
- This is the function to call inside `compose()` to populate `api_schema_sdl`.

**`dto.rs`** (implied) — `SubgraphInput { name: String, sdl: String }`

### 1.2 TypeScript: `web/src/`

**`core/types.ts`** — `ComposeResult` union type:
```typescript
export type ComposeResult =
  | { ok: true; supergraph_sdl: string; hints: CompositionHint[] }
  | { ok: false; errors: CompositionError[] };
```
Needs `api_schema_sdl: string` added to the `ok: true` branch.

**`core/index.ts`** — `loadCore()` returns a singleton `GqlCore`. The `compose()` wrapper is:
```typescript
compose(subgraphs: SubgraphInput[]): ComposeResult {
  return json(ns.compose(JSON.stringify(subgraphs)));
}
```
No changes needed here; it already passes through whatever JSON the WASM returns.

**`store.ts`** — Zustand store with `WorkspaceState`. Has `supergraphSdl`, `composeErrors`, `composeHints`. Needs a new `apiSchemaSdl: string | null` field and corresponding update in `setComposeResult`. The `setQuery` action already exists.

**`App.tsx`** — Already imports `@monaco-editor/react` and `monaco-editor`. Has a debounced composition `useEffect` that calls `core.compose(subgraphs)` and dispatches `setComposeResult`. The bottom "Query" section currently renders:
```tsx
<section>
  <h2>Query</h2>
  <pre style={{ fontFamily: "monospace" }}>{query}</pre>
</section>
```
This `<pre>` is the placeholder to replace with the Monaco editor for queries.

**`web/package.json`** — Current dependencies: `@monaco-editor/react ^4.7.0`, `monaco-editor ^0.55.1`. **Neither `monaco-graphql` nor `graphql` package is installed yet.**

**`web/src/wasm/gql_core.d.ts`** — Generated by `wasm-pack`. The `compose` export signature is:
```typescript
export function compose(subgraphs_json: string): string;
```
This file is auto-generated; do not hand-edit it.

---

## 2. monaco-graphql Package API

**Package**: `monaco-graphql` (latest stable: 1.6.0). Peer dependencies: `graphql ≥15.5.0`, `monaco-editor ≥0.20.0`, `prettier ≥2.8.0`.

**Packages to install**: `monaco-graphql` and `graphql`. (Prettier is already present as a devDependency in the project.)

### 2.1 Entry Points

| Import path | Purpose |
|---|---|
| `monaco-graphql/initializeMode` | `initializeMode()` factory (eager worker start) |
| `monaco-graphql/esm/graphql.worker?worker` | Vite-compatible worker import |
| `monaco-graphql/monaco-editor` | Reduced Monaco bundle (skips 83 unused languages) |

### 2.2 `initializeMode(config?): MonacoGraphQLAPI`

```typescript
import { initializeMode } from 'monaco-graphql/initializeMode';

const api = initializeMode({
  schemas: [/* SchemaConfig[] */],
  // optional: modeConfiguration, formattingOptions, diagnosticSettings, completionSettings
});
```

- Returns a `MonacoGraphQLAPI` instance.
- Registers `languages.graphql.api` on the global monaco object.
- Asynchronously starts the worker via `setupMode`.
- **Must be called once** at module level (singleton — repeated calls return the cached instance).

### 2.3 `SchemaConfig` Fields

The `SchemaConfig` object supports these schema-supply methods (pick one per config entry):

| Field | Type | Notes |
|---|---|---|
| `schema` | `GraphQLSchema` | Compiled schema object — **cannot cross worker boundary** |
| `introspectionJSON` | object | Raw introspection query result |
| `introspectionJSONString` | string | Stringified introspection JSON |
| `documentString` | string | **SDL string** — the correct choice for this project |
| `documentAST` | `DocumentNode` | Pre-parsed AST |

Additional required/common fields:

| Field | Type | Notes |
|---|---|---|
| `uri` | string | Logical schema identifier, e.g. `'api-schema.graphql'` |
| `fileMatch` | `string[]` | Glob patterns matching Monaco model URIs to apply schema to |

**Key insight**: `documentString` accepts a plain GraphQL SDL string — exactly what `derive_api_schema()` returns. This avoids any `GraphQLSchema` object serialization problem across the worker boundary. The official webpack example confirms that `documentString` is the correct field when you have SDL text.

### 2.4 `MonacoGraphQLAPI` Methods

```typescript
// Override all schema config (triggers worker reload):
api.setSchemaConfig(schemas: SchemaConfig[]): void

// Toggle language features (completion, hovers, diagnostics, formatting):
api.setModeConfiguration(config: ModeConfiguration): void

// Prettier formatting config (static values only, no functions):
api.setFormattingOptions(options: FormattingOptions): void

// JSON variables validation:
api.setDiagnosticSettings(settings: DiagnosticSettings): void

// Add fragment definitions for completion:
api.setExternalFragmentDefinitions(defs: string | FragmentDefinitionNode[]): void
```

`setSchemaConfig()` is the mechanism for dynamic schema changes. Calling it with a new `documentString` causes the worker to re-parse the schema and refresh autocomplete/validation. This resets the worker, so avoid calling it on every keystroke.

### 2.5 Vite Worker Configuration

The Vite-specific pattern (matching what `App.tsx` already does for `editorWorker` and `jsonWorker`):

```typescript
import GraphQLWorker from 'monaco-graphql/esm/graphql.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'graphql') return new GraphQLWorker();
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  },
};
```

The label string `'graphql'` is what monaco-graphql registers itself under.

### 2.6 Editor Language for Query Models

Query editor instances must use language `'graphql'` (not `'plaintext'`). The model URI must match one of the `fileMatch` glob patterns in the `SchemaConfig`. A simple consistent approach:

```typescript
// Using @monaco-editor/react <Editor> component:
<Editor
  language="graphql"
  path="query.graphql"   // becomes the model URI; must match fileMatch
  value={query}
  onChange={(v) => setQuery(v ?? "")}
/>
```

The `path` prop on `@monaco-editor/react`'s `<Editor>` is used as the model URI. It must match the `fileMatch` pattern set in `SchemaConfig`. A matching pair: `fileMatch: ['**/*.graphql']` and `path="query.graphql"`.

### 2.7 Dynamic Schema Updates (React Pattern)

```typescript
// Module-level singleton (outside the React component):
let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;

// Inside App() component, in the existing compose useEffect:
useEffect(() => {
  // ... existing debounced compose logic ...
  const result = core.compose(subgraphs);
  if (result.ok) {
    // Initialize API once if needed:
    if (!monacoGraphQLAPI) {
      monacoGraphQLAPI = initializeMode();
    }
    monacoGraphQLAPI.setSchemaConfig([{
      documentString: result.api_schema_sdl,
      uri: 'api-schema.graphql',
      fileMatch: ['**/*.graphql'],
    }]);
    // ... existing store dispatch ...
  }
}, [subgraphs]);
```

The existing `COMPOSE_DEBOUNCE_MS = 300` debounce already throttles schema updates naturally. No additional debouncing of `setSchemaConfig` is needed.

---

## 3. Required Changes by Layer

### 3.1 Rust/WASM (`crates/gql-core/src/compose.rs`)

Inside the `Ok(supergraph)` branch, after computing `sdl` and `hints`, add:

```rust
// After: let sdl = supergraph.schema().schema().to_string();
let api_schema_sdl = crate::api_schema::derive_api_schema(&sdl)
    .unwrap_or_default(); // empty string on unexpected error

json!({
    "ok": true,
    "supergraph_sdl": sdl,
    "api_schema_sdl": api_schema_sdl,
    "hints": hints,
})
```

**Test breakage**: The test `success_path_keys_match_contract` asserts `keys == vec!["ok", "supergraph_sdl", "hints"]`. It must be updated to `vec!["ok", "supergraph_sdl", "api_schema_sdl", "hints"]`. The error path test is unaffected.

The `derive_api_schema` function is `pub(crate)` — no visibility change needed.

After editing, rebuild WASM: `nix develop -c bash -c "cd web && pnpm build:wasm"`

### 3.2 TypeScript Types (`web/src/core/types.ts`)

```typescript
export type ComposeResult =
  | { ok: true; supergraph_sdl: string; api_schema_sdl: string; hints: CompositionHint[] }
  | { ok: false; errors: CompositionError[] };
```

### 3.3 Zustand Store (`web/src/store.ts`)

Add `apiSchemaSdl: string | null` to `WorkspaceState`. Update `setComposeResult` signature to accept it and persist it, following the same stale-schema pattern as `supergraphSdl`.

### 3.4 `App.tsx` — Three changes

**A. Worker config** — Add `GraphQLWorker` import and extend the existing `MonacoEnvironment.getWorker` switch to handle `label === 'graphql'`.

**B. Compose effect** — When `result.ok`, extract `result.api_schema_sdl` and call `monacoGraphQLAPI.setSchemaConfig(...)`.

**C. Query editor** — Replace the `<pre>{query}</pre>` placeholder in the bottom `<section>` with a `<Editor language="graphql" path="query.graphql" value={query} onChange={...} />` component.

**Module-level `initializeMode` singleton** — Declare outside the component to avoid re-initialization on re-renders.

---

## 4. Key Gotchas

### 4.1 Test `success_path_keys_match_contract` Will Break
Must be updated alongside the compose.rs change — the assertion on exact key set must add `"api_schema_sdl"`.

### 4.2 `documentString` vs `schema` Object
`schema: GraphQLSchema` cannot cross the JS→WebWorker boundary (class instance). `documentString` (a plain SDL string) is the correct field. The SDL from `derive_api_schema()` is already the right format.

### 4.3 `fileMatch` and Model URI Must Agree
The `SchemaConfig.fileMatch` glob and the Monaco model URI (`path` prop) must match. Use `fileMatch: ['**/*.graphql']` and `path="query.graphql"`.

### 4.4 `initializeMode` Is a Singleton — Declare at Module Level
Putting it at module scope (outside the React component) prevents re-initialization on re-renders, matching the official examples.

### 4.5 `graphql` Package Not Yet Installed
The `graphql` package is a required peer dependency of `monaco-graphql`. Install both:
```
nix develop -c bash -c "cd web && pnpm add monaco-graphql graphql"
```

### 4.6 WASM Rebuild Required After Rust Changes
After editing `compose.rs`, run: `nix develop -c bash -c "cd web && pnpm build:wasm"`. The generated `web/src/wasm/gql_core.d.ts` and `gql_core.js` are auto-updated.

### 4.7 `derive_api_schema` Error Handling
If the supergraph composes successfully, deriving the API schema from it should not fail in practice. Using `.unwrap_or_default()` (empty string) in `compose()` is safe. An empty `api_schema_sdl` means the query editor temporarily loses autocomplete — not a crash.

### 4.8 `@monaco-editor/react` `<Editor>` Already in Use
The project already uses this component for the subgraph SDL editor. Using it again for the query editor is consistent and requires no new dependencies beyond `monaco-graphql` + `graphql`.

### 4.9 Schema Update Frequency
`setSchemaConfig()` triggers a full worker reload (relatively expensive). The existing 300ms debounce on the compose effect rate-limits this naturally.

---

## 5. Authoritative Sources

- monaco-graphql README: https://github.com/graphql/graphiql/tree/main/packages/monaco-graphql
- Official webpack example (confirms `documentString` field): https://github.com/graphql/graphiql/blob/main/examples/monaco-graphql-webpack/src/index.ts
- Official React+Vite example (worker setup pattern): https://github.com/graphql/graphiql/blob/main/examples/monaco-graphql-react-vite/src/index.tsx
- TypeDoc API reference: https://graphiql-test.netlify.app/typedoc/modules/monaco_graphql
- npm package: https://www.npmjs.com/package/monaco-graphql

<!-- SECTION:NOTES:END -->
