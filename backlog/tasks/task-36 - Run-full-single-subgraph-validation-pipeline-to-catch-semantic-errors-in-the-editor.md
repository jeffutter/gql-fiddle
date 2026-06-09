---
id: TASK-36
title: >-
  Run full single-subgraph validation pipeline to catch semantic errors in the
  editor
status: To Do
assignee: []
created_date: '2026-06-09 19:07'
labels:
  - bug
  - rust
  - validation
  - editor
milestone: m-1
dependencies:
  - TASK-31
  - TASK-35
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The subgraph editor shows no errors for SDL that is syntactically valid but semantically broken — e.g. a `@key` pointing to a non-existent field, a type using an undefined type as a field type, or invalid federation directive usage. These errors only surface in the Supergraph composition error banner.

## Root Cause

`validate_subgraph` in `crates/gql-core/src/validate.rs` only calls `Subgraph::parse(...)`, which is the first step of a three-stage typestate pipeline. The next two stages — `expand_links()` and `validate()` — perform federation semantic validation on the single subgraph and are never called.

The full pipeline (`parse` → `expand_links` → `validate`) is all public API in `apollo_federation::subgraph::typestate`. Running it would catch per-subgraph semantic errors before composition.

## Fix

In `validate_subgraph`, chain through the full pipeline:

```rust
Subgraph::parse("<subgraph>", "", sdl)
    .and_then(|s| s.expand_links())
    .and_then(|s| s.validate())
```

Each step returns `Result<Subgraph<NextState>, SubgraphError>`. Map `Err` cases the same way as today: fall back to `(line: 1, col: 1, len: 0)` with the error message (the `pub(crate)` field issue from TASK-35 applies here too — TASK-35 may improve location extraction for Phase 1 syntax errors, but semantic errors from `expand_links`/`validate` will still fall back until upstream exposes those fields).

**Key files:**
- `crates/gql-core/src/validate.rs` — the only file that needs changing
- `apollo-federation-2.15.0/src/subgraph/typestate.rs:322, 599` — `expand_links()` and `validate()` signatures
- `crates/gql-core/src/compose.rs` — reference for how the composition pipeline chains these steps

## Scope limit

Cross-subgraph errors (e.g. `@shareable` conflicts between two subgraphs, conflicting field return types) require multi-subgraph composition and cannot be surfaced here. Those belong in the composition error banner and are out of scope for this ticket.

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 A subgraph with a @key pointing to a non-existent field shows an error marker in the editor
- [ ] #2 A subgraph with a field referencing an undefined type shows an error marker in the editor
- [ ] #3 Valid federation SDL with @link, @key, @shareable etc. still returns zero diagnostics (TASK-31 regression guard)
- [ ] #4 Cross-subgraph errors (shareable conflicts, type mismatches across subgraphs) do NOT need to appear in the editor — only single-subgraph semantic errors are in scope
- [ ] #5 nix develop -c cargo test -p gql-core passes with no regressions
- [ ] #6 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
