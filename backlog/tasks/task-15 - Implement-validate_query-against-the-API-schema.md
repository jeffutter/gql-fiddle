---
id: TASK-15
title: Implement validate_query() against the API schema
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-2
dependencies:
  - TASK-14
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the validate.rs stub for validate_query so the query editor can flag invalid operations. Validate against the API schema (not the raw supergraph).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A valid operation returns an empty diagnostics list
- [ ] #2 An operation with an unknown field returns a diagnostic with correct 1-based position
- [ ] #3 Output shape matches validate_subgraph exactly
- [ ] #4 nix develop -c cargo build and cargo test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Keep the signature: pub fn validate_query(supergraph_sdl: &str, operation: &str) -> serde_json::Value
2. Derive the API schema using the helper from the "Derive the API schema" task.
3. Parse and validate the operation against the API schema with apollo-compiler (executable document validation).
4. Return the SAME diagnostic shape as validate_subgraph: { "diagnostics": [ { severity, message, line, col, len } ] } with 1-based line/col.
5. Build and quick-check: a valid query -> no diagnostics; a query selecting a non-existent field -> a diagnostic at the right place.
<!-- SECTION:PLAN:END -->
