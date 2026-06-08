---
id: TASK-33
title: 'Fix: auto-generated subgraph names are not unique (duplicate React keys)'
status: To Do
assignee: []
created_date: '2026-06-08 18:39'
labels:
  - review-followup
milestone: m-1
dependencies:
  - TASK-29
priority: high
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-29 (web/src/App.tsx:154 and web/src/store.ts:51). The [+] handler creates names with `subgraph-${subgraphs.length + 1}`, which is NOT unique after a removal. Example: start [products] -> add -> subgraph-2 -> add -> subgraph-3 -> close subgraph-2 -> now length 2 -> add -> subgraph-3 AGAIN (collision). This violates TASK-29 AC#1 ('a unique auto-generated name') and produces duplicate React keys at App.tsx:126 (key={sg.name}), which causes React reconciliation bugs (tabs render incorrectly). Axis: Correct.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Adding subgraphs repeatedly with interleaved removals never produces two subgraphs with the same name
- [ ] #2 A new test in web/src/store.test.ts (or App.test.tsx) reproduces the add/remove/add sequence and asserts all subgraph names are distinct
- [ ] #3 nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run" passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Decide where uniqueness lives. Preferred: make the [+] handler in web/src/App.tsx compute the first unused name. Replace the onClick at App.tsx:154 ('addSubgraph(`subgraph-${subgraphs.length + 1}`)') with logic that finds the lowest integer N >= 1 such that the name `subgraph-${N}` is not already present in subgraphs.map(s => s.name), then calls addSubgraph with that name. Keep it small and readable.
2. Leave key={sg.name} at App.tsx:126 as-is — it is correct once names are guaranteed unique.
3. Add a test: in web/src/store.test.ts add a case (or App.test.tsx if you assert via the [+] button) that performs add -> add -> removeSubgraph(middle) -> add and asserts new Set(subgraphs.map(s => s.name)).size === subgraphs.length (no duplicates). If you put the unique-name logic in App.tsx, drive it through the [+] button in App.test.tsx and assert the resulting store names are distinct.
4. Run: nix develop -c bash -c 'cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run'.
<!-- SECTION:PLAN:END -->
