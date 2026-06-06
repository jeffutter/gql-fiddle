---
id: TASK-7
title: Replace the WASM stub loader with the real generated module
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
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
- [ ] #1 loadCore() imports and initializes ../wasm/gql_core.js and returns a real GqlCore
- [ ] #2 Every method JSON.parses the wasm string result and returns typed values; compose/execute_mock pass JSON.stringify for object inputs
- [ ] #3 makeStubCore() is removed
- [ ] #4 pnpm tsc --noEmit passes
- [ ] #5 The running app shows a real composition result instead of the stub message
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
