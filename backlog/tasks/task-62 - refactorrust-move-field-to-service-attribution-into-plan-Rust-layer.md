---
id: TASK-62
title: 'refactor(rust): move field-to-service attribution into plan() Rust layer'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-17 04:31'
updated_date: '2026-06-17 12:00'
labels:
  - architecture
  - rust
  - wasm
  - planned
dependencies:
  - TASK-62.1
  - TASK-62.2
references:
  - web/src/planToFieldRanges.ts
  - crates/gql-core/src/plan.rs
  - crates/gql-core/src/dto.rs
  - web/src/core/types.ts
priority: medium
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`planToFieldRanges.ts` is the most complex analysis living in the web layer. It:
1. Re-parses every `Fetch` node's sub-operation string using `graphql-js`
2. Re-parses the original query using `graphql-js`
3. Detects entity fetches by inspecting `_entities` at the top level
4. Matches field names between sub-operations and the original query to determine which subgraph resolves each field
5. Extracts source positions (`loc.startToken.line`/`column`) for Monaco editor decorations

The Rust `plan.rs` already has both the full `ExecutableDocument` (parsed during planning) and every `Fetch` node's operation string in memory. The query planner itself knows which service resolves what — that information just isn't surfaced in the DTO.

## Goal

Annotate each `PlanNode::Fetch` in the DTO with `resolved_fields` so the web layer only handles Monaco editor decoration placement (a pure UI concern) rather than re-implementing field resolution logic.

## Shape of the change

**Rust side (`crates/gql-core/`):**
- Add `resolved_fields: Vec<ResolvedField>` to `PlanNode::Fetch` variant in `dto.rs`, where `ResolvedField` carries `{ field_path: String, type_name: Option<String> }`
- In `plan.rs` `map_fetch()`, walk the Fetch sub-operation AST to populate `resolved_fields`, detecting entity fetches via `_entities` and extracting inline fragment type conditions

**Web side (`web/src/`):**
- Update `core/types.ts` to add `resolvedFields` on the `Fetch` plan node type
- Refactor `planToFieldRanges.ts` to consume `resolvedFields` from the plan, removing all `graphql-js` re-parsing; only Monaco source-position decoration logic remains
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Orchestration Plan

This feature moves field-to-subgraph attribution from the web layer into the Rust WASM core so `planToFieldRanges.ts` stops re-parsing GraphQL sub-operations with `graphql-js`.

### Sub-tickets

| Ticket | Title | Status |
|--------|-------|--------|
| TASK-62.1 | refactor(rust): extend dto.rs and plan.rs to annotate PlanNode::Fetch with resolved_fields | To Do [planned] |
| TASK-62.2 | refactor(web): simplify planToFieldRanges.ts to consume resolved_fields, remove graphql-js re-parse | To Do [planned] |

### Execution order

1. **TASK-62.1 first** — adds `ResolvedField` struct to `dto.rs`, populates it in `map_fetch()` in `plan.rs`, rebuilds WASM. TASK-62.2 has a hard dependency on this ticket because it reads the new `resolved_fields` field from the plan JSON.

2. **TASK-62.2 second** — updates `core/types.ts` to reflect the new TS shape, refactors `planToFieldRanges.ts` to consume `resolved_fields` directly. After this ticket the second `graphql-js` parse pass on Fetch sub-operation strings is eliminated.

### Integration notes

- The WASM output shape gains a new optional key `resolved_fields` on Fetch nodes. Existing Fetch consumers (e.g. `planToMermaid.ts`, `planToTimeline.ts`) do not read this key and are unaffected.
- TASK-63 (not part of this feature) also depends on TASK-62.1 to extend the same `map_fetch()` pass to collect `entity_types`. Plan TASK-62.1 first, then TASK-63 can build on top without re-parsing sub-operations.
- The `walkSelectionSet()` function in `planToFieldRanges.ts` is deliberately left unchanged — it is still responsible for mapping field names to Monaco source positions, which is a pure web/UI concern.

### Final verification (after both sub-tickets are merged)

1. `cargo test -p gql-core` — all Rust tests pass
2. `pnpm typecheck` — no TypeScript errors
3. `pnpm test` — all web unit tests pass
4. Manual smoke test: multi-subgraph query with entity fetches shows correct Monaco field decorations
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Both sub-tasks completed. TASK-62.1 was already implemented (Rust dto.rs + plan.rs). TASK-62.2 implemented in this session: types.ts updated with resolved_fields field on Fetch PlanNode, planToFieldRanges.ts refactored to consume pre-computed resolved_fields instead of re-parsing sub-operation strings with graphql-js, test suite updated with resolved_fields fixtures and new entity fetch + graceful-degradation tests. All 195 web tests pass; tsc clean; 53 Rust tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved field-to-service attribution from the web layer into the pre-computed Rust WASM output. The Rust side already annotated each PlanNode::Fetch with resolved_fields in dto.rs/plan.rs. This session completed the web side: added resolved_fields to the TypeScript Fetch type, refactored planToFieldRanges.ts to read resolved_fields directly (removing all graphql-js sub-operation re-parsing and _entities detection heuristics), and updated tests with proper resolved_fields fixtures plus new coverage for entity fetches and graceful degradation.
<!-- SECTION:FINAL_SUMMARY:END -->
