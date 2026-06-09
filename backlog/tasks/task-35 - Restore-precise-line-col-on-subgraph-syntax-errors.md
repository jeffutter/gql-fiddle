---
id: TASK-35
title: Restore precise line/col on subgraph syntax errors
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
priority: medium
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After the TASK-31 fix, all syntax errors in the subgraph editor show a squiggle at line 1, col 1 (a single character wide) regardless of where the actual error is. This is because `SubgraphError`'s location fields are `pub(crate)`, so `validate_subgraph` can't read them and falls back to `(1, 1, len=0)`.

## Root Cause

`crates/gql-core/src/validate.rs` calls `Subgraph::parse(...)` from `apollo_federation`. When that returns `Err(SubgraphError)`, the struct fields `SubgraphError.errors: Vec<SingleSubgraphError>` and `SingleSubgraphError.locations: Vec<Range<LineColumn>>` are both `pub(crate)` (in `apollo-federation-2.15.0/src/subgraph/mod.rs:335-348`), so our crate cannot read them.

## Fix: Two-phase parse

Replace the single `Subgraph::parse` call with a two-phase approach:

**Phase 1 — Syntax check via `apollo_compiler`:**
Parse the SDL with `apollo_compiler` using a builder that does NOT reject unknown directives (so federation directives don't re-introduce the original false-positive). The `apollo_compiler` `Diagnostic` type exposes public location data. If there are syntax errors, emit them with real line/col and return early.

**Phase 2 — Federation semantic check via `Subgraph::parse`:**
If Phase 1 is clean, run `Subgraph::parse` for federation-aware validation. Errors here still fall back to `(1, 1)` because of the `pub(crate)` issue, but federation errors are much rarer and usually semantic (not syntax), so the fallback is acceptable.

**Key reference files:**
- `crates/gql-core/src/validate.rs` — the only file that needs changing
- `apollo-federation-2.15.0/src/subgraph/mod.rs:400-415` — shows how `from_diagnostic_list` extracts locations from `DiagnosticList`, confirming `apollo_compiler` diagnostics do carry public location data
- The original TASK-27 implementation used `Schema::parse_and_validate` which had locations — study what it extracted before TASK-31 replaced it

**Note on `apollo_compiler` builder:** Use `Schema::builder().parse(...).build()` rather than `Schema::parse_and_validate(...)`. The `build()` step may return a result or accumulate diagnostics without rejecting unknown directives. Verify against the `apollo_compiler` API; `adopt_orphan_extensions()` is used in `apollo_federation`'s own `parse_and_expand` for this purpose.

## Acceptance Criteria
<!-- AC:BEGIN -->
- Syntax errors (unclosed brace, bad token, unterminated argument list) show squiggles at the correct line and column, not at (1, 1)
- Valid plain SDL returns zero diagnostics
- Valid federation SDL with `@link`, `@key`, etc. returns zero diagnostics (TASK-31 regression guard)
- `cargo test -p gql-core` passes with no regressions
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Syntax errors (unclosed brace, bad token, unterminated argument) show squiggles at the correct line and column, not hardcoded (1,1)
- [ ] #2 Valid plain SDL returns zero diagnostics
- [ ] #3 Valid federation SDL with @link, @key, @shareable etc. returns zero diagnostics (TASK-31 regression guard)
- [ ] #4 nix develop -c cargo test -p gql-core passes with no regressions
- [ ] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
