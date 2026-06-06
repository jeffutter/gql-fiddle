---
id: TASK-13
title: Add validate_subgraph() diagnostic tests
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-1
dependencies:
  - TASK-5
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: low
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test that validation produces correct diagnostics with accurate 1-based positions, since the editor underlines depend on them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A valid schema yields an empty diagnostics list
- [ ] #2 Each invalid-schema test asserts exact 1-based line, col, and len of the first diagnostic
- [ ] #3 nix develop -c cargo test -p gql-core passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Add tests (a #[cfg(test)] module in validate.rs or a tests/validate.rs file) calling gql_core::validate_subgraph(sdl).
2. A valid schema returns zero diagnostics.
3. For at least TWO invalid schemas, assert the diagnostic count AND the exact line/col/len (1-based) of the first diagnostic. Pick inputs where the position is easy to compute by hand, and add a comment showing the offending token and its position.
4. Run: nix develop -c cargo test -p gql-core
<!-- SECTION:PLAN:END -->
