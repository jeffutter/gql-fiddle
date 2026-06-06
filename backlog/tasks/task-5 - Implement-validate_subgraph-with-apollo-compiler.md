---
id: TASK-5
title: Implement validate_subgraph() with apollo-compiler
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-1
dependencies:
  - TASK-1
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the validate.rs stub for validate_subgraph so the editor can underline errors precisely while a user types a subgraph schema. Output JSON shape must not change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Valid SDL returns an empty diagnostics array
- [ ] #2 Invalid SDL returns at least one diagnostic with correct 1-based line and col
- [ ] #3 Each diagnostic has severity, message, line, col, len
- [ ] #4 nix develop -c cargo build -p gql-core succeeds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Read crates/gql-core/src/validate.rs.
2. Keep the signature: pub fn validate_subgraph(sdl: &str) -> serde_json::Value
3. Parse and validate the SDL with apollo-compiler 1.32.0 (docs: https://docs.rs/apollo-compiler/1.32.0 ; look for schema parse/validate that yields diagnostics with source locations).
4. For each diagnostic produce: { "severity": "error" | "warning", "message": "<text>", "line": <1-based>, "col": <1-based>, "len": <span length in characters> }.
5. Return { "diagnostics": [ ... ] }. Valid SDL returns { "diagnostics": [] }.
6. line and col MUST be 1-based (first character is line 1, col 1). The editor depends on this exactly.
7. Build: nix develop -c cargo build -p gql-core
<!-- SECTION:PLAN:END -->
