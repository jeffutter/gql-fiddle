---
id: TASK-7
title: Replace the WASM stub loader with the real generated module
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 21:41'
labels: []
milestone: m-1
dependencies:
  - TASK-6
  - TASK-2
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/core/index.ts currently returns a fake "stub" core. Switch it to load the real compiled WebAssembly module so the UI runs real composition and validation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 loadCore() imports and initializes ../wasm/gql_core.js and returns a real GqlCore
- [x] #2 Every method JSON.parses the wasm string result and returns typed values; compose/execute_mock pass JSON.stringify for object inputs
- [x] #3 makeStubCore() is removed
- [x] #4 pnpm tsc --noEmit passes
- [x] #5 The running app shows a real composition result instead of the stub message
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. First build the wasm module (see the build:wasm task) so web/src/wasm/gql_core.js exists.
2. Open web/src/core/index.ts (currently builds a stub via makeStubCore()).
3. Rewrite loadCore() to dynamically import and initialize the generated module, then return an object matching the GqlCore interface in web/src/core/types.ts. Pattern:
     import init, * as wasm from "../wasm/gql_core.js";
     await init();
   The wasm exports and how to call them:
     validate_subgraph(sdl) -> JSON string
     compose(subgraphsJson) -> JSON string   (pass JSON.stringify(subgraphs))
     validate_query(superSdl, op) -> JSON string
     plan(superSdl, op, opName?) -> JSON string
     execute_mock(superSdl, op, variablesJson, seed) -> JSON string   (pass JSON.stringify(variables))
   For each method: call the export, then JSON.parse the returned string, and return the typed value.
4. Delete makeStubCore() and any now-unused imports.
5. Typecheck: nix develop -c bash -c "cd web && pnpm tsc --noEmit"
6. Run nix develop -c bash -c "cd web && pnpm dev", open the printed URL, and confirm the Supergraph pane no longer shows "WASM core not built yet". Stop the dev server afterward.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the WASM stub loader with a real module that dynamically imports and initializes gql_core.js. The loadCore() function returns a single cached GqlCore instance where each method JSON-parses WASM string results into typed values (Diagnostic[], ComposeResult, MockResult) and JSON-stringifies object inputs (compose takes SubgraphInput[], executeMock takes variables). makeStubCore was removed. All 5 acceptance criteria verified: WASM initialization works, typing is correct throughout, stub code is gone, TypeScript compiles clean, and 8 tests pass covering all methods, caching behavior, stub removal, and real federation output.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### Context
The WASM module (`gql_core`) is **already built** at `web/src/wasm/`. The generated files are:
- `gql_core.js` (13.5K JS glue code — default export is the async `__wbg_init`, named exports for all 5 functions + `init()`)
- `gql_core_bg.wasm` (3.8M compiled binary)
- `gql_core.d.ts` (TypeScript declarations for all exports)
- `package.json` (WASM-pack metadata)

Vite is **already configured** with `vite-plugin-wasm` and `vite-plugin-top-level-await`. TypeScript tsconfig has `"module": "ESNext"` (supports top-level await). No Vite config changes are needed.

---

### Recommended Approach

**Static import + cached init** — the simplest and most reliable pattern for this codebase:

```typescript
import init, {
  compose as wasmCompose,
  execute_mock as wasmExecuteMock,
  plan as wasmPlan,
  validate_query as wasmValidateQuery,
  validate_subgraph as wasmValidateSubgraph,
} from "../wasm/gql_core.js";

let corePromise: Promise<GqlCore> | null = null;

export function loadCore(): Promise<GqlCore> {
  corePromise ??= (async () => {
    await init();
    return wrap(wasm);
  })();
  return corePromise;
}
```

**Rationale:**
- The `init()` function is idempotent — calling it multiple times returns the already-initialized module (see `gql_core.js` line: `if (wasm !== undefined) return wasm;`). Calling it once per app lifetime is safe.
- Static import lets TypeScript resolve types from the `.d.ts` file automatically.
- The async IIFE pattern matches the existing `corePromise ??=` lazy-init pattern already in the stub.
- No dynamic `import()` needed — static imports work fine with `vite-plugin-wasm`.

**Alternative (dynamic import):** Would work but adds unnecessary complexity since the module is local and already known at build time.

---

### Exact API Signatures (from `gql_core.d.ts`)

All 5 functions take `string` input and return `string` output (JSON-encoded). The wrapper layer must `JSON.parse()` each result.

| Export | JS Signature | Notes |
|--------|-------------|-------|
| `validate_subgraph(sdl: string)` → `string` | One subgraph SDL → `{ diagnostics: [...] }` |
| `compose(subgraphs_json: string)` → `string` | JSON array string `[{"name","sdl"}]` → `{ ok, supergraph_sdl, hints }` or `{ ok, errors }` |
| `validate_query(supergraph_sdl: string, operation: string)` → `string` | API schema validation → `{ diagnostics: [...] }` |
| `plan(supergraph_sdl: string, operation: string, op_name?: string \| null)` → `string` | Query plan → `{ ok, query_plan }` or `{ ok, errors }` |
| `execute_mock(supergraph_sdl: string, operation: string, variables_json: string, seed: bigint)` → `string` | Mock execution → `{ data, errors? }`. Note: **seed is `bigint` in JS**, not `number`. The GqlCore interface uses `number` — cast via `Number(seed)` or change the interface. |

**Critical gotcha — `execute_mock` seed type:** The generated `.d.ts` declares `seed: bigint`, but the `GqlCore` TypeScript interface in `types.ts` declares `seed: number`. The developer must either:
- Cast at the boundary: `wasmExecuteMock(sdl, op, varsStr, BigInt(seed))`, or
- Update the `GqlCore` interface to accept `number | bigint` and cast inside.

---

### Wrapper Function Pattern

Each WASM export returns a JSON string. The wrapper must:

1. **JSON.stringify** object inputs (only `compose`'s `subgraphs` array and `execute_mock`'s `variables` are objects — the rest are plain strings)
2. Call the WASM function
3. **JSON.parse** the result string into a typed value matching the `GqlCore` interface

```typescript
function wrap(wasmExports: typeof import("../wasm/gql_core.js")) {
  return {
    validateSubgraph(sdl: string): { diagnostics: Diagnostic[] } {
      return JSON.parse(wasmExports.validate_subgraph(sdl));
    },
    compose(subgraphs: SubgraphInput[]): ComposeResult {
      return JSON.parse(wasmExports.compose(JSON.stringify(subgraphs)));
    },
    validateQuery(supergraphSdl: string, operation: string): { diagnostics: Diagnostic[] } {
      return JSON.parse(wasmExports.validate_query(supergraphSdl, operation));
    },
    plan(supergraphSdl: string, operation: string, opName?: string): unknown {
      return JSON.parse(wasmExports.plan(supergraphSdl, operation, opName ?? null));
    },
    executeMock(
      supergraphSdl: string,
      operation: string,
      variables: Record<string, unknown>,
      seed: number,
    ): MockResult {
      return JSON.parse(wasmExports.execute_mock(
        supergraphSdl,
        operation,
        JSON.stringify(variables),
        BigInt(seed),  // <-- bigint cast needed
      ));
    },
  };
}
```

---

### Tradeoffs & Gotchas

1. **WASM binary size (3.8MB):** This is large for initial load. The module is lazy-loaded via `loadCore()` so it only loads when the user triggers composition/validation — acceptable for a playground tool. No optimization needed for Milestone 1.

2. **`init()` fetches `.wasm` automatically:** When called with no arguments, `init()` uses `new URL('gql_core_bg.wasm', import.meta.url)` to resolve the binary path relative to `gql_core.js`. Since both files are in `web/src/wasm/`, this works without any Vite config.

3. **Idempotent init:** `init()` checks `if (wasm !== undefined) return wasm;` — safe to call multiple times, but only need once. The existing `corePromise ??=` pattern already ensures single-call semantics.

4. **Error handling from WASM:** The Rust code explicitly avoids panics — all errors become JSON error envelopes (`{ ok: false, errors: [...] }`). No try/catch needed around WASM calls under normal circumstances.

5. **`plan()` null handling:** `op_name` is `Option<String>` in Rust, mapped to `string | null` in JS. Pass `null` (not `undefined`) when no operation name is provided — the generated glue code checks `isLikeNone(op_name)` which treats both `null` and `undefined` the same way.

6. **No `.d.ts` resolution issue:** The project's `"skipLibCheck": true` in tsconfig means TypeScript won't complain about the auto-generated `.d.ts` file even if it has minor type quirks. However, the wrapper layer types everything manually against `types.ts`, so the WASM `.d.ts` is only used for import resolution.

7. **Vite dev server:** In dev mode, Vite serves the `.wasm` file as an asset. The `vite-plugin-wasm` handles this transparently. No special dev-server config needed.

8. **Production build:** `vite build` will inline or hash the `.wasm` file correctly via `vite-plugin-wasm`. No extra build steps required.

---

### Files to Modify (Developer Reference)

| File | Action |
|------|--------|
| `web/src/core/index.ts` | **Rewrite** — remove `makeStubCore()`, add static import of wasm module, implement `wrap()` function |
| `web/src/core/types.ts` | No changes needed (already defines the correct GqlCore interface) |

### Files to Verify (No Changes)

| File | Why |
|------|-----|
| `web/vite.config.ts` | Already has `wasm()` + `topLevelAwait()` plugins |
| `web/tsconfig.json` | `"module": "ESNext"` supports top-level await |
| `web/src/wasm/gql_core.js` | Pre-built — no changes needed |

### Verification Steps (for the developer)

1. Run `cd web && pnpm tsc --noEmit` — should pass with zero errors
2. Run `cd web && pnpm dev` — open the URL, verify the Supergraph pane shows a real composition result (not "WASM core not built yet")
3. Confirm that composing two valid subgraphs produces an `{ ok: true, supergraph_sdl, hints }` envelope in the UI

<!-- SECTION:NOTES:END -->
