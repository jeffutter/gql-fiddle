---
id: TASK-21
title: Add QueryPlan DTO round-trip tests
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 12:03'
labels: []
milestone: m-3
dependencies:
  - TASK-20
  - TASK-40
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: low
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ensure our QueryPlan DTO serializes to a stable shape (so the JS visualizer cannot silently break) and that plan() works for representative queries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Snapshots exist for a single-subgraph and a multi-subgraph plan
- [ ] #2 A round-trip test guards the DTO JSON shape
- [ ] #3 nix develop -c cargo test -p gql-core passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Create crates/gql-core/tests/plan.rs.
2. Snapshot (insta) the plan() JSON for: a single-subgraph query (one Fetch) and a multi-subgraph query that requires a Flatten plus a second Fetch.
3. Add a round-trip test: serialize a constructed QueryPlan DTO to JSON and deserialize back (or re-serialize) and assert equality, to guard the shape.
4. Run cargo test and accept snapshots.
<!-- SECTION:PLAN:END -->
