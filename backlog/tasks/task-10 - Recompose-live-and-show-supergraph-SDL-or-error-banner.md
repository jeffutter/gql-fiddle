---
id: TASK-10
title: Recompose live and show supergraph SDL or error banner
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-08 14:02'
labels: []
milestone: m-1
dependencies:
  - TASK-7
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Whenever any subgraph changes, recompose all subgraphs and show either the composed supergraph SDL (read-only) or a clear list of composition errors. Store the result so later panes can use it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Editing a subgraph recomposes within ~300ms
- [x] #2 A successful compose shows the supergraph SDL and an errors/hints count
- [x] #3 A failing compose shows an error banner with each code and message
- [x] #4 The latest successful supergraph SDL is stored in the workspace store
- [x] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

The Rust side is complete (TASK-7 delivered the real WASM loader; compose.rs calls apollo-federation 2.15). All work for this task is frontend-only: debounce the compose effect, persist results in Zustand, render hints count and a styled error banner.

1. Add compose result fields to the workspace store (web/src/store.ts). Append these to the WorkspaceState interface:
   - supergraphSdl: string | null          (latest successful SDL)
   - composeErrors: CompositionError[] | null  (errors from last failed compose)
   - composeHints: number                   (hint count from last compose, 0 if none)
   Set initial values: supergraphSdl: null, composeErrors: null, composeHints: 0.
   Add a setter action to the store:
     setComposeResult: (sdl: string | null, errors: CompositionError[] | null, hintCount: number) => void

2. In App.tsx, replace the existing compose useEffect (approximately line 44 — it reads `loadCore().then(...)`) with a debounced version using the same setTimeout/clearTimeout ref pattern as the validation effect below it. Add a second ref alongside the existing timeoutRef:
   ```typescript
   const composeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   ```
   In the effect body, clear any pending timeout, then schedule after 300ms:
   ```typescript
   useEffect(() => {
     if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
     composeTimeoutRef.current = setTimeout(async () => {
       const core = await loadCore();
       const result = core.compose(subgraphs);
       // persist to store and local state — see step 3
     }, 300);
     return () => { if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current); };
   }, [subgraphs]);
   ```
   Note: loadCore() is memoized (corePromise ??= in core/index.ts), so the WASM init cost is paid only once. Subsequent calls are near-instant; 300ms debounce covers typing latency, not WASM boot time.

3. Inside the debounced callback from step 2, update both the store and local state based on the result:
   - If result.ok (success): call setComposeResult(result.supergraph_sdl, null, result.hints.length). Also call setCompose(result) for local UI state.
   - If not result.ok (failure): call setComposeResult(null, result.errors, 0). Call setCompose(result) for local UI state. The store's supergraphSdl keeps whatever value was set by the previous success — this preserves the "stale supergraph" so the last good SDL stays visible when composition fails.
   Then read compose fields from the store using the existing useWorkspace hook selector (add supergraphSdl, composeErrors, composeHints to the destructuring on the current hook call). This ensures later panes can access the persisted results independently of App.tsx's local state.

4. Update the Supergraph pane rendering (currently a single <pre> inside a <div>):
   a. On success (compose.ok === true): show compose.supergraph_sdl in the <pre> as-is. Below it, add a small status line reading "Composition: 0 errors" when hints.length is 0, or "Composition: 0 errors, N hints" when N > 0.
   b. On failure (compose.ok === false): render an error banner div above the <pre> — styled with red-ish background (e.g., style={{ backgroundColor: "#fee2e2", borderLeft: "3px solid #dc2626", padding: 8, borderRadius: 4 }}) containing one monospace line per error in format "{error.code}: {error.message}". The <pre> below should show the stale supergraphSdl from the store (useWorkspace().supergraphSdl), or "No valid composition yet" if that is null.

5. Verify against each acceptance criterion:
   - AC#1 (~300ms recomposition): In dev tools, confirm rapid typing triggers at most one core.compose() call per 300ms window. (The debounce ref clears the timer before scheduling a new one.)
   - AC#2 (SDL + hints count): Edit a valid subgraph SDL, wait 300ms, confirm the Supergraph pane shows composed SDL text AND a "Composition: ..." status line with hint count.
   - AC#3 (error banner with code and message per line): Break composition by editing a subgraph to produce a conflict (e.g., remove a required @key directive or change a shared type). Wait 300ms. Confirm a styled error banner appears with one "CODE: message" line per error.
   - AC#4 (store persistence): After composing successfully, call useWorkspace() in the React dev tools console (or add a debug log) and confirm supergraphSdl is non-null, composeErrors is null, and composeHints reflects the hint count. Then break the composition and confirm supergraphSdl is preserved.
   - AC#5 (typecheck + lint): Run `nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint"` and confirm clean output.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented debounced live recomposition with 300ms delay on subgraph edits, persisted compose results (supergraph SDL, errors, hint count) to the Zustand workspace store for cross-pane access, and rendered a styled error banner with code:message lines on failure while preserving stale SDL from prior successful compositions. Added 5 new App tests covering debounce behavior, success/failure rendering, and stale SDL fallback plus 4 store tests for compose result persistence; all TypeScript checks and linting pass cleanly.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research: Live Recomposition & Supergraph SDL / Error Banner (TASK-10)

## Summary
The Rust WASM core (`compose::compose` in `crates/gql-core/src/compose.rs`) is already wired to `apollo-federation 2.15` and returns JSON envelopes matching the contract `{ok: true, supergraph_sdl, hints}` or `{ok: false, errors: [{code, message, locations?}]}`. The current `App.tsx` has a basic composition effect but lacks debouncing (AC#1), hints display (AC#2), styled error banner (AC#3), and store persistence of the compose result (AC#4). The implementation is purely frontend work: add debounce to the compose effect, persist results in Zustand, render a styled error banner with code/message per line, and show hint counts.

## Findings

### 1. Composition API — already implemented and correct
The `compose::compose` function in `crates/gql-core/src/compose.rs` calls `apollo_federation::composition::compose(fed_subgraphs, CompositionOptions::default())`. It correctly maps:
- **Success path**: `{ ok: true, supergraph_sdl: String, hints: [CompositionHint] }` where each hint has `code` and `message`.
- **Error path**: `{ ok: false, errors: [{ code, message, locations }] }` with ~40 error variants mapped via `error_code()`, including `FIELD_TYPE_MISMATCH`, `EXTENSION_WITH_NO_BASE`, `SATISFIABILITY_ERROR`, `INTERFACE_OBJECT_USAGE_ERROR`, etc. Parse failures return `"INVALID_SUBGRAPH"`.

The TypeScript types in `web/src/core/types.ts` (`ComposeResult`, `CompositionHint`, `CompositionError`) match the JSON contract exactly. The WASM boundary wrapper in `web/src/core/index.ts` serializes/deserializes via JSON correctly. **No changes needed on the core side.** [Source: `crates/gql-core/src/compose.rs`, `web/src/core/types.ts`]

### 2. Debounce for ~300ms recomposition (AC#1)
The current `App.tsx` has a compose effect that fires immediately on every subgraph change (no debounce). The validation effect already has a 300ms debounce — the compose effect should follow the same pattern:

**Recommended approach**: Extract a shared `useDebouncedCallback` hook or use `setTimeout`/`clearTimeout` with a ref (same pattern as the existing validation effect):

```typescript
const composeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
  composeTimeoutRef.current = setTimeout(async () => {
    const core = await loadCore();
    setCompose(core.compose(subgraphs));
  }, 300);
  return () => { if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current); };
}, [subgraphs]);
```

**Gotcha**: The `loadCore()` promise is memoized in `core/index.ts` (`corePromise ??=`), so subsequent calls are near-instant. Only the first call pays the WASM init cost (~100-300ms). Debouncing after the first composition is essentially free. [Source: `web/src/core/index.ts`]

### 3. Hints display (AC#2)
The success envelope includes a `hints` array with `{code, message}` entries. The current UI ignores hints entirely. Display format should be a small line like `"Composition: 0 errors, N hints"` or `"Composition: 0 errors"` when hints is empty.

**API detail**: Hints come from `supergraph.hints()` in the Rust code — they are non-blocking composition advisories (e.g., unused subgraph fields). They do not prevent supergraph generation. [Source: `crates/gql-core/src/compose.rs`, `apollo-federation 2.15 docs`]

### 4. Styled error banner (AC#3)
The current UI renders errors as a plain `<pre>` with `"CODE: message"` lines. The acceptance criterion says "clearly styled error banner." Recommended approach:

- Render an error banner component (e.g., a `<div>` with red background, monospace text for codes) that appears when `compose.ok === false`.
- Each error line: `{code}: {message}` — the Rust code already extracts both fields.
- Optionally show location info (`locations[]` with subgraph/line/col) if present, but the AC only asks for code and message per line.

**No external library needed** — a styled div is sufficient. If the project uses Tailwind or a UI framework, leverage its alert/banner component.

### 5. Store persistence of compose result (AC#4)
The workspace store (`web/src/store.ts`) currently has no fields for compose results. Need to add:

```typescript
export interface WorkspaceState {
  // ... existing fields ...
  supergraphSdl: string | null;    // latest successful supergraph SDL
  composeErrors: CompositionError[] | null;
  composeHints: number;             // count of hints on last composition
}
```

Add actions or a reducer pattern to update these when composition succeeds/fails. The `supergraphSdl` should be set on success (from `composeResult.supergraph_sdl`) and preserved on failure ("stale supergraph" behavior mentioned in the implementation plan). The store's `composeErrors` should be set on failure.

**Gotcha**: The store is Zustand-based with simple setters. Adding new fields requires:
1. Updating the `WorkspaceState` interface
2. Setting initial values in `initialSubgraphs` block (e.g., `supergraphSdl: null, composeErrors: null, composeHints: 0`)
3. Updating the compose effect to dispatch store updates alongside `setCompose`

### 6. TypeScript / Lint compliance (AC#5)
The project uses ESLint (`eslint.config.js`) and TypeScript strict mode (`tsconfig`). The existing code already passes these checks. Key lint considerations for this task:
- Avoid `any` types — use `CompositionError[]` from the typed interface.
- React hooks must include all dependencies in `useEffect` dependency arrays (the current compose effect has `[subgraphs]` which is correct).
- No unused imports after adding banner components.

**Recommendation**: Run `pnpm tsc --noEmit && pnpm lint` immediately after changes to catch issues early. The project's lefthook pre-commit already runs these checks. [Source: `lefthook.yml`, `web/tsconfig.json`]

## Tradeoffs

| Decision | Option A (recommended) | Option B |
|----------|----------------------|----------|
| Debounce implementation | `setTimeout`/`clearTimeout` ref pattern (matches existing validation effect) | Extract a custom `useDebouncedCallback` hook |
| Error banner styling | Inline styled div with red background + monospace codes | Import from a UI library (e.g., shadcn, Radix) |
| Store persistence | Add fields directly to Zustand store | Use a separate `composeResult` slice/store |
| Hints display | Count-only line ("0 errors, 2 hints") | Expandable hint list with code + message |

Option A is preferred for all decisions because it matches existing patterns in the codebase and keeps the scope minimal.

## Gotchas

1. **WASM init is async**: `loadCore()` returns a promise that initializes the WASM module on first call. The compose effect must `await loadCore()`. The current code does this correctly but the debounced version must also await it.

2. **Store update ordering**: When composition fails, set both the error banner state AND persist the last good supergraph SDL in the store. Don't clear `supergraphSdl` on failure — keep the "stale" value visible per the implementation plan.

3. **Subgraphs comparison**: The compose effect depends on `[subgraphs]` which is a new array reference on every `setSubgraphSdl`. This is correct behavior (triggers recomposition) but means the debounce is essential to avoid excessive WASM calls during rapid typing.

4. **Apollo-federation version pinning**: The implementation plan pins `apollo-federation = "=2.15.0"`. The error code mapping in `compose.rs` covers ~40 variants. New Apollo releases may add new error types not covered by the match — this is handled gracefully (the match is exhaustive for known variants, and any unhandled variant would be a compile error). [Source: `crates/gql-core/Cargo.toml`, implementation plan §4]

## Sources

- **Kept**: `crates/gql-core/src/compose.rs` — the actual composition implementation with all error code mappings; source of truth for the JSON envelope shape
- **Kept**: `web/src/core/types.ts` — TypeScript types mirroring the Rust JSON boundary (`ComposeResult`, `CompositionError`, `CompositionHint`)
- **Kept**: `web/src/core/index.ts` — WASM loader wrapper with typed I/O; confirms `compose()` signature and JSON serialization
- **Kept**: `web/src/store.ts` — current Zustand store; baseline for adding compose result fields
- **Kept**: `web/src/App.tsx` — current UI with basic composition effect; starting point for changes
- **Kept**: Implementation Plan doc-2 §3 (WASM API contract) and §5 (Milestone 1 tasks) — confirms the JSON envelope contract and stale-supergraph behavior
- **Dropped**: Apollo Federation v2.14 changelog — relevant context but not directly used by this task (project pins 2.15)
- **Dropped**: `@apollo/composition` JS package — project uses Rust WASM, not the JS library

## Gaps

1. **Monaco read-only mode for supergraph pane**: The implementation plan mentions "read-only Monaco or a `<pre>`". The current UI uses `<pre>`. If switching to Monaco read-only, need `monaco-graphql` schema registration for autocomplete on the query pane — this is deferred to Milestone 2.

2. **Composition performance benchmarking**: AC#1 says "~300ms" but no baseline measurement exists. The WASM init cost (~100-300ms first call) dominates; subsequent compositions should be <50ms for small schemas. Recommend measuring with `performance.now()` during development.

3. **Error location display**: The Rust code returns `locations: [{subgraph, line, col}]` for many error types. AC#3 only asks for "code and message" but the location data is available if desired as an enhancement.

4. **Store serialization for sharing (Milestone 4)**: Adding `supergraphSdl` to the store will affect URL serialization in Milestone 4 — this is a forward-looking concern, not blocking AC#4.

<!-- SECTION:NOTES:END -->
