---
id: TASK-1
title: Enable Apollo crate dependencies in gql-core
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-0
dependencies: []
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Apollo GraphQL crates are currently commented out in the core crate so the scaffold builds without them. Turn them on so later tasks can compose and validate schemas. First step of Spike 0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 crates/gql-core/Cargo.toml has apollo-compiler = "=1.32.0" and apollo-federation = "=2.15.0" uncommented
- [ ] #2 nix develop -c cargo build -p gql-core succeeds (native build)
- [ ] #3 No dependency version numbers were changed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/Cargo.toml.
2. Under the "[dependencies]" Apollo section, uncomment exactly these two lines so they read:
     apollo-compiler = "=1.32.0"
     apollo-federation = "=2.15.0"
   Keep the leading "=" (exact pin). Do NOT change the numbers.
3. Leave the getrandom line commented for now.
4. Run: nix develop -c cargo build -p gql-core
5. If it builds, done. If the NATIVE build fails because of a missing dependency, paste the exact error into this task's notes and stop (do not edit unrelated code).
<!-- SECTION:PLAN:END -->
