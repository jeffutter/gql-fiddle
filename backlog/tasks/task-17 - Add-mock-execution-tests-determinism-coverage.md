---
id: TASK-17
title: Add mock-execution tests (determinism + coverage)
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-2
dependencies:
  - TASK-16
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test the mock walker thoroughly, especially that output is deterministic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A determinism test asserts identical output across two runs with the same seed
- [ ] #2 Separate tests cover nullability, list length, abstract-type selection, and @skip/@include with variables
- [ ] #3 nix develop -c cargo test -p gql-core passes with committed snapshots
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Create crates/gql-core/tests/mock.rs.
2. Determinism test: call execute_mock twice with identical inputs and assert the two JSON strings are exactly equal. Also snapshot one result with insta.
3. Separate focused tests for: nullability (a non-null field is never null), lists (length is exactly 3), abstract types (result __typename is one of the allowed types), and @skip/@include driven by variables (a field is absent when skipped, present when included).
4. Run: nix develop -c cargo test -p gql-core (accept insta snapshots as in the compose golden-tests task).
<!-- SECTION:PLAN:END -->
