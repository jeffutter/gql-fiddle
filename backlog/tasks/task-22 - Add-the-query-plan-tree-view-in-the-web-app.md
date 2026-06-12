---
id: TASK-22
title: Add the query-plan tree view in the web app
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 15:45'
labels:
  - planned
milestone: m-3
dependencies:
  - TASK-20
  - TASK-19
  - TASK-40
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a "Query Plan" tab beside the supergraph SDL that draws the plan as an indented tree, updating when the user runs a query.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Query Plan tab shows the plan tree after Run, with subgraph names on Fetch nodes and nesting for Sequence/Parallel/Flatten
- [x] #2 A failed plan shows an error message instead of crashing
- [x] #3 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview
Add a tabbed top-right pane (Supergraph SDL | Query Plan) and wire `core.plan()` into the Run handler. All work is in the TypeScript/React web app — the Rust/WASM backend is already complete (TASK-40).

### Step 1 — Add TypeScript types (web/src/core/types.ts)

Add a `PlanNode` discriminated union matching the 7 Rust DTO variants and a `PlanResult` wrapper. Update `GqlCore.plan()` return type from `unknown` to `PlanResult`:

```ts
export type PlanNode =
  | { kind: "Fetch"; service: string; operation: string; operation_kind: string }
  | { kind: "Sequence"; nodes: PlanNode[] }
  | { kind: "Parallel"; nodes: PlanNode[] }
  | { kind: "Flatten"; path: string[]; node: PlanNode }
  | { kind: "Subscription"; primary: PlanNode; rest?: PlanNode }
  | { kind: "Defer"; primary?: PlanNode; deferred: DeferredBranch[] }
  | { kind: "Condition"; conditionVariable: string; ifBranch?: PlanNode; elseBranch?: PlanNode }

export type DeferredBranch = { label?: string; node?: PlanNode }

export type PlanResult =
  | { ok: true; query_plan: PlanNode }
  | { ok: false; errors: { code: string; message: string }[] }
```

Also update `GqlCore.plan()` signature to return `PlanResult` instead of `unknown`.

### Step 2 — Extend Zustand store (web/src/store.ts)

Add `planResult: PlanResult | null` and a `setPlanResult` action to `WorkspaceState`. Do NOT include it in the `partialize` list (it's transient, like `mockResult`).

### Step 3 — Update the Run handler (web/src/App.tsx ~line 584)

Inside the existing async click handler, call `core.plan()` in parallel with `core.executeMock()` (or sequentially if simpler — both are fast). Store the result:

```ts
const [execResult, planResult] = await Promise.all([
  Promise.resolve(core.executeMock(supergraphSdl, query, parsedVariables, seed)),
  Promise.resolve(core.plan(supergraphSdl, query) as PlanResult),
]);
setMockResult(execResult);
setPlanResult(planResult);
```

### Step 4 — Add tab state and navigation to the top-right pane (web/src/App.tsx)

Add local component state:
```ts
const [rightTab, setRightTab] = useState<"sdl" | "plan">("sdl");
```

Wrap the existing top-right column content in a container that adds tab buttons above it (follow the subgraph tab button pattern with `aria-pressed`):
- "Supergraph SDL" tab: shows the existing SDL display when `rightTab === "sdl"`
- "Query Plan" tab: shows the plan tree when `rightTab === "plan"`

### Step 5 — Add PlanTree component (web/src/PlanTree.tsx)

Create a recursive component:
```ts
function PlanTree({ node, depth = 0 }: { node: PlanNode; depth?: number })
```

Render each variant using indentation (`paddingLeft: depth * 16`):
- **Fetch**: bold service name + operation_kind badge + `<pre>` block showing `operation`
- **Sequence / Parallel**: label ("Sequence" / "Parallel") + map children at `depth + 1`
- **Flatten**: "Flatten @ path.join('.')" + recurse into `node` at `depth + 1`
- **Subscription**: "Subscription" label + primary at `depth + 1` + optional rest
- **Defer**: "Defer" label + optional primary + map deferred branches
- **Condition**: "Condition: conditionVariable" + optional ifBranch / elseBranch

### Step 6 — Render plan tab content in App.tsx

In the "Query Plan" tab content area:
- `planResult === null` → grey placeholder "Run a query to see the plan"
- `planResult.ok === false` → red error box with `errors.map(e => e.message).join('\n')`
- `planResult.ok === true` → `<PlanTree node={planResult.query_plan} />`

### Verification
- Run a multi-subgraph query; expect a Sequence node with Fetch children per subgraph
- Run an invalid operation; expect the error message in the plan tab (not a crash)
- `pnpm tsc --noEmit` and `pnpm lint` must pass
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in 5 files:
- web/src/core/types.ts: added PlanNode (7 variants), DeferredBranch, PlanResult types; updated GqlCore.plan() return type from unknown to PlanResult
- web/src/core/index.ts: updated plan() wrapper return type to PlanResult
- web/src/PlanTree.tsx: new recursive component rendering all 7 node variants with depth-based indentation
- web/src/App.tsx: added planResult/setPlanResult state, rightTab state, updated Run handler to call core.plan() in parallel with executeMock(), replaced Supergraph h2 with tabbed nav (Supergraph SDL | Query Plan)
- web/src/App.test.tsx: updated test selector from "Supergraph" (old h2) to "Supergraph SDL" (new tab button)
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a Query Plan tab to the top-right pane alongside Supergraph SDL. The tab shows a recursive tree of PlanNode variants (Fetch with service name/operation, Sequence, Parallel, Flatten with path, Subscription, Defer, Condition) when Run is clicked, and shows an error message for failed plans. TypeScript types are fully narrowed — PlanResult discriminated union, PlanNode union of 7 variants — matching the Rust DTO exactly. All 60 tests pass, tsc and lint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
