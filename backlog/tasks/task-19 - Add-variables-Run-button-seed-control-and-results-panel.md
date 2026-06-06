---
id: TASK-19
title: 'Add variables, Run button, seed control, and results panel'
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-2
dependencies:
  - TASK-18
  - TASK-16
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete the query experience: a variables editor, a Run button, a numeric seed control, and a results panel showing the mocked JSON.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Invalid variables JSON shows a visible message and blocks Run
- [ ] #2 Run calls execute_mock with current schema, query, variables, and seed and shows pretty-printed results
- [ ] #3 Same query+seed yields identical displayed results; changing the seed changes them
- [ ] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Add a variables editor (small Monaco or a textarea) bound to the store variables field. If the text is not valid JSON, show a clear inline message.
2. Add a numeric "seed" input bound to the store seed field (default 42).
3. Add a "Run" button. On click: parse the variables JSON (if invalid, show the message and do NOT run); then call core.executeMock(currentSupergraphSdl, query, variablesObject, seed).
4. Show the returned data pretty-printed in a Results panel; if errors are returned, show them too.
5. Verify: a valid query shows mock data; same query + same seed shows identical results each run; changing the seed changes the data.
<!-- SECTION:PLAN:END -->
