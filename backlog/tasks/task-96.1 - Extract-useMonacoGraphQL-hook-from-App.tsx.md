---
id: TASK-96.1
title: Extract useMonacoGraphQL() hook from App.tsx
status: To Do
assignee: []
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 20:32'
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
- [ ] #1 all monaco-graphql wiring lives in the hook
- [ ] #2 App.tsx no longer references the module-scope singleton directly
- [ ] #3 behavior is unchanged
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
<!-- SECTION:NOTES:END -->
