---
id: TASK-25
title: Add URL round-trip and shared-URL reproducibility tests
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 12:03'
labels: []
milestone: m-4
dependencies:
  - TASK-23
  - TASK-39
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: low
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test that encoding then decoding a workspace returns the same data, and that the seed is passed through unchanged (the determinism guarantee end to end).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A round-trip test asserts decode(encode(w)) deep-equals w
- [ ] #2 A corrupt-input test asserts the documented fallback behavior
- [ ] #3 A wiring test confirms the restored seed is passed to executeMock
- [ ] #4 nix develop -c bash -c "cd web && pnpm test run" passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Add web/src/share.test.ts (Vitest).
2. Round-trip test: build a sample workspace object, run decode(encode(workspace)), and assert deep equality with the original.
3. Corrupt-input test: decode("not-valid") returns null/undefined (or throws and is caught) so the caller falls back to default — assert your decode contract.
4. Wiring test: assert executeMock is called with the seed taken from the restored workspace (a light unit test of the wiring is enough).
5. Run: nix develop -c bash -c "cd web && pnpm test run"
<!-- SECTION:PLAN:END -->
