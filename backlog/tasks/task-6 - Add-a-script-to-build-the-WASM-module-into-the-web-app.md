---
id: TASK-6
title: Add a script to build the WASM module into the web app
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-1
dependencies:
  - TASK-3
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The web app loads the compiled core from web/src/wasm/. Add a repeatable command that builds the Rust core directly into that folder so front-end tasks can import it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A build:wasm script exists in web/package.json with the specified command
- [ ] #2 Running it produces web/src/wasm/gql_core.js and a .wasm file
- [ ] #3 Generated wasm files remain git-ignored (not staged)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open web/package.json.
2. In "scripts" add this entry (pnpm scripts run from the web/ folder, so paths are relative to web/):
     "build:wasm": "wasm-pack build ../crates/gql-core --target web --out-dir ../web/src/wasm"
3. Run: nix develop -c bash -c "cd web && pnpm build:wasm"
4. Confirm web/src/wasm/ now contains gql_core.js and a .wasm file.
5. web/src/wasm/ is already in .gitignore. Do NOT commit generated files and do NOT change .gitignore.
<!-- SECTION:PLAN:END -->
