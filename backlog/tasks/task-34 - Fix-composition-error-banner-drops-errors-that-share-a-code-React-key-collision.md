---
id: TASK-34
title: >-
  Fix: composition error banner drops errors that share a code (React key
  collision)
status: To Do
assignee: []
created_date: '2026-06-08 18:39'
labels:
  - review-followup
milestone: m-1
dependencies:
  - TASK-10
priority: high
ordinal: 120
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-10 (web/src/App.tsx:193-197). The error banner renders one <div> per composition error with key={e.code}. Federation composition routinely emits multiple errors with the SAME code (e.g. several SATISFIABILITY_ERROR or INVALID_FIELD_SHARING). Duplicate React keys make React drop/merge siblings, so not every error renders — violating TASK-10 AC#3 ('an error banner with each code and message'). Axis: Correct.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When compose() returns multiple errors sharing the same code, every error line is rendered in the banner
- [ ] #2 A new App.test.tsx case returns two errors with the same code and asserts both messages appear
- [ ] #3 nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run" passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. In web/src/App.tsx (around line 193-197), change the error banner map so the React key is stable and unique per position, not the code. Use the array index: 'compose.errors.map((e, i) => (<div key={i} ...>{`${e.code}: ${e.message}`}</div>))'. (Index keys are safe here because the list is fully replaced on each compose and never reordered in place.)
2. Add a test in web/src/App.test.tsx: make mockCompose return { ok: false, errors: [ { code: 'SATISFIABILITY_ERROR', message: 'first' }, { code: 'SATISFIABILITY_ERROR', message: 'second' } ] }, render, advance past the debounce, and assert BOTH screen.getByText(/first/) and screen.getByText(/second/) are present.
3. Run: nix develop -c bash -c 'cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run'.
<!-- SECTION:PLAN:END -->
