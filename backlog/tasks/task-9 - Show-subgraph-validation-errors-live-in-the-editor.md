---
id: TASK-9
title: Show subgraph validation errors live in the editor
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-1
dependencies:
  - TASK-8
  - TASK-5
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
While the user types a subgraph schema, show validation errors as red underlines (Monaco markers) using validate_subgraph from the core.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Typing invalid SDL shows a red underline at the correct position within ~300ms
- [ ] #2 Fixing the error clears the underline
- [ ] #3 Validation is debounced (not per-keystroke)
- [ ] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. After each edit to the active subgraph, with a ~300ms debounce, call core.validateSubgraph(currentSdl).
2. Convert each diagnostic into a Monaco marker. Monaco positions are 1-based. Use the diagnostic line/col for the start, and the SAME line with column = col + len for the end. Map severity "error" -> monaco.MarkerSeverity.Error, "warning" -> Warning.
3. Apply with monaco.editor.setModelMarkers(model, "graphql", markers).
4. Debounce so validation does not run on every keystroke (a setTimeout cleared on each change is enough).
5. Verify: type an invalid schema (e.g. a field whose type does not exist) and confirm a red underline appears at the right spot; fixing it clears the underline.
<!-- SECTION:PLAN:END -->
