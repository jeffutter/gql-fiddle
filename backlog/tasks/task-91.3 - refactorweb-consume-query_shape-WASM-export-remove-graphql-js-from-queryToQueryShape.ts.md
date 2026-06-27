---
id: TASK-91.3
title: >-
  refactor(web): consume query_shape() WASM export, remove graphql-js from
  queryToQueryShape.ts
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-27 17:16'
updated_date: '2026-06-27 18:26'
labels:
  - rust
  - wasm
  - planned
dependencies:
  - TASK-91.2
references:
  - web/src/queryToQueryShape.ts
  - web/src/core/index.ts
  - web/src/core/types.ts
  - web/src/App.tsx
  - crates/gql-core/src/lib.rs
modified_files:
  - web/src/queryToQueryShape.ts
  - web/src/core/index.ts
  - web/src/core/types.ts
  - web/src/queryToQueryShape.test.ts
parent_task_id: TASK-91
priority: medium
ordinal: 91300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the web half of TASK-91. TASK-91.2 must be complete and the WASM rebuilt (`pnpm build:wasm` from `web/`) before this task begins.

The goal is to replace the `graphql-js` implementation inside `queryToQueryShape.ts` with a call to the new `query_shape(api_schema_sdl, query)` WASM export.

## Current call path

```
App.tsx / QueryShape.tsx
  → queryToQueryShape(apiSchemaSdl, query)
    → graphql-js parse(apiSchemaSdl)
    → graphql-js parse(query)
    → walk AST
    → QueryShapeTree
```

## Target call path

```
App.tsx / QueryShape.tsx
  → queryToQueryShape(core, apiSchemaSdl, query)   // or inline via core.queryShape()
    → core.query_shape(apiSchemaSdl, query)         // WASM call
    → QueryShapeTree                                // JSON parse result
```

## What to change

### `web/src/core/index.ts` — add `queryShape` to `GqlCore`

The `GqlCore` interface and `loadCore()` factory wrap every WASM export. Add:

```ts
queryShape(apiSchemaSdl: string, query: string): QueryShapeTree;
```

Implementation in `loadCore()`:
```ts
queryShape(apiSchemaSdl, query) {
  return JSON.parse(wasm.query_shape(apiSchemaSdl, query)) as QueryShapeTree;
}
```

### `web/src/core/types.ts` — add `QueryShapeTree` type

The Rust DTOs from TASK-91.2 serialize with camelCase keys (reusing `SchemaTreeFieldDto`). Add:

```ts
export interface QueryShapeOperation {
  header: string;
  fields: SchemaTreeFieldDto[];
}
export interface QueryShapeTree {
  operations: QueryShapeOperation[];
}
```

### `web/src/queryToQueryShape.ts` — replace implementation

- Change signature to `queryToQueryShape(core: GqlCore, apiSchemaSdl: string, query: string): QueryShapeTree`
- Body: return `core.queryShape(apiSchemaSdl, query)` (or inline the WASM call if the wrapper is trivial enough to delete)
- Remove all `graphql-js` imports and the entire internal implementation (type map, AST walking, etc.)
- If `QueryShapeTree` and `QueryShapeOperation` are structurally identical between `types.ts` and the existing exports from `queryToQueryShape.ts`, unify them

### Call sites in `App.tsx` / `QueryShape.tsx`

Find where `queryToQueryShape` is called and thread through the `core` reference. The `core` object is already available from `loadCore()` at the top of `App.tsx`.

### `web/src/queryToQueryShape.test.ts` (from TASK-91.1)

The snapshot tests call `queryToQueryShape(apiSchemaSdl, query)` directly. After this change the signature includes `core`. Update the tests to:
1. Get a `core` instance via `loadCore()` (already used in other tests in the suite — see `web/src/core/index.test.ts` for how to call it in vitest)
2. Pass `core` as the first argument
3. The snapshots themselves must not change — if any snapshot updates are needed, investigate as a regression before merging

## Done when

- `queryToQueryShape.ts` has no `import ... from "graphql"` line
- `pnpm test run` passes with all existing `queryToQueryShape` snapshots matching
- `pnpm tsc --noEmit` passes
- The Query Shape tab renders correctly end-to-end for queries with fragments and union type conditions
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 queryToQueryShape.ts has no import from 'graphql'
- [x] #2 pnpm test run passes with all existing queryToQueryShape snapshots matching (no updates required)
- [x] #3 pnpm tsc --noEmit passes with no errors
- [x] #4 The Query Shape tab renders correctly for queries with fragments, inline fragments, aliases, and union type conditions
- [x] #5 core/index.ts exposes queryShape() on the GqlCore interface
- [x] #6 core/types.ts includes QueryShapeTree and QueryShapeOperation types
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plan: Web migration — consume query_shape() WASM export

### Prerequisites

- TASK-91.2 must be complete and `cargo build -p gql-core --target wasm32-unknown-unknown` must succeed
- Run `pnpm build:wasm` from `web/` before any TypeScript work to pick up the new WASM export

### File changes (in order)

#### 1. `web/src/core/types.ts`

Add two new interfaces and extend `GqlCore`:

```ts
// After the SchemaTree interface block, add:
export interface QueryShapeOperation {
  /** e.g. "query GetUser" or "query" */
  header: string;
  /** Top-level selected fields — same shape as SchemaTreeField */
  fields: SchemaTreeField[];
}

export interface QueryShapeTree {
  /** One entry per OperationDefinition in the document */
  operations: QueryShapeOperation[];
}
```

Add to the `GqlCore` interface (after `nodeAtPosition`):

```ts
queryShape(apiSchemaSdl: string, query: string): QueryShapeTree;
```

#### 2. `web/src/core/index.ts`

Add the implementation inside `wrap()`:

```ts
queryShape(apiSchemaSdl: string, query: string): QueryShapeTree {
  return json(ns.query_shape(apiSchemaSdl, query)) as QueryShapeTree;
},
```

Also update the import at the top to include `QueryShapeTree`:

```ts
import type {
  ComposeResult,
  Diagnostic,
  GqlCore,
  MockResult,
  PlanResult,
  QueryShapeTree,
  SubgraphInput,
} from "./types";
```

#### 3. `web/src/queryToQueryShape.ts`

Replace the entire file. The new version is a thin pass-through:

```ts
/**
 * queryToQueryShape.ts — Query-driven schema slice view.
 *
 * The query shape is now computed inside the Rust query_shape() WASM export.
 * This module is a thin wrapper that delegates to core.queryShape() and
 * re-exports the QueryShapeTree type for consumer modules.
 *
 * The graphql-js SDL parsing that previously lived here has been removed as part
 * of TASK-91. The Rust implementation (query_shape.rs) is the canonical source.
 */

import type { GqlCore } from "./core/types";
export type { QueryShapeOperation, QueryShapeTree } from "./core/types";

/**
 * Parse a query document and API schema SDL via Rust WASM, returning the
 * shape of the response. Returns `{ operations: [] }` for invalid/empty inputs.
 */
export function queryToQueryShape(
  core: GqlCore,
  apiSchemaSdl: string,
  query: string,
): import("./core/types").QueryShapeTree {
  return core.queryShape(apiSchemaSdl, query);
}
```

Note: `SchemaTreeField` was previously imported from `./schemaToSchemaTree` in this file, but since the new implementation no longer needs it internally, the import is removed. If any consumer imported `SchemaTreeField` from `queryToQueryShape.ts` (none do — they import from `schemaToSchemaTree.ts`), that still works via `schemaToSchemaTree.ts`.

#### 4. `web/src/QueryShape.tsx`

Update props to accept `core` and pass it to `queryToQueryShape`:

```tsx
import type { GqlCore } from "./core/types";

export interface QueryShapeProps {
  core: GqlCore;
  apiSchemaSdl: string;
  query: string;
}

export function QueryShape({ core, apiSchemaSdl, query }: QueryShapeProps) {
  const tree = useMemo(
    () => queryToQueryShape(core, apiSchemaSdl, query),
    [core, apiSchemaSdl, query],
  );
  // ... rest unchanged
```

#### 5. `web/src/App.tsx`

Find where `<QueryShape>` is rendered (currently line 1458: `<QueryShape apiSchemaSdl={apiSchemaSdlForShape ?? ""} query={currentQuery} />`).

The `core` object is loaded via `loadCore()` in `App.tsx` — check how `core` is accessed (likely stored in state after the promise resolves). Pass it as a prop:

```tsx
<QueryShape core={core} apiSchemaSdl={apiSchemaSdlForShape ?? ""} query={currentQuery} />
```

Do the same for all three usages of `queryShapeContent` (lines 2005, 2320, 2397 reference `queryShapeContent` which is defined at 1456 — one edit covers all three).

If `core` is not yet available when the component renders (promise pending), wrap with a null guard: `core && <QueryShape core={core} ...>`.

#### 6. `web/src/queryToQueryShape.test.ts`

The test file calls `queryToQueryShape(apiSchemaSdl, query)` with two args. After the signature change, update:

1. Add a `beforeAll` block to load core (follow the pattern in `web/src/schemaToSchemaTree.test.ts` — it uses `initSync` with the filesystem WASM bootstrap):

```ts
import { beforeAll, describe, it, expect } from "vitest";
import { queryToQueryShape } from "./queryToQueryShape";
import type { GqlCore } from "./core/types";
import { loadCore } from "./core";

let core: GqlCore;
beforeAll(async () => {
  core = await loadCore();
});
```

2. Update every `queryToQueryShape(sdl, query)` call to `queryToQueryShape(core, sdl, query)`.

3. The snapshots must not change — the Rust output must match the JS output exactly. If any snapshot updates are prompted during `pnpm test run`, investigate the difference before accepting it; do not blindly update.

### Verification

```bash
# In web/ directory:
pnpm build:wasm          # pick up new query_shape export from Rust
pnpm tsc --noEmit        # check TypeScript types
pnpm test run            # all tests including queryToQueryShape snapshots must pass
```

The Query Shape tab in the running app must render identically for queries with fragments, inline fragments, aliases, and union type conditions.

### Key considerations

- **Core availability in App.tsx**: If `core` is loaded asynchronously and stored in state as `GqlCore | null`, the `queryShapeContent` variable may need to guard against `null`. Check the existing pattern for how `core` is threaded to other components in `App.tsx`.
- **Snapshot stability**: The Rust output must produce identical JSON to the JS output for all 12 snapshot test cases. If Rust and JS differ on any case (e.g. field ordering, alias handling), the discrepancy must be resolved by aligning the Rust implementation — not by updating snapshots.
- **WASM rebuild order**: TypeScript work on `core/index.ts` requires the WASM to already export `query_shape`. Run `pnpm build:wasm` before editing TypeScript to avoid "property does not exist" compile errors from the generated WASM bindings.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migrated queryToQueryShape.ts to a thin WASM wrapper. Added QueryShapeOperation and QueryShapeTree interfaces to core/types.ts. Added queryShape() method to GqlCore interface and implementation in core/index.ts. Replaced the 335-line graphql-js implementation in queryToQueryShape.ts with a one-liner delegating to core.queryShape(). Updated QueryShape.tsx to accept a core prop. Added coreInstance state to App.tsx loaded once via useEffect and passed to QueryShape. Updated queryToQueryShape.test.ts to load core via beforeAll/loadCore() and pass it as the first argument to queryToQueryShape(). All 373 tests pass and snapshots match without updates. pnpm tsc --noEmit passes with no errors.
<!-- SECTION:FINAL_SUMMARY:END -->
