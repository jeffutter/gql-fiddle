---
id: TASK-31
title: >-
  Fix validate_subgraph to accept federation SDL (support @link and other
  federation directives)
status: To Do
assignee: []
created_date: '2026-06-08 18:38'
labels:
  - bug
  - rust
  - validation
milestone: m-1
dependencies:
  - TASK-9
  - TASK-28
priority: high
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`validate_subgraph()` in `crates/gql-core/src/validate.rs` uses `apollo_compiler::Schema::parse_and_validate`, which is plain-GraphQL-aware only. It rejects valid federation SDL because it doesn't know about `@link`, `@key`, `@shareable`, `@external`, `@requires`, etc. Users see a spurious error like:

```
Error: cannot find directive `@link` in this document
╭─[ <inline>:1:15 ]
 1 │ extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", ...)
```

…even when the schema is perfectly valid federation subgraph SDL.

## Root Cause

`validate.rs:12` calls `Schema::parse_and_validate(sdl, "<inline>")`. This is a raw `apollo-compiler` call that knows nothing about the federation link spec, so any `@link`/`@key`/etc. directive is treated as undefined.

`compose.rs` already does the right thing: it calls `Subgraph::parse(&name, "", &sdl)` from `apollo_federation::subgraph::typestate`, which is federation-aware. `validate_subgraph` needs the same treatment.

## Fix

Replace the `Schema::parse_and_validate` call in `validate_subgraph` with a call to `Subgraph::parse` from `apollo_federation::subgraph::typestate` (already available via `apollo-federation = "=2.15.0"`). Extract position diagnostics from the federation error. If the federation error type does not expose structured line/col, fall back to a single diagnostic at line 1 col 1 with the full error message — this is still better than false-positive "directive not defined" noise on valid SDL.

**Key files:**
- `crates/gql-core/src/validate.rs` — the only file that needs changing
- `crates/gql-core/src/compose.rs` — reference: shows the correct `Subgraph::parse` call pattern

## Implementation Notes

- The subgraph name passed to `Subgraph::parse` can be a placeholder (e.g. `"<subgraph>"`) since we only care about diagnostics, not the composed output.
- The URL argument (second param) can be an empty string `""` as done in compose.rs.
- Existing tests in `validate.rs` (valid SDL, syntax errors, missing fields) must continue to pass — update them if the error shape changes, but do not weaken the assertions.
- Add at least one new test: a valid federation SDL with `extend schema @link(...)` that asserts zero diagnostics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Valid federation SDL (with @link, @key, @shareable, @external, @requires, @inaccessible) returns zero diagnostics
- [ ] #2 Invalid SDL that is also invalid as plain GraphQL (e.g. missing type, syntax error) still returns diagnostics with correct line/col
- [ ] #3 Plain (non-federation) SDL continues to validate correctly — valid plain SDL returns zero diagnostics, invalid returns errors
- [ ] #4 nix develop -c cargo test -p gql-core passes with no regressions
- [ ] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
