---
id: TASK-96.2
title: Extract useGraphQLPipeline() hook from App.tsx
status: Blocked
assignee: []
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 21:01'
labels:
  - review
  - planned
dependencies:
  - TASK-112
  - TASK-96.1
parent_task_id: TASK-96
priority: low
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pull the debounced compose, subgraph-validate, query-validate and auto-run effects plus doRun/runQuery/parseYamlToJson (web/src/App.tsx ~637-764, ~696-709, ~1129-1164) into a useGraphQLPipeline() hook returning {compose, planResult, mockResult, isRunning, runQuery}. Makes the debounce/race relationships reviewable in ~150 lines.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the core compose/validate/plan/run effects live in one hook
- [ ] #2 App.tsx consumes the hook's return value
- [ ] #3 behavior is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Sequencing: this ticket depends on TASK-112 (Fix auto-run ignoring Mock Config edits) and TASK-96.1 (Extract useMonacoGraphQL() hook from App.tsx). TASK-112 fixes the exact auto-run effect this ticket relocates (adding `mockConfig` to its dependency array) — do the fix in App.tsx first so it isn't lost/re-targeted at the new hook file. TASK-96.1 extracts the monaco-graphql singleton wiring that currently lives inline inside the same debounced-compose effect this ticket relocates; landing it first means the compose effect this ticket moves already calls the clean `registerSchema(apiSchemaSdl)` entry point instead of touching `monacoGraphQLAPI`/`initializeMode` directly, so the new pipeline hook never needs to import monaco-graphql internals. Do not start until both are Done.

Current state (web/src/App.tsx, verified by line number as of this planning pass — line numbers will shift once TASK-112/TASK-96.1 land; re-verify at execution time, structure described below is what matters):
- L61-62: `COMPOSE_DEBOUNCE_MS = 300`, `AUTO_RUN_DEBOUNCE_MS = 400` — used only by the two effects below; move both constants.
- L226-241: `diagnosticToMarker(diagnostic, monacoInstance)` — module-scope helper used only by the two validation effects below (not imported by App.test.tsx); move verbatim as a private (non-exported) helper.
- L288: `const [compose, setCompose] = useState<ComposeResult | null>(null);` — moves into the hook. NOTE: `compose` is also read directly in App.tsx JSX (composition error/success panel, ~L1387-1410) and in `copyForLLM()` (~L1065-1070), and is passed to `useMonacoGraphQL(compose)` once TASK-96.1 lands — all three call sites consume the hook's returned `compose`, no behavior change needed there beyond swapping the source of the variable.
- L297-298: `mockResult`/`planResult` state — move into the hook. Both are also read elsewhere in App.tsx (`planResult` by the field-attribution decoration effect ~L487-502; `mockResult`/`compose` by `copyForLLM()` ~L1074-1084) — those call sites stay in App.tsx unchanged, just consuming the hook's return value instead of local state.
- L300: `const [configError, setConfigError] = useState<string | null>(null);` — set only inside `parseYamlToJson` (which moves), but rendered in App.tsx JSX at ~L1555-1557 ("Mock Config YAML error" banner). The ticket description's hook signature (`{compose, planResult, mockResult, isRunning, runQuery}`) omits this — it must be added to the hook's return (`configError`) or the error banner silently stops updating. Treat this as a required correction to the description, not optional.
- L315: `const [isRunning, setIsRunning] = useState(false);` — moves; read at ~L1586 and ~L2467 (spinner) — those stay in App.tsx.
- L336-337, L690: `timeoutRef`, `queryTimeoutRef`, `autoRunTimeoutRef`, `composeTimeoutRef` — all four debounce-timer refs move; none are referenced outside the four effects below.
- L692-725: debounced compose effect (`[subgraphs]` deps) — calls `core.compose(subgraphs)`, `useWorkspace.getState().setComposeResult(...)`, and (until TASK-96.1 lands) the inline monaco-graphql singleton init — moves whole, minus the monaco-specific lines which TASK-96.1 will already have replaced with a `registerSchema(result.api_schema_sdl)` call by the time this ticket executes.
- L749-762: auto-run effect — currently `[currentQuery, supergraphSdl, seed]`; TASK-112 will have added `mockConfig` to this array by the time this ticket executes. Moves whole, including the corrected deps array.
- L764-791: debounced subgraph-validate effect (`[editor, monacoInstance, activeSubgraph, subgraphs]`) — moves whole.
- L793-817: debounced query-validate effect (`[monacoInstance, supergraphSdl, currentQuery, activeQueryTab]`) — moves whole.
- L1187-1198: `parseYamlToJson(yaml)` — moves; only caller is `doRun`.
- L1200-1210: `doRun(query, sdl, s)` — moves; reads `mockConfig` via closure (this is exactly what TASK-112 fixes at the call-site dependency array, not inside `doRun` itself).
- L1212-1217: `runQuery()` — moves; only external use is the Run button's `onClick` (~L1583) and a disabled-state check (`supergraphSdl === null`).
- Imports used only by the moved code, safe to drop from App.tsx entirely: `jsYaml` (L35, only used at L1190), and the four named types on L17 — `ComposeResult`, `Diagnostic`, `MockResult`, `PlanResult` (keep `GqlCore`, still used by the unrelated `coreInstance` state at L290).

Implementation:

1. Create web/src/useGraphQLPipeline.ts:
   - Imports: `useEffect, useRef, useState` from "react"; `* as _monaco` from "monaco-editor" (for `editor`/`monacoInstance` param types and `IMarkerData`); `loadCore` from "./core"; `type { ComposeResult, Diagnostic, MockResult, PlanResult, SubgraphInput }` from "./core/types"; `useWorkspace` from "./store"; `* as jsYaml` from "js-yaml".
   - Move `COMPOSE_DEBOUNCE_MS` / `AUTO_RUN_DEBOUNCE_MS` constants and the `diagnosticToMarker` helper verbatim (module scope, not exported).
   - Export `function useGraphQLPipeline(params: { subgraphs: SubgraphInput[]; activeSubgraph: number; supergraphSdl: string | null; currentQuery: string; seed: number; mockConfig: string; editor: _monaco.editor.IStandaloneCodeEditor | null; monacoInstance: typeof _monaco | null; activeWorkspaceIndex: number; activeQueryTab: number; }): { compose: ComposeResult | null; planResult: PlanResult | null; mockResult: MockResult | null; isRunning: boolean; configError: string | null; runQuery: () => void }`.
     - Destructure params inside the hook body (mirrors how App.tsx currently reads these from `activeWs`/`useWorkspace()`).
     - Declare `compose`, `mockResult`, `planResult`, `isRunning`, `configError` state and the four timer refs exactly as today.
     - Move the four effects verbatim (compose, auto-run, subgraph-validate, query-validate), preserving their exact dependency arrays (post TASK-112/96.1 fixes).
     - Move `parseYamlToJson`, `doRun`, `runQuery` verbatim as plain inner functions (not `useCallback` — they are recreated every render today too; preserve that, don't introduce memoization as an unplanned behavior change).
     - `return { compose, planResult, mockResult, isRunning, configError, runQuery };`
   - Do NOT import anything from monaco-graphql or reference the `monacoGraphQLAPI` singleton — by execution time (post TASK-96.1) the compose effect only calls `registerSchema(result.api_schema_sdl)`, so `registerSchema: (apiSchemaSdl: string) => void` must be accepted as an additional param and threaded into the compose effect's body and dependency array (`[subgraphs, registerSchema]`). Re-verify the exact post-96.1 compose-effect shape in App.tsx before writing this file, since 96.1 replaces lines 700-716 with that single call.

2. Edit web/src/App.tsx:
   - Remove the imports/consts/helper listed above (jsYaml; `ComposeResult`/`Diagnostic`/`MockResult`/`PlanResult` from the L17 type import, keeping `GqlCore`; `COMPOSE_DEBOUNCE_MS`/`AUTO_RUN_DEBOUNCE_MS`; `diagnosticToMarker`).
   - Add `import { useGraphQLPipeline } from "./useGraphQLPipeline";`.
   - Remove the `compose`/`mockResult`/`planResult`/`isRunning`/`configError` state declarations and the four timer refs.
   - Remove the four effects (compose, auto-run, subgraph-validate, query-validate) and `parseYamlToJson`/`doRun`/`runQuery` in their entirety.
   - Wire the two hooks together. Because `useGraphQLPipeline` needs `registerSchema` (produced by `useMonacoGraphQL`, which in turn needs `compose`, produced by `useGraphQLPipeline`) there is a two-way value dependency between the hooks in the same render. Resolve it by NOT threading `registerSchema` into the pipeline's compose effect as a call-time value dependency at the App.tsx wiring layer — instead call the pipeline hook first to get `compose`, call `useMonacoGraphQL(compose)` second to get `registerSchema`, and bridge them with one small effect that reacts to `compose` rather than passing `registerSchema` into the pipeline hook itself:
     ```
     const { compose, planResult, mockResult, isRunning, configError, runQuery } = useGraphQLPipeline({
       subgraphs, activeSubgraph, supergraphSdl, currentQuery, seed, mockConfig,
       editor, monacoInstance, activeWorkspaceIndex, activeQueryTab,
     });
     const { registerSchema } = useMonacoGraphQL(compose);
     useEffect(() => {
       if (compose?.ok) registerSchema(compose.api_schema_sdl);
     }, [compose, registerSchema]);
     ```
     This is a deliberate deviation from a purely mechanical move: it keeps `useGraphQLPipeline` fully decoupled from Monaco (matching the ticket's stated return shape exactly, no extra `registerSchema` param) at the cost of registering the schema one effect-tick after `compose` updates instead of synchronously inside the debounce callback — not observable to users or to TASK-96.1's tests (they already `waitFor`/await the debounce). Do not use a ref-based "call registerSchema synchronously from inside the pipeline's compose effect" trick — it works but is substantially harder to reason about for no behavioral benefit.
     If TASK-96.1 has not actually landed with a `registerSchema` return by execution time (re-check its status), stop and flag it — do not reimplement Monaco wiring here.

3. Verification:
   - `pnpm --dir web exec tsc --noEmit` — confirms no dangling references to removed state/imports.
   - `pnpm --dir web lint` — confirms `react-hooks/exhaustive-deps` is satisfied for all four moved effects and the new bridging effect.
   - `pnpm --dir web test run App.test.tsx` — must pass unmodified. In particular the debounce tests ("debounces validation so rapid keystrokes trigger only one validateSubgraph call", "debounces composition so rapid subgraph edits trigger at most one compose call"), the stale-badge tests, and any auto-run/mock-config test added by TASK-112 must all still pass — they exercise this code path through the rendered `App` component regardless of which file the logic lives in.
   - Manually grep App.tsx afterward for `doRun`, `runQuery`, `parseYamlToJson`, `diagnosticToMarker` — should return zero matches except the `runQuery` reference in the Run button's `onClick`, confirming the extraction is complete.
   - Run the full `pnpm --dir web test run` once to catch incidental regressions from the import/effect reshuffle.

No new sub-tickets: this is a single, tightly-coupled mechanical extraction (one new file + corresponding removals in App.tsx, plus a few lines of hook-wiring glue) that should ship as one change; the two-hook wiring nuance above is the only non-mechanical part and doesn't warrant its own ticket.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Execution attempt on 2026-07-01: ticket's own implementation plan requires TASK-112 and TASK-96.1 (which itself depends on TASK-113) to be Done before starting, since this hook extraction relocates the auto-run effect (fixed by TASK-112) and consumes the registerSchema() entry point (introduced by TASK-96.1/TASK-113). Verified via 'backlog task TASK-112/TASK-96.1/TASK-113 --plain': all three are still status 'To Do'. No code changes made. Leaving status as-is (Dev Ready, not started/claimed) pending upstream work; not reverting from In Progress since it was never claimed.

Execution attempt on 2026-07-01 (second pass): re-verified TASK-112, TASK-96.1, and TASK-113 via 'backlog task ... --plain' — all three remain status 'To Do'. This ticket's own implementation plan requires all three Done before starting (auto-run effect fix from TASK-112, and the registerSchema() entry point from TASK-96.1/TASK-113). No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work.

Execution attempt on 2026-07-01 (third pass): re-verified TASK-112, TASK-96.1, and TASK-113 via 'backlog task ... --plain' — all three remain status 'To Do'. This ticket's implementation plan explicitly requires all three Done before starting (auto-run effect fix from TASK-112 must land first so it isn't lost during the move; the registerSchema() entry point from TASK-96.1, which itself depends on TASK-113, must exist before this hook can consume it cleanly). No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work.

Execution attempt on 2026-07-01 (fourth pass): re-verified TASK-112, TASK-96.1, and TASK-113 via task file frontmatter — all three remain status 'To Do'. This ticket's implementation plan explicitly requires all three Done before starting. No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work.

Execution attempt on 2026-07-01 (fifth pass): re-verified TASK-112, TASK-96.1, and TASK-113 via 'backlog task ... --plain' -- all three remain status 'To Do'. This ticket's implementation plan explicitly requires all three Done before starting (auto-run effect fix from TASK-112 must land first; the registerSchema() entry point from TASK-96.1, which itself depends on TASK-113, must exist before this hook can consume it cleanly). No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work.

Execution attempt on 2026-07-01 (sixth pass): re-verified TASK-112, TASK-96.1, and TASK-113 via 'backlog task ... --plain' -- all three remain status 'To Do'. This ticket's implementation plan explicitly requires all three Done before starting (auto-run effect fix from TASK-112 must land first so it isn't lost during the move; the registerSchema() entry point from TASK-96.1, which itself depends on TASK-113, must exist before this hook can consume it cleanly). No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work. Note: found an unrelated uncommitted working-tree change to TASK-96.1's task file (an implementation plan/note added by a prior/parallel process) -- left untouched as it is out of scope for this ticket.

Execution attempt on 2026-07-01 (seventh pass): re-verified TASK-112, TASK-96.1, and TASK-113 via 'backlog task ... --plain' -- all three remain status 'To Do'. This ticket's implementation plan explicitly requires all three Done before starting (auto-run effect fix from TASK-112 must land first so it isn't lost during the move; the registerSchema() entry point from TASK-96.1, which itself depends on TASK-113, must exist before this hook can consume it cleanly). No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work.

Execution attempt on 2026-07-01 (eighth pass): re-verified TASK-112, TASK-96.1, and TASK-113 via 'backlog task ... --plain' -- all three remain status 'To Do'. This ticket's implementation plan explicitly requires all three Done before starting (auto-run effect fix from TASK-112 must land first so it isn't lost during the move; the registerSchema() entry point from TASK-96.1, which itself depends on TASK-113, must exist before this hook can consume it cleanly). No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work.

Execution attempt on 2026-07-01 (ninth pass): re-verified TASK-112, TASK-96.1, and TASK-113 via 'backlog task ... --plain' -- all three remain status 'To Do'. This ticket's implementation plan explicitly requires all three Done before starting (auto-run effect fix from TASK-112 must land first so it isn't lost during the move; the registerSchema() entry point from TASK-96.1, which itself depends on TASK-113, must exist before this hook can consume it cleanly). No code changes made. Status left unchanged (Dev Ready, never claimed/in-progress) pending upstream work.
<!-- SECTION:NOTES:END -->
