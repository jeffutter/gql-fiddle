---
id: TASK-35
title: >-
  Rebuild WASM after TASK-31 fix so editor stops flagging federation directives
  as errors
status: To Do
assignee: []
created_date: '2026-06-09 18:38'
labels:
  - bug
  - wasm
  - editor
milestone: m-1
dependencies:
  - TASK-31
priority: high
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The subgraph schema editor shows false-positive errors for valid federation directives:

```
Error: cannot find directive `@link` in this document
╭─[ <inline>:1:15 ]
 1 │ extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", ...)
```

Composition still succeeds — the error is only in the editor's inline markers.

## Root Cause

TASK-31 fixed `crates/gql-core/src/validate.rs` to use `Subgraph::parse` (federation-aware) instead of `Schema::parse_and_validate` (plain-GraphQL-only). However, the WASM binary at `web/src/wasm/` was never rebuilt after that commit (`928a783`). The directory is gitignored (`web/src/wasm/.gitignore` contains `*`), so the stale pre-fix binary persists locally.

The editor validation path in `web/src/App.tsx:96` calls `core.validateSubgraph(currentSdl)`, which runs the stale WASM and still produces the false-positive diagnostic. The composition path is unaffected because it was already using `Subgraph::parse`.

## Fix

Rebuild the WASM artifact from the updated Rust source:

```sh
# from the repo root, inside nix develop:
pnpm --filter web wasm
# or equivalently:
wasm-pack build crates/gql-core --target web --out-dir ../web/src/wasm
```

After rebuilding, adding `extend schema @link(...)` to the editor should produce zero diagnostics.

## Verification

1. Open the app
2. Type (or paste) federation SDL into a subgraph editor pane, e.g.:
   ```graphql
   extend schema
     @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
   { query: Query }
   type Query { hello: String }
   type User @key(fields: "id") { id: ID! }
   ```
3. Confirm no red squiggles appear under `@link` or `@key`
4. Confirm existing plain-SDL error detection still works (e.g., a syntax error like an unclosed brace still shows a diagnostic)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Valid federation SDL with @link, @key, @shareable, etc. shows no editor error markers
- [ ] #2 Plain invalid SDL (syntax error, missing type) still shows error markers in the editor
- [ ] #3 nix develop -c cargo test -p gql-core passes (no regressions from the already-fixed Rust code)
- [ ] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->
