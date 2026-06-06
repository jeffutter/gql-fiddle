---
id: TASK-23
title: Serialize the workspace into a shareable URL and restore it
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-4
dependencies:
  - TASK-19
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let users share their whole workspace via a URL. Encode the workspace into the URL hash; on load, restore from it. Because mock data is seed-deterministic, a shared URL reproduces identical results.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/src/share.ts has encode/decode (JSON -> gzip -> base64 and back)
- [ ] #2 Editing the workspace updates location.hash (debounced)
- [ ] #3 Loading a URL with a valid hash restores subgraphs, query, variables, and seed
- [ ] #4 A corrupt hash falls back to the default workspace without crashing
- [ ] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. The workspace to save is: subgraphs (array of name+sdl), query, variables, seed. Do NOT save derived state (the supergraph).
2. Add web/src/share.ts with encode(workspace) -> string and decode(string) -> workspace. encode: JSON.stringify -> gzip -> base64. decode reverses it. For gzip add a small lib: nix develop -c bash -c "cd web && pnpm add pako && pnpm add -D @types/pako".
3. On edit (debounced), set location.hash to "#w=" + encode(workspace).
4. On app load: if location.hash contains a w= value, decode it and initialize the store from it instead of the default workspace.
5. If decoding fails (corrupt hash), fall back to the default workspace and do not crash.
6. Verify: make changes, copy the URL, open it in a new tab, confirm the same subgraphs/query/variables/seed load.
<!-- SECTION:PLAN:END -->
