---
id: TASK-41
title: >-
  Fix: restore mock module privacy; test abstract types without widening the
  public API
status: To Do
assignee: []
created_date: '2026-06-12 12:01'
labels:
  - review-followup
milestone: m-2
dependencies:
  - TASK-17
priority: high
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-17 (crates/gql-core/src/lib.rs:16 and src/mock.rs). To cover abstract-type resolution, the commit changed "mod mock" to "pub mod mock" and "walk_selection_set" to "pub", exposing the internal 8-argument mock walker as part of the crate public API. The crate boundary is meant to be only the #[wasm_bindgen] wrappers (see the lib.rs module doc: "Internal logic lives in the sibling modules"), and the task plan explicitly forbade importing internal helpers from tests/. Abstract types cannot be expressed through compose(), but the correct way to cover them is a #[cfg(test)] unit test inside src/mock.rs (where internals are accessible), not a public-API widening. Axes: Well organized / Concise (information hiding).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 crates/gql-core/src/lib.rs declares "mod mock;" (private), not "pub mod mock;"
- [ ] #2 walk_selection_set is not pub (private, or pub(crate) at most); no internal mock helper is reachable from outside the crate, and crates/gql-core/tests/mock.rs no longer contains "use gql_core::mock"
- [ ] #3 The abstract-type coverage (an interface or union resolves to a valid concrete member via __typename) is preserved as a #[cfg(test)] unit test inside src/mock.rs
- [ ] #4 nix develop -c cargo test -p gql-core passes and nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings is clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run "direnv allow" once, or prefix every command with "nix develop -c". Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open crates/gql-core/tests/mock.rs. Delete the test fn ac2_abstract_types_resolve_to_valid_member (lines ~258-333) together with its "use gql_core::mock;" import and the other use lines local to that test (ExecutableDocument as ECExecDoc, Schema, serde_json::json) if they are no longer needed elsewhere in the file.

2. Open crates/gql-core/src/mock.rs. Inside the existing #[cfg(test)] mod tests block, add a unit test (e.g. abstract_type_resolves_to_valid_member) that reproduces the deleted coverage: build the same interface API schema (Query.node(id: ID!): Node; interface Node { id: ID! }; type User implements Node; type Product implements Node), parse the operation with __typename + inline fragments, call walk_selection_set directly (it is in-module here, no visibility change needed), and assert __typename is "User" or "Product". Follow the existing unit-test patterns already in this file.

3. Open crates/gql-core/src/lib.rs. Change "pub mod mock;" back to "mod mock;".

4. In crates/gql-core/src/mock.rs change "pub fn walk_selection_set" back to "fn walk_selection_set" (use pub(crate) only if another module actually calls it — verify with nix develop -c cargo build; walk_selection_set is used by the execute_mock path inside this crate, so it will not be dead).

5. Re-check dead-code: making mock private again may resurface an unused-code warning for op_count (the commit removed its #[expect(dead_code)]). If "nix develop -c cargo build -p gql-core" warns that op_count is never used, either delete op_count or restore #[expect(dead_code)] on it. Do not blanket-allow dead_code on the module.

6. Run and confirm clean:
   - nix develop -c cargo test -p gql-core
   - nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings
   - nix develop -c cargo fmt --check
<!-- SECTION:PLAN:END -->
