---
id: TASK-24
title: Autosave the workspace to localStorage
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-4
dependencies:
  - TASK-23
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: low
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
So users do not lose work, autosave the workspace to localStorage and restore it on load when there is no shareable URL hash.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The workspace is saved to localStorage on change (debounced)
- [ ] #2 On load with no URL hash, the workspace restores from localStorage
- [ ] #3 URL hash takes priority over localStorage when both exist
- [ ] #4 Corrupt localStorage is ignored without crashing
- [ ] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. On workspace change (debounced ~500ms), write the encoded workspace (reuse encode from the share task, or plain JSON) to localStorage under a fixed key, e.g. "graphql-playground:workspace".
2. On load, pick the source in this priority: (1) URL hash if present, else (2) localStorage if present, else (3) the default workspace.
3. If the stored value is corrupt, ignore it and use the default.
4. Verify: edit, reload the page (no hash), confirm your work is restored.
<!-- SECTION:PLAN:END -->
