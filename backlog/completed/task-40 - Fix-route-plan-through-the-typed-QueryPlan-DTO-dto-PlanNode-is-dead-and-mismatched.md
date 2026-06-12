---
id: TASK-40
title: >-
  Fix: route plan() through the typed QueryPlan DTO (dto::PlanNode is dead and
  mismatched)
status: Done
assignee: []
created_date: '2026-06-12 12:00'
updated_date: '2026-06-12 15:17'
labels:
  - review-followup
milestone: m-3
dependencies:
  - TASK-20
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-20 (crates/gql-core/src/plan.rs and src/dto.rs:17). plan() hand-builds serde_json::json! values for every node instead of routing through dto::PlanNode, which is marked #[expect(dead_code)] and never constructed. The struct also does not match the real output: it declares only Fetch/Sequence/Parallel/Flatten, yet plan() emits Subscription, Defer, and Condition kinds too, with different (camelCase) fields such as conditionVariable/ifBranch/elseBranch. So dto.rs module promise — a typed JS<->Rust boundary that never leaks apollo-federation internals — is unenforced for query plans, and the DTO is misleading dead weight (value < cost). Separately, TASK-20 was committed while still In Progress with AC#3 and AC#4 unchecked. Axes: Concise / Well organized / Clear. Note: TASK-21 (DTO round-trip tests) and TASK-22 (tree view) build on this shape, so it must be settled first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 dto::PlanNode is the single serialized type that plan() constructs (via serde_json::to_value), covering every kind plan() can emit: Fetch, Sequence, Parallel, Flatten, Subscription, Defer, Condition — OR the dead DTO is deleted and plan() keeps hand-built json! with a doc comment enumerating the kinds it emits. Pick the typed route unless it proves unreasonably large.
- [x] #2 No #[expect(dead_code)] or #[allow(dead_code)] remains on any plan DTO type
- [x] #3 The JSON keys the existing tests assert on are unchanged: plan_returns_ok_with_query_plan_tree and plan_multi_subgraph_yields_fetch_per_subgraph still pass without edits to their assertions
- [x] #4 nix develop -c cargo test -p gql-core passes and nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings is clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run "direnv allow" once, or prefix every command with "nix develop -c". Work from the repository root unless told otherwise. Do not change pinned dependency versions.

PREFERRED APPROACH (a) — make the typed DTO real:

1. Open crates/gql-core/src/dto.rs. Replace the current 4-variant PlanNode with one that covers every kind plan() emits. Keep #[serde(tag = "kind")]. Add variants mirroring plan.rs map_* output, preserving the exact JSON keys those functions currently produce so existing tests keep passing:
   - Fetch { service: String, #[serde(rename = "operation")] operation_str: String, operation_kind: String }
   - Sequence { nodes: Vec<PlanNode> }
   - Parallel { nodes: Vec<PlanNode> }
   - Flatten { path: Vec<String>, node: Box<PlanNode> }
   - Subscription { primary: Box<PlanNode>, #[serde(skip_serializing_if = "Option::is_none")] rest: Option<Box<PlanNode>> }
   - Defer { primary: Box<PlanNode-or-empty>, deferred: Vec<DeferredBranch> } (add a small DeferredBranch struct: { label: Option<String>, node: Box<PlanNode> })
   - Condition { #[serde(rename = "conditionVariable")] condition_variable: String, #[serde(rename = "ifBranch")] if_branch: Option<Box<PlanNode>>, #[serde(rename = "elseBranch")] else_branch: Option<Box<PlanNode>> }
   Remove the #[expect(dead_code)] attribute.

2. In crates/gql-core/src/plan.rs, change every map_* helper to return dto::PlanNode instead of serde_json::Value, and have the None / empty-node cases produce dto::PlanNode::Sequence { nodes: vec![] } (matches the current {"kind":"Sequence","nodes":[]} fallback at plan.rs:63). map_inner_node and the TopLevelPlanNode match in plan() return dto::PlanNode.

3. In plan(), build the envelope with serde_json::to_value(node): json!({ "ok": true, "query_plan": serde_json::to_value(node).unwrap_or(Value::Null) }). Do not introduce a bare unwrap that can panic on bad input — to_value on our own Serialize type cannot fail in practice, but prefer unwrap_or to honor the no-panic boundary rule (lib.rs module doc).

4. Confirm the existing plan.rs tests still pass unchanged (they assert kind/service/operation_kind/nodes). If a key name differs, fix the #[serde(rename)] in dto.rs — do not weaken the tests.

FALLBACK APPROACH (b) — only if (a) becomes unreasonably large: delete the dead PlanNode enum and its #[expect(dead_code)] from dto.rs entirely, and add a /// doc comment on plan() in plan.rs enumerating the node kinds it emits and their fields, so the JSON contract is documented in one place.

5. Run and confirm clean:
   - nix develop -c cargo test -p gql-core
   - nix develop -c cargo clippy -p gql-core --all-targets -- -D warnings
   - nix develop -c cargo fmt --check
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Expanded dto::PlanNode from a 4-variant dead stub to a complete 7-variant enum (Fetch, Sequence, Parallel, Flatten, Subscription, Defer, Condition) plus DeferredBranch. Removed #[expect(dead_code)]. Rewrote all map_* helpers in plan.rs to return dto::PlanNode instead of serde_json::Value; plan() now serializes via serde_json::to_value(node).unwrap_or(Value::Null). Also fixed a latent bug in map_subscription_node where the rest field was doubly-nested. All existing test assertions pass unchanged (JSON key names preserved via #[serde(rename)] attributes). All 37 unit + 11 integration tests pass; clippy -D warnings clean.
<!-- SECTION:FINAL_SUMMARY:END -->
