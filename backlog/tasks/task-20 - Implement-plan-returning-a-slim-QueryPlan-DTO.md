---
id: TASK-20
title: Implement plan() returning a slim QueryPlan DTO
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-3
dependencies:
  - TASK-14
documentation:
  - backlog/docs/doc-1 - GraphQL-Playground-Design.md
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the plan.rs stub. Produce the federation query plan for an operation and map it into OUR OWN small, stable JSON shape (do not expose apollo-federation internal types). Visualization only; not used to execute anything.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 plan() returns ok:true with a query_plan tree using only our node kinds (Fetch/Sequence/Parallel/Flatten)
- [ ] #2 A multi-subgraph query yields a plan with at least one Fetch per involved subgraph, each labeled with the subgraph name
- [ ] #3 No apollo-federation internal types appear in the JSON
- [ ] #4 nix develop -c cargo build passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Keep the signature: pub fn plan(supergraph_sdl: &str, operation: &str, op_name: Option<&str>) -> serde_json::Value
2. Build the query plan with the apollo-federation 2.15.0 query planner (read https://docs.rs/apollo-federation/2.15.0 for the planner entry point; it needs the composed supergraph and the operation).
3. Define our OWN DTO (serde Serialize structs in dto.rs) for plan nodes. Support these kinds: Fetch (subgraph name + the operation/selection text it sends), Sequence (ordered children), Parallel (children), Flatten (a path string + one child). Each node serializes with a "kind" field plus its data.
4. Map the planner output into this DTO and return { "ok": true, "query_plan": <node> }. On error return { "ok": false, "errors": [ { code, message } ] }.
5. Build. Tests are a separate task.
<!-- SECTION:PLAN:END -->
