---
id: TASK-42
title: Improve intellisense in the query and variables editors
status: To Do
assignee: []
created_date: '2026-06-12 19:44'
labels:
  - dx
  - editor
  - graphql
dependencies: []
priority: medium
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The query editor (bottom-left) and variables editor should offer rich autocomplete tied to the live supergraph schema and the active query's variable types.

**Current state**
- `monaco-graphql` is initialized and `setSchemaConfig` is called with the API schema SDL on every successful compose (`App.tsx` ~line 168–176).
- The query editor uses `path="query-N.graphql"` and `fileMatch: ["**/*.graphql"]`, so the graphql worker *should* pick up the schema — but only after the first successful compose, and it is unclear whether updates propagate correctly.
- The variables editor is a plain `<textarea>` with no autocomplete at all.

**Goal**
1. Ensure the query editor always has up-to-date GraphQL autocomplete (field names, argument names, types, directives) against the current composed supergraph schema.
2. Upgrade the variables editor to a Monaco JSON editor that receives a JSON Schema derived from the active query's variable definitions, so users get autocomplete and validation for the variables they need to provide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Typing in the query editor offers field/argument/type autocomplete drawn from the current supergraph schema (Ctrl+Space or trigger character).
- [ ] #2 Query editor autocomplete updates automatically when the subgraph SDL is edited and a new compose succeeds — no page reload required.
- [ ] #3 Query editor shows inline diagnostics (red squiggles) for invalid field names or type mismatches against the current schema.
- [ ] #4 The variables editor is a Monaco editor (language: json) rather than a plain textarea.
- [ ] #5 The variables editor receives a JSON Schema derived from the active query's variable definitions and offers autocomplete + validation for those variables.
- [ ] #6 Switching query tabs updates the variables editor's JSON Schema to match the newly active query's variables.
- [ ] #7 All existing query-tab and compose tests continue to pass.
<!-- AC:END -->
