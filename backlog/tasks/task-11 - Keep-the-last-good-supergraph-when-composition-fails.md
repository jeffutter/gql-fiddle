---
id: TASK-11
title: Keep the last good supergraph when composition fails
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-1
dependencies:
  - TASK-10
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When composition fails mid-edit, do not blank or disable everything. Keep showing the last successful supergraph marked as stale so the user is never locked out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a previous success, a failing compose keeps the last good supergraph visible, grayed, with a stale badge, plus the error banner
- [ ] #2 The next successful compose removes the stale badge/gray styling and updates the SDL
- [ ] #3 With no prior success, a failing compose shows only the error banner (no crash)
- [ ] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. In the store keep TWO things: lastGoodSupergraphSdl (updated ONLY on a successful compose) and the current compose result.
2. When the current compose FAILS: still display lastGoodSupergraphSdl in the Supergraph pane, visibly grayed out, with a small "stale" badge, AND show the error banner (from the recompose task).
3. When compose SUCCEEDS again: update lastGoodSupergraphSdl, and remove the gray styling and the stale badge.
4. If there has NEVER been a successful compose: show only the error banner and an empty supergraph pane (do not crash).
<!-- SECTION:PLAN:END -->
