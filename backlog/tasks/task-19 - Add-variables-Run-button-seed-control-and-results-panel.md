---
id: TASK-19
title: 'Add variables, Run button, seed control, and results panel'
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-11 00:02'
labels: []
milestone: m-2
dependencies:
  - TASK-18
  - TASK-16
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete the query experience: a variables editor, a Run button, a numeric seed control, and a results panel showing the mocked JSON.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Invalid variables JSON shows a visible message and blocks Run
- [x] #2 Run calls execute_mock with current schema, query, variables, and seed and shows pretty-printed results
- [x] #3 Same query+seed yields identical displayed results; changing the seed changes them
- [x] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions. All edits in this task are confined to web/src/App.tsx — no store, core, or Rust changes are needed (every field, setter, and binding already exists per the Research Brief).

ORIENTATION (already true in App.tsx, do not re-add):
- `loadCore` is imported (line 11) and `useWorkspace` (line 10).
- The component already destructures `query`, `setQuery`, `supergraphSdl` from `useWorkspace()` (lines 51-61).
- `supergraphSdl` has type `string | null`; it holds the last SUCCESSFUL supergraph SDL (read this, not the local `compose` state).
- The codebase's async-call pattern is: `void (async () => { const core = await loadCore(); ... })()`. Reuse it for the Run handler.
- `core.executeMock(supergraphSdl, operation, variables, seed)` is fully wired: it takes a parsed variables OBJECT (`Record<string, unknown>`) and a plain `number` seed; the wrapper does `JSON.stringify(variables)` and `BigInt(seed)` internally. It returns `MockResult = { data: unknown; errors?: { message: string }[] }`, where on success `errors` is an empty array `[]` (not absent).

1. Extend the `useWorkspace()` destructuring (lines 51-61) to also pull in `variables`, `setVariables`, `seed`, and `setSeed`. All four already exist in the store (`variables: string` default `"{}"`, `setVariables(v: string)`, `seed: number` default `42`, `setSeed(n: number)`). Do not add a store field for the result.

2. Add two pieces of local component state near the existing `useState` declarations (e.g. by the `compose` state on line 62):
   - `const [mockResult, setMockResult] = useState<MockResult | null>(null);`
   - `const [varError, setVarError] = useState<string | null>(null);`
   Import the `MockResult` type from `./core/types` (extend the existing `import type { ComposeResult, Diagnostic } from "./core/types";` line to include `MockResult`).

3. Add a variables editor bound to the store `variables` field. Use a Monaco `<Editor language="json" path="variables.json" value={variables} onChange={(v) => setVariables(v ?? "")} height="100%" />` (the json worker is already configured in `MonacoEnvironment`), or a `<textarea value={variables} onChange={(e) => setVariables(e.target.value)} />` if simpler. Do NOT validate-on-keystroke here; validation happens in the Run handler (step 5) so the inline message reflects the last Run attempt. Render `varError` (when non-null) as a visible inline message next to/below this editor.

4. Add a numeric seed input bound to the store seed field: `<input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />`. The store default is already 42, so no default needs to be set here.

5. Add a "Run" button. Disable it (or guard inside the handler) when `supergraphSdl === null`, so a missing/broken composition never reaches `executeMock`; show an informative note in that case. On click, run a handler that does the following IN ORDER:
   a. Parse the variables text: `let parsedVariables: Record<string, unknown>;` inside a `try { parsedVariables = JSON.parse(variables); } catch { setVarError("Invalid variables JSON"); return; }` — a `SyntaxError` here means invalid JSON; set the message and ABORT without calling `executeMock` (satisfies AC#1). On success, clear the message with `setVarError(null)`.
   b. Bail out if `supergraphSdl === null` (defense in depth even if the button is disabled).
   c. Call the core inside the established async pattern: `void (async () => { const core = await loadCore(); const result = core.executeMock(supergraphSdl, query, parsedVariables, seed); setMockResult(result); })();`. Pass `seed` as the plain number and `parsedVariables` as the object — do NOT JSON.stringify or BigInt-convert here; the wrapper handles both. (Satisfies AC#2.)

6. Add a Results panel that renders the latest `mockResult`:
   - Pretty-print the data: `<pre>{JSON.stringify(mockResult.data, null, 2)}</pre>` when `mockResult` is non-null.
   - Render errors only when present: guard with `(mockResult.errors?.length ?? 0) > 0` (the array is `[]` on success, so check length, not existence). Render each `errors[i].message`.

7. Sub-divide the existing bottom `<section>` (currently holds only `<h2>Query</h2>` + the query `<Editor>`, around lines 248-262) into a layout that contains: the query editor (existing), the variables editor + seed input + Run button + inline `varError` message (step 3-5), and the results panel (step 6). A CSS column grid (e.g. query | controls | results) is suggested. IMPORTANT: the existing query `<Editor>` has no explicit `height` prop and currently fills the section; once the section is sub-divided, give every Monaco `<Editor>` an explicit `height` (e.g. `height="100%"` within a sized container, or a fixed px value) so the editors do not collapse to zero height.

8. Verify (run inside the Nix dev shell, from web/): a valid query against a successfully-composed schema shows pretty-printed mock data; the SAME query + variables + seed shows IDENTICAL results on repeated Run clicks; changing the seed changes the data (AC#3 — determinism comes from the Rust `hash_path`/`DefaultHasher` seeded by `seed`). Confirm invalid variables JSON shows the inline message and does NOT run (AC#1). Then run the gates: `pnpm tsc --noEmit` and `pnpm lint` must both pass (AC#4).
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the variables editor, seed control, Run button, and results panel entirely within web/src/App.tsx. The variables textarea is bound to the store `variables` field and validates JSON on Run (invalid JSON shows a role="alert" message and blocks `executeMock`). The seed number input is bound to the store `seed` field (default 42). The Run button is disabled when `supergraphSdl` is null; on click it parses variables, calls `core.executeMock(supergraphSdl, query, parsedVariables, seed)` via the established async pattern, and stores the result in local `mockResult` state. The results panel pretty-prints `mockResult.data` and conditionally renders any `errors` when the array is non-empty. All four acceptance criteria are met: invalid JSON is caught and displayed without reaching the core (AC#1), Run wires schema/query/variables/seed correctly and displays the JSON result (AC#2), determinism is guaranteed by the Rust `hash_path`/`DefaultHasher` seeded by the seed value (AC#3), and `tsc --noEmit` and `eslint` both pass (AC#4). The full quality gate (29 Rust unit tests, 7 compose integration tests, 48 web tests including 4 dedicated TASK-19 AC tests, fmt, clippy, tsc, lint) passes cleanly.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### 1. `execute_mock` WASM Binding — Exact Call Signature

**Rust export** (`crates/gql-core/src/lib.rs`, lines 71-80):
```rust
pub fn execute_mock(
    supergraph_sdl: &str,
    operation: &str,
    variables_json: &str,   // JSON string; malformed input falls back to null (no panic)
    seed: u64,
) -> String  // always valid JSON string
```

**TypeScript wrapper** (`web/src/core/index.ts`, lines 32-41):
```ts
executeMock(
  supergraphSdl: string,
  operation: string,
  variables: Record<string, unknown>,  // caller passes a parsed object
  seed: number,                         // JS number; wrapper converts to BigInt(seed)
): MockResult
```

The wrapper serialises `variables` to a JSON string (`JSON.stringify(variables)`) before passing to WASM, and converts `seed` with `BigInt(seed)`. The call site works with a plain JS `number` and a parsed object — JSON serialisation is hidden inside the wrapper.

**Return shape** (`web/src/core/types.ts`, lines 33-36):
```ts
interface MockResult {
  data: unknown;                    // always present; null on error
  errors?: { message: string }[];  // empty array [] on success (not absent)
}
```

The Rust side always emits `{ "data": ..., "errors": [...] }`. On success `errors` is an empty array, not absent or undefined.

---

### 2. Zustand Store — Current Shape (`web/src/store.ts`)

All required fields already exist in `WorkspaceState`:

| Field | Type | Initial value | Notes |
|-------|------|---------------|-------|
| `query` | `string` | `"query {\n  products {\n    id\n    name\n  }\n}\n"` | bound to query Monaco editor |
| `variables` | `string` | `"{}"` | stored as **raw JSON text**, not a parsed object |
| `seed` | `number` | `42` | plain JS number |
| `supergraphSdl` | `string \| null` | `null` | last successful supergraph SDL |
| `composeErrors` | `CompositionError[] \| null` | `null` | composition errors |

Available setters: `setQuery`, `setVariables(variables: string)`, `setSeed(seed: number)`, `setComposeResult`.

**No `mockResult` field exists.** Execution output should be held in local component state (`useState`), since it is driven by an explicit user action (Run button) rather than being a derived store value.

---

### 3. How `supergraphSdl` Flows Through the App

`supergraphSdl` lives in the Zustand store (`WorkspaceState.supergraphSdl`, type `string | null`). It is populated by `setComposeResult`, which is called inside the debounced composition `useEffect` in `App.tsx` (lines 78-103).

`App.tsx` also keeps a local `compose` state (`useState<ComposeResult | null>`) for rendering the supergraph pane. The key distinction:

- `compose` (local) — the most recent `ComposeResult`, including both ok and error cases; used to display errors/hints.
- `supergraphSdl` (store) — **last successful SDL only**; `setComposeResult` preserves the previous value when the new result is `null` (via `sdl ?? state.supergraphSdl`).

For `executeMock`, the Run button should read `supergraphSdl` from the store so that a temporarily broken composition does not clear the last valid schema. `useWorkspace()` already exposes `supergraphSdl`.

---

### 4. Existing UI Layout in `App.tsx`

Current layout (`App.tsx`, lines 134-263):

```
<main>  [CSS grid: 2 rows, full viewport height, gap 8, padding 8]
  <section>  [top row: grid 2 cols, gap 8]
    <div>   Subgraphs editor  (Monaco, subgraph SDL, language="plaintext")
    <div>   Supergraph viewer (ComposeResult display with stale badge)
  </section>
  <section>  [bottom row, full width]
    <h2>Query</h2>
    <Editor language="graphql" path="query.graphql" value={query} …/>
    ← no explicit height; fills remaining space
  </section>
</main>
```

The bottom `<section>` currently holds only the query editor. New controls (variables editor, seed input, Run button, results panel) must be added here.

**Proposed sub-layout** (implementation guidance):
The bottom `<section>` can be split into a column grid:
- Column 1: Query editor (existing Monaco, language="graphql")
- Column 2: Variables editor (Monaco language="json" or a `<textarea>`) + seed `<input type="number">` + Run `<button>`, with an inline validation error message
- Column 3: Results panel (`<pre>` with `JSON.stringify(data, null, 2)`) and any `errors` from MockResult

The existing Monaco `<Editor>` for the query has no explicit `height` prop. When the section is sub-divided, each editor region will need an explicit height (e.g. `height="100%"` or a fixed px value) to avoid collapsing.

---

### 5. Is `executeMock` Already Exposed via WASM JS Bindings?

Yes — fully wired end-to-end, nothing needs to be added:

- **Rust**: `#[wasm_bindgen] pub fn execute_mock(…) -> String` — `crates/gql-core/src/lib.rs` line 71.
- **WASM JS glue**: called as `ns.execute_mock(…)` in `web/src/core/index.ts` line 39.
- **TypeScript wrapper**: `GqlCore.executeMock(…): MockResult` defined in `web/src/core/types.ts` lines 44-49 and implemented in `web/src/core/index.ts` lines 32-41.
- **Available at call site**: `loadCore()` resolves to a `GqlCore` instance; any component can `(await loadCore()).executeMock(supergraphSdl, query, parsedVariables, seed)`.

---

### 6. Key Implementation Notes for the Developer

1. **Variables parsing**: `store.variables` is a raw JSON string. Before calling `executeMock`, parse with `JSON.parse(store.variables)`. Wrap in try/catch — a `SyntaxError` means invalid JSON; set an error message in local state and abort without calling `executeMock`. This satisfies AC#1.

2. **Seed**: `store.seed` is already a `number`. Pass it directly to `executeMock`; the wrapper converts to `BigInt` internally. The `<input type="number">` should call `setSeed(Number(e.target.value))`.

3. **Guard on supergraphSdl**: `supergraphSdl` is `string | null`. If null (no successful composition yet), the Run button should either be disabled or show an informative message; do not call `executeMock` with a null SDL.

4. **Result display**: Add local state `const [mockResult, setMockResult] = useState<MockResult | null>(null)` and `const [varError, setVarError] = useState<string | null>(null)`. On successful run, store the result and render `JSON.stringify(mockResult.data, null, 2)` in a `<pre>`.

5. **Errors array**: On success the Rust side returns `errors: []` (empty array, not absent). Check `(mockResult.errors?.length ?? 0) > 0` before rendering error messages.

6. **Determinism (AC#3)**: Same `supergraphSdl + query + variables + seed` always produces identical JSON. The `hash_path` function in `mock.rs` uses `DefaultHasher` seeded from the `seed` parameter — this is the source of determinism.

7. **Monaco height**: When the bottom section is split into columns, add explicit `height` props to each `<Editor>` to prevent collapse.

<!-- SECTION:NOTES:END -->
