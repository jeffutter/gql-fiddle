---
id: TASK-96.1
title: Extract useMonacoGraphQL() hook from App.tsx
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-02 15:14'
labels:
  - review
  - planned
dependencies:
  - TASK-113
parent_task_id: TASK-96
priority: low
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pull the MonacoEnvironment worker wiring (web/src/App.tsx ~167-178), the monacoGraphQLAPI singleton init/config (~56, ~647-672), schema registration on compose, and the YAML completion provider registration/disposal (~811-973) into a useMonacoGraphQL() hook. Removes ~200 lines and contains the singleton lifetime in one place.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 all monaco-graphql wiring lives in the hook
- [x] #2 App.tsx no longer references the module-scope singleton directly
- [x] #3 behavior is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Sequencing: this ticket depends on TASK-113 (Monaco singleton double-init / stale-schema-on-failure / vim-on-conditional-editors fix). TASK-113 touches the exact same singleton lifecycle code this ticket relocates. Do not start until TASK-113 is Done, per the parent TASK-96 ticket's explicit note to fix bugs before moving the code — otherwise the bug fix has to be re-targeted at the new hook file anyway with no savings. Both tickets touch the same ~15 lines around monacoGraphQLAPI init, so serializing them avoids rework and merge risk.

Current state (web/src/App.tsx, verified by line number):
- L5,7,8,9: imports used only by this code — `loader` (@monaco-editor/react), `GraphQLWorker` (monaco-graphql/esm/graphql.worker?worker), `initializeMode` (monaco-graphql/initializeMode), `MonacoGraphQLAPI` type (monaco-graphql). None are referenced anywhere else in App.tsx.
- L36: `import { buildSchema, getNamedType, isInterfaceType, isObjectType, isUnionType } from "graphql"` — used only inside the mock-config field-key derivation effect (L819-861) that this ticket moves; safe to remove from App.tsx entirely.
- L59: `let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;` — module-scope singleton.
- L204-224: MonacoEnvironment worker override + `loader.config({monaco:_monaco})` + dev-only `window.__monaco` exposure. This is module-scope code (runs once at import time, before the App component exists), not component code — verified it does not depend on any React state.
- L339-341: `mockConfigFieldKeysRef` / `mockConfigConcreteTypesRef` — used only inside the two effects below.
- L693-725: debounced compose effect. Inside the `result.ok` branch (~L700-716) it lazily inits the singleton and calls `setModeConfiguration` + `setSchemaConfig`. The rest of this effect (calling `core.compose`, `setComposeResult`, `setCompose`) is pipeline logic out of scope for this ticket (belongs to TASK-96.2's useGraphQLPipeline) — leave it in App.tsx, just replace the Monaco-specific lines with a call into the new hook.
- L819-861: effect keyed on `compose` that derives `mockConfigFieldKeysRef`/`mockConfigConcreteTypesRef` via `buildSchema(compose.api_schema_sdl)` for mock-config YAML completions.
- L863-1026: mount-only effect (`[]` deps) that registers `_monaco.languages.registerCompletionItemProvider("yaml", ...)` for mock-config.yaml completions, reading the two refs above, and disposes the provider on unmount.

Implementation:

1. Create web/src/useMonacoGraphQL.ts:
   - Move imports: `useEffect, useRef, useCallback` from "react"; `* as _monaco` from "monaco-editor"; `GraphQLWorker` default from "monaco-graphql/esm/graphql.worker?worker"; `initializeMode` from "monaco-graphql/initializeMode"; `type MonacoGraphQLAPI` from "monaco-graphql"; `loader` from "@monaco-editor/react"; `buildSchema, getNamedType, isInterfaceType, isObjectType, isUnionType` from "graphql"; `type ComposeResult` from "./core/types".
   - At module scope (top of file, executes once on first import — same timing as today since App.tsx will import this module): move the MonacoEnvironment override block, `loader.config(...)` call, and the dev-only `window.__monaco` exposure verbatim from App.tsx L204-224. Move `let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;` here too.
   - Export `function useMonacoGraphQL(compose: ComposeResult | null): { registerSchema: (apiSchemaSdl: string) => void }`:
     - `const mockConfigFieldKeysRef = useRef<string[]>([]);` and `const mockConfigConcreteTypesRef = useRef<Record<string, string[]>>({});` (moved from App.tsx L339-341).
     - `const registerSchema = useCallback((apiSchemaSdl: string) => { ... }, []);` — body is the L700-716 singleton lazy-init + `setModeConfiguration` + `setSchemaConfig` calls verbatim, taking `apiSchemaSdl` as the parameter instead of reading `result.api_schema_sdl` from a closure. MUST use `useCallback` with an empty dependency array (the body only touches the module-scope singleton, no props/state) — this keeps `registerSchema`'s identity stable across renders. Skipping this would break App.tsx's compose-debounce effect: adding a non-memoized function to that effect's dependency array would make it re-run on every render instead of only when `subgraphs` changes, silently breaking the 300ms debounce.
     - Move the L819-861 effect verbatim (dependency array `[compose]`), using the two refs declared above.
     - Move the L863-1026 effect verbatim (dependency array `[]`, returns `() => provider.dispose()`), using the two refs declared above.
     - `return { registerSchema };`

2. Edit web/src/App.tsx:
   - Remove the imports listed above (L5, 7, 8, 9, 36) that are no longer used in this file.
   - Add `import { useMonacoGraphQL } from "./useMonacoGraphQL";` alongside the other local imports.
   - Remove L59 (`let monacoGraphQLAPI...`).
   - Remove the MonacoEnvironment block L204-224 in its entirety.
   - Remove the two ref declarations at L339-341.
   - Inside `App()`, after the `const [compose, setCompose] = useState<ComposeResult | null>(null);` declaration, add: `const { registerSchema } = useMonacoGraphQL(compose);`
   - In the debounced compose effect (currently L693-725), replace the singleton-init + `setModeConfiguration` + `setSchemaConfig` block (L700-716) with a single call: `registerSchema(result.api_schema_sdl);`. Add `registerSchema` to this effect's dependency array: `}, [subgraphs, registerSchema]);` (safe because `registerSchema` is now a stable `useCallback` reference).
   - Remove the two effects that move to the hook (L819-861 and L863-1026) in their entirety.

3. Verification:
   - `pnpm --dir web exec tsc --noEmit` (or the project's standard typecheck command — check web/package.json / AGENTS.md) to confirm no dangling references (e.g., confirm nothing else in App.tsx used the removed imports or refs).
   - `pnpm --dir web lint` — confirms `react-hooks/exhaustive-deps` is satisfied for the updated compose effect and for the new hook's internal effects.
   - `pnpm --dir web test -- App.test.tsx` (or project's standard test command) — the existing tests already exercise this code path end-to-end without needing changes: "AC#1: calls setModeConfiguration with all features enabled after successful compose", "AC#3: calls setSchemaConfig with api_schema_sdl from the composed result", "AC#3: does not call setSchemaConfig when compose fails", "AC#4: editing a subgraph triggers re-composition and calls setSchemaConfig with the new api_schema_sdl" must all continue to pass unmodified — they mock `monaco-graphql/initializeMode` at the module path, which still applies regardless of which file imports it. This is the primary evidence that behavior (AC#3) is unchanged.
   - Manually grep App.tsx afterward for `monacoGraphQLAPI` — should return zero matches, confirming AC#2.
   - Run the full web test suite once to catch any incidental regressions from the import/effect reshuffle.

No new sub-tickets: this is a single, tightly-coupled mechanical extraction (one new file + corresponding removals in one existing file) that should ship as one change; splitting it further would only fragment a single coherent hook.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Blocked: this ticket depends on TASK-113 (Monaco singleton double-init / stale-schema-on-failure / vim-on-conditional-editors fix), which is still To Do. The implementation plan explicitly requires TASK-113 to be Done first since it touches the exact same singleton lifecycle code (~L56, ~647-672) that this ticket relocates into the new hook. Starting now would mean re-targeting TASK-113's fix at the new hook file with no savings and added merge risk. Reverting to To Do; re-run once TASK-113 is Done.

Created web/src/useMonacoGraphQL.ts and moved into it:
- Module-scope MonacoEnvironment worker override, loader.config(), dev-only
  window.__monaco exposure, and the monacoGraphQLAPI singleton declaration
  (these run once on first import of the hook module, same timing as before
  since App.tsx imports the hook).
- useMonacoGraphQL(compose) hook exposing a stable (useCallback, []) registerSchema(apiSchemaSdl: string | null):
  - non-null: lazily inits the singleton, calls setModeConfiguration + setSchemaConfig (the success path).
  - null: calls setSchemaConfig([]) to deregister a stale schema (the TASK-113 failure-clearing path).
  This single function replaces both call sites that used to inline the singleton logic in the
  debounced compose effect.
- mockConfigFieldKeysRef/mockConfigConcreteTypesRef and the two effects that
  derive them from compose.api_schema_sdl and register the mock-config.yaml
  completion provider, moved verbatim.

App.tsx changes:
- Removed now-unused imports (loader, GraphQLWorker, initializeMode, MonacoGraphQLAPI type,
  buildSchema/getNamedType/isInterfaceType/isObjectType/isUnionType from graphql).
- Removed the module-scope monacoGraphQLAPI singleton and MonacoEnvironment block.
- Removed the two ref declarations and the two effects moved into the hook.
- Added `const { registerSchema } = useMonacoGraphQL(compose);` and replaced the inline
  singleton-init/setSchemaConfig calls in the debounced compose effect with
  registerSchema(result.api_schema_sdl) / registerSchema(null); added registerSchema to
  that effect's dependency array (safe since it's a stable useCallback reference).

Note: the ticket's original plan (written pre-TASK-113) described a simpler registerSchema(sdl: string)
success-only API. TASK-113 had since added a failure-path setSchemaConfig([]) call plus a
composeGenerationRef concurrency guard around the whole effect. Adapted registerSchema to accept
`string | null` (null = clear) so both the success and failure paths funnel through one function,
and left the generation-guard logic in App.tsx's compose effect untouched (it's pipeline concurrency
control, not monaco-graphql wiring, so out of scope for this ticket per the plan's own scoping notes).

Verification: `pnpm --dir web exec tsc --noEmit` clean; `pnpm --dir web exec eslint src/App.tsx src/useMonacoGraphQL.ts`
shows zero new warnings (the two pre-existing react-hooks/exhaustive-deps warnings on unrelated effects
are unchanged, confirmed via git stash diff); full `pnpm --dir web exec vitest run` — 406/406 tests pass,
including all TASK-113 AC tests and the App.test.tsx AC#1/AC#3/AC#4 monaco-graphql tests, unmodified.
grep -c "monacoGraphQLAPI" App.tsx returns 0 (AC#2). App.tsx: 2161 -> 1904 lines.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted all monaco-graphql wiring (MonacoEnvironment worker override, the monacoGraphQLAPI singleton, schema registration on compose success/failure, and the mock-config.yaml completion provider) from App.tsx into a new useMonacoGraphQL(compose) hook, cutting App.tsx by ~257 lines. App.tsx now interacts with monaco-graphql only via a single stable registerSchema(sdl | null) call from the hook; no other behavior changed (406/406 tests pass, tsc/eslint clean).
<!-- SECTION:FINAL_SUMMARY:END -->
