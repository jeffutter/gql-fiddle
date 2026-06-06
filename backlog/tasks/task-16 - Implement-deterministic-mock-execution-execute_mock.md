---
id: TASK-16
title: Implement deterministic mock execution (execute_mock)
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
labels: []
milestone: m-2
dependencies:
  - TASK-14
documentation:
  - backlog/docs/doc-1 - GraphQL-Playground-Design.md
priority: high
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the mock.rs stub. Walk the operation against the API schema and return fake but well-shaped data. The same schema+operation+seed MUST always produce identical data. There is NO plan/federated execution: resolve fields against the single API schema.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A valid query returns data shaped exactly like the selection set (all requested fields present, correctly nested)
- [ ] #2 Lists have length 3; non-null fields are never null; abstract types resolve to one allowed concrete type
- [ ] #3 @skip/@include are honored via variables
- [ ] #4 Two calls with identical schema+operation+seed return byte-identical JSON
- [ ] #5 nix develop -c cargo build passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Keep the signature: pub fn execute_mock(supergraph_sdl: &str, operation: &str, variables: &serde_json::Value, seed: u64) -> serde_json::Value
2. Derive the API schema. Parse the operation. Choose the operation to run (the named one if op_name-style selection applies; otherwise the single operation present).
3. Walk the selected operation's selection set against the schema and build "data":
   - Scalars: generate deterministically from a hash of (seed, field path string, field name). Map by type: Int -> small integer; Float -> a float; String -> "<FieldName> <n>"; Boolean -> true/false; ID -> a string id.
   - Enums: hash-pick one of the enum values.
   - Objects: recurse into the nested selection set.
   - Interfaces/unions: hash-pick ONE allowed concrete object type; set __typename if requested; resolve the matching selections.
   - Lists: fixed length of exactly 3 elements.
   - Nullability: NEVER put null where the schema says non-null. For nullable fields, always produce a value (do not randomly null).
   - Honor @skip(if:) and @include(if:) using the variables.
4. Return { "data": { ... }, "errors": [] } on success. If the operation cannot be parsed/validated, return { "data": null, "errors": [ { "message": "..." } ] }.
5. DETERMINISM: do not use any time-seeded or OS randomness. Use ONLY a hash of the inputs and the provided seed.
6. Build it. Real tests are a separate task.
<!-- SECTION:PLAN:END -->
