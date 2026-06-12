//! Snapshot tests for plan() output and DTO JSON shape stability.
//!
//! Each test calls `gql_core::plan()` with a composed supergraph and snapshots
//! the returned JSON string via insta to lock down the DTO wire format.

use insta::assert_snapshot;
use serde_json::Value;

/// Build a two-subgraph supergraph: `user` (User{id,name}) and `profile` (extends User with bio).
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
    let composed: Value = serde_json::from_str(&gql_core::compose(&input.to_string())).unwrap();
    assert!(
        composed["ok"].as_bool().unwrap_or(false),
        "composition failed"
    );
    composed["supergraph_sdl"].as_str().unwrap().to_string()
}

/// AC #1a: single-subgraph plan — query only touches the "user" subgraph → single Fetch node.
#[test]
fn plan_single_subgraph_fetch() {
    let sdl = compose_user_profile();
    let result = gql_core::plan(&sdl, "{ user(id: \"1\") { id name } }", None);
    assert_snapshot!(result);
}

/// AC #1b: multi-subgraph plan — `bio` lives on "profile", requiring Sequence+Flatten.
#[test]
fn plan_multi_subgraph_with_flatten() {
    let sdl = compose_user_profile();
    let result = gql_core::plan(&sdl, "{ user(id: \"1\") { id name bio } }", None);
    assert_snapshot!(result);
}

/// AC #2: DTO JSON round-trip — plan() output must survive parse→re-serialize unchanged.
///
/// PlanNode serializes through serde_json::Value (BTreeMap-sorted keys), so the output
/// is deterministic; byte-for-byte equality after a parse/re-serialize cycle confirms
/// the JSON shape is complete and stable.
#[test]
fn plan_json_round_trip() {
    let sdl = compose_user_profile();
    let json_str = gql_core::plan(&sdl, "{ user(id: \"1\") { id name bio } }", None);
    let value: Value = serde_json::from_str(&json_str).expect("plan() must emit valid JSON");
    let re_serialized = serde_json::to_string(&value).unwrap();
    assert_eq!(
        json_str, re_serialized,
        "plan JSON must survive parse/re-serialize unchanged"
    );
}
