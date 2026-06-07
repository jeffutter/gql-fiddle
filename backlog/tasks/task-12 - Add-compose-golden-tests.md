---
id: TASK-12
title: Add compose() golden tests
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 22:39'
labels: []
milestone: m-1
dependencies:
  - TASK-2
  - TASK-28
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lock in composition behavior with snapshot (golden) tests so future upgrades of the unstable apollo-federation crate cannot silently change output. Cover success and known error cases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At least 3 success snapshots and 4 error-case snapshots exist and are committed
- [ ] #2 Error-case snapshots assert composition fails (ok:false) with stable code/message
- [ ] #3 nix develop -c cargo test -p gql-core passes with committed snapshots
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Create crates/gql-core/tests/compose.rs (insta is already a dev-dependency).
2. Call gql_core::compose(json) with fixtures and snapshot the returned JSON string using insta::assert_snapshot!.
3. Cover at least: (a) THREE valid multi-subgraph compositions, one of which shares an entity via @key across two subgraphs; (b) FOUR invalid cases that must fail composition: an entity @key field type mismatch, two subgraphs defining the same field differently without @shareable, a reference to a missing type, and an invalid federation directive usage.
4. Generate snapshots: nix develop -c cargo test -p gql-core. Review the produced .snap.new files; accept them (if 'cargo insta accept' is unavailable, rename each *.snap.new to *.snap). Commit the .snap files.
5. Re-run cargo test to confirm everything matches.
<!-- SECTION:PLAN:END -->
