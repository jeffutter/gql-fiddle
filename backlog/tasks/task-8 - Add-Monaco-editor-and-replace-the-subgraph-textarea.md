---
id: TASK-8
title: Add Monaco editor and replace the subgraph textarea
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
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Swap the plain textarea for the Monaco code editor (the editor used by VS Code) for editing subgraph schemas, one editor bound to the active subgraph tab.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The active subgraph is edited in a Monaco editor, not a textarea
- [ ] #2 Editing a subgraph updates the store and re-runs composition
- [ ] #3 Switching subgraph tabs shows that subgraph's SDL in the editor
- [ ] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Add deps: nix develop -c bash -c "cd web && pnpm add @monaco-editor/react monaco-editor"
2. Open web/src/App.tsx. Replace the subgraph <textarea> with the Monaco editor from @monaco-editor/react.
3. Bind the editor value to subgraphs[activeSubgraph].sdl and its onChange to setSubgraphSdl(activeSubgraph, value).
4. Set the editor language to "graphql" (basic colors are fine; full language features come later).
5. Keep the subgraph tab buttons and the Supergraph pane working.
6. Verify: nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint", then pnpm dev and confirm typing updates the supergraph pane.
<!-- SECTION:PLAN:END -->
