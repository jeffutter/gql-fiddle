---
id: TASK-10
title: Recompose live and show supergraph SDL or error banner
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
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
- [ ] #1 Editing a subgraph recomposes within ~300ms
- [ ] #2 A successful compose shows the supergraph SDL and an errors/hints count
- [ ] #3 A failing compose shows an error banner with each code and message
- [ ] #4 The latest successful supergraph SDL is stored in the workspace store
- [ ] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Subscribe to the store subgraphs. On change, debounce ~300ms, then call core.compose(subgraphs).
2. If result.ok: show result.supergraph_sdl in the read-only Supergraph pane (read-only Monaco or a <pre>) and a small line "Composition: 0 errors, N hints".
3. If not result.ok: show a clearly styled error banner listing each error as "CODE: message", one per line.
4. Add fields to the workspace store to hold the latest compose result (e.g. supergraphSdl and composeErrors) so the query editor can use them later.
5. Verify: two subgraphs that compose show the SDL; break one and the error banner appears.
<!-- SECTION:PLAN:END -->
