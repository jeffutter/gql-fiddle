---
id: TASK-18
title: Add the query editor with monaco-graphql autocomplete
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-2
dependencies:
  - TASK-8
  - TASK-14
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the bottom Query editor using Monaco with GraphQL language features (autocomplete, validation) driven by the composed API schema, so the user gets schema-aware help while writing queries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 compose() success result includes api_schema_sdl and the ComposeResult ok type is updated
- [ ] #2 The query editor is a Monaco editor wired to the store query
- [ ] #3 Autocomplete suggests fields from the currently composed API schema
- [ ] #4 Editing subgraphs updates the autocomplete schema to match
- [ ] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Add deps: nix develop -c bash -c "cd web && pnpm add monaco-graphql graphql"
2. Add a Monaco editor for the query, bound to the store query field (setQuery on change).
3. Expose the API schema to JavaScript: extend the compose() SUCCESS envelope in gql-core to ALSO include "api_schema_sdl": "<API schema as SDL>" (derive it with the api-schema helper), and add api_schema_sdl to the ComposeResult ok type in web/src/core/types.ts. Rebuild the wasm (build:wasm).
4. Configure monaco-graphql with that api_schema_sdl so the query editor autocompletes/validates against the current schema.
5. When composition succeeds and the schema changes, update the monaco-graphql schema config to match.
6. Verify: typing in the query editor offers fields from the composed schema; an unknown field shows an error.
<!-- SECTION:PLAN:END -->
