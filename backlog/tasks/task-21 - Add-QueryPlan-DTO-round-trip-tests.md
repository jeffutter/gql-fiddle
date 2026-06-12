---
id: TASK-21
title: Add QueryPlan DTO round-trip tests
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 15:35'
labels:
  - planned
milestone: m-3
dependencies:
  - TASK-20
  - TASK-40
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: low
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ensure our QueryPlan DTO serializes to a stable shape (so the JS visualizer cannot silently break) and that plan() works for representative queries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Snapshots exist for a single-subgraph and a multi-subgraph plan
- [x] #2 A round-trip test guards the DTO JSON shape
- [x] #3 nix develop -c cargo test -p gql-core passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

## Context from research

- Public API: `gql_core::plan(supergraph_sdl: &str, operation: &str, op_name: Option<String>) -> String` (lib.rs:64) returns compact JSON.
- `gql_core::compose(subgraphs_json: &str) -> String` is available for building supergraph SDL in test setup.
- `insta = { version = "1", features = ["json"] }` is already in dev-dependencies (Cargo.toml:38).
- `dto::PlanNode` is a private module; integration tests must go through the public `plan()` API.
- Apollo versions are pinned exactly (`=2.15.0`), so snapshot output is stable.
- Follow the `tests/compose.rs` pattern: `use insta::assert_snapshot; assert_snapshot!(result);` where `result` is the String from `plan()`.
- Snapshots land in `tests/snapshots/plan__{test_name}.snap`.

## Step 1 — Create `crates/gql-core/tests/plan.rs`

Add a helper to build the two-subgraph supergraph used by all three tests:

```rust
fn compose_user_profile() -> String {
    let input = serde_json::json!([
        {
            "name": "user",
            "sdl": "type Query { user(id: ID!): User } type User @key(fields: \"id\") { id: ID!, name: String }"
        },
        {
            "name": "profile",
            "sdl": "extend type User @key(fields: \"id\") { id: ID!, bio: String }"
        }
    ]);
    let composed: serde_json::Value =
        serde_json::from_str(&gql_core::compose(&input.to_string())).unwrap();
    assert!(composed["ok"].as_bool().unwrap_or(false), "composition failed");
    composed["supergraph_sdl"].as_str().unwrap().to_string()
}
```

## Step 2 — Snapshot: single-subgraph plan (one Fetch)

```rust
#[test]
fn plan_single_subgraph_fetch() {
    let sdl = compose_user_profile();
    // Only requests fields from the "user" subgraph → single Fetch node
    let result = gql_core::plan(&sdl, "{ user(id: \"1\") { id name } }", None);
    assert_snapshot!(result);
}
```

Expected shape: `{"ok":true,"query_plan":{"kind":"Fetch","service":"user",...}}`

## Step 3 — Snapshot: multi-subgraph plan (Flatten + second Fetch)

```rust
#[test]
fn plan_multi_subgraph_with_flatten() {
    let sdl = compose_user_profile();
    // `bio` is on the "profile" subgraph → Sequence[Fetch(user), Flatten[Fetch(profile)]]
    let result = gql_core::plan(&sdl, "{ user(id: \"1\") { id name bio } }", None);
    assert_snapshot!(result);
}
```

Expected shape: `{"ok":true,"query_plan":{"kind":"Sequence","nodes":[{"kind":"Fetch","service":"user",...},{"kind":"Flatten","path":["user"],"node":{"kind":"Fetch","service":"profile",...}}]}}`

## Step 4 — Round-trip test (guards DTO JSON shape)

Serialize the plan JSON, parse back as `serde_json::Value`, re-serialize, and assert byte-for-byte equality. Because `PlanNode` serializes through `serde_json::Value` (which uses BTreeMap / sorted keys), the output is deterministic and re-serialization must produce the same string.

```rust
#[test]
fn plan_json_round_trip() {
    let sdl = compose_user_profile();
    let json_str = gql_core::plan(&sdl, "{ user(id: \"1\") { id name bio } }", None);
    let value: serde_json::Value =
        serde_json::from_str(&json_str).expect("plan() must emit valid JSON");
    let re_serialized = serde_json::to_string(&value).unwrap();
    assert_eq!(
        json_str, re_serialized,
        "plan JSON must survive parse/re-serialize unchanged"
    );
}
```

## Step 5 — Run tests and accept snapshots

```bash
nix develop -c cargo test -p gql-core plan
```

On first run, insta creates pending snapshots. Accept them:

```bash
nix develop -c cargo insta review  # accept both snapshots interactively
# or non-interactively:
nix develop -c cargo insta accept
```

Then re-run to confirm all tests pass:

```bash
nix develop -c cargo test -p gql-core
```

## Step 6 — Verify clippy clean

```bash
nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings
```
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created crates/gql-core/tests/plan.rs with three tests:\n- plan_single_subgraph_fetch: snapshots a single Fetch node (user subgraph only)\n- plan_multi_subgraph_with_flatten: snapshots Sequence[Fetch(user), Flatten[Fetch(profile)]]\n- plan_json_round_trip: parse/re-serialize round-trip equality check\n\nSnapshotted via assert_snapshot! using the existing insta dev-dep. Snapshots accepted at tests/snapshots/plan__*.snap. round_trip passed on first run (no snapshot needed). All 53 gql-core tests pass; clippy -D warnings clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created crates/gql-core/tests/plan.rs with 3 integration tests covering all ACs.\n\nFiles added:\n- crates/gql-core/tests/plan.rs\n- crates/gql-core/tests/snapshots/plan__plan_single_subgraph_fetch.snap\n- crates/gql-core/tests/snapshots/plan__plan_multi_subgraph_with_flatten.snap\n\nTests:\n1. plan_single_subgraph_fetch — queries only user-subgraph fields, snapshots the resulting single Fetch node (AC #1 single-subgraph)\n2. plan_multi_subgraph_with_flatten — queries user+profile fields, snapshots Sequence[Fetch(user), Flatten[Fetch(profile)]] (AC #1 multi-subgraph)\n3. plan_json_round_trip — calls plan(), parses JSON as Value, re-serializes, asserts byte-equality; guards DTO JSON shape stability without needing Deserialize on PlanNode (AC #2)\n\nAll 3 new tests pass. Full suite: 53 tests pass, 0 fail. Clippy -D warnings clean.
<!-- SECTION:FINAL_SUMMARY:END -->
