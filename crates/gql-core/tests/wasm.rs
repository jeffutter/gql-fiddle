//! Browser integration tests, run with `wasm-pack test --headless --chrome`.
//!
//! One smoke test per exported WASM function — proves each entry point compiles
//! to wasm32 and executes without trapping in a real browser. Behavioural
//! coverage lives in the native test suite; these tests only guard the WASM
//! boundary.
#![cfg(target_arch = "wasm32")]

use gql_core::{compose, execute_mock, node_at_position, plan, validate_query, validate_subgraph};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

/// Compose the two-subgraph fixture used across several tests and return the
/// supergraph SDL. Panics if composition fails so the calling test gets a clear
/// error message.
fn make_supergraph() -> String {
    let subgraphs = r#"[
        {
            "name": "products",
            "sdl": "extend schema @link(url: \"https://specs.apollo.dev/federation/v2.3\", import: [\"@key\"]) @link(url: \"https://specs.apollo.dev/join/v0.3\", for: EXECUTION) { query: Query } type Query { me: User } type User @key(fields: \"id\") { id: ID! name: String }"
        },
        {
            "name": "reviews",
            "sdl": "extend schema @link(url: \"https://specs.apollo.dev/federation/v2.3\", import: [\"@key\", \"@external\"]) @link(url: \"https://specs.apollo.dev/join/v0.3\", for: EXECUTION) { query: Query } type Query { mostRecentReview: Review } type Review { id: ID! body: String } extend type User @key(fields: \"id\") { id: ID! @external reviews: [Review] }"
        }
    ]"#;
    let result = compose(subgraphs);
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        val["ok"].as_bool().unwrap_or(false),
        "make_supergraph: composition failed: {result}"
    );
    val["supergraph_sdl"].as_str().unwrap().to_string()
}

// ---------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------

#[wasm_bindgen_test]
fn compose_two_valid_subgraphs_returns_ok_and_sdl() {
    let result = make_supergraph();
    assert!(
        result.contains("type Query"),
        "expected composed supergraph SDL to contain 'type Query', got: {result}"
    );
}

// ---------------------------------------------------------------------------
// validate_subgraph
// ---------------------------------------------------------------------------

#[wasm_bindgen_test]
fn validate_subgraph_valid_sdl_returns_empty_diagnostics() {
    let result = validate_subgraph("type Query { hello: String }");
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    let diagnostics = val["diagnostics"]
        .as_array()
        .expect("diagnostics must be an array");
    assert!(
        diagnostics.is_empty(),
        "valid SDL must produce no diagnostics, got: {diagnostics:?}"
    );
}

#[wasm_bindgen_test]
fn validate_subgraph_invalid_sdl_returns_diagnostics() {
    let result = validate_subgraph("type Query { broken(");
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    let diagnostics = val["diagnostics"]
        .as_array()
        .expect("diagnostics must be an array");
    assert!(
        !diagnostics.is_empty(),
        "invalid SDL must produce at least one diagnostic"
    );
}

// ---------------------------------------------------------------------------
// validate_query
// ---------------------------------------------------------------------------

#[wasm_bindgen_test]
fn validate_query_valid_operation_returns_empty_diagnostics() {
    let sdl = make_supergraph();
    let result = validate_query(&sdl, "{ me { id } }");
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    let diagnostics = val["diagnostics"]
        .as_array()
        .expect("diagnostics must be an array");
    assert!(
        diagnostics.is_empty(),
        "valid operation must produce no diagnostics, got: {diagnostics:?}"
    );
}

#[wasm_bindgen_test]
fn validate_query_unknown_field_returns_diagnostics() {
    let sdl = make_supergraph();
    let result = validate_query(&sdl, "{ nonexistentField }");
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    let diagnostics = val["diagnostics"]
        .as_array()
        .expect("diagnostics must be an array");
    assert!(
        !diagnostics.is_empty(),
        "unknown field must produce at least one diagnostic"
    );
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

#[wasm_bindgen_test]
fn plan_valid_operation_returns_ok_and_query_plan() {
    let sdl = make_supergraph();
    let result = plan(&sdl, "{ me { id name } }", None);
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        val["ok"].as_bool().unwrap_or(false),
        "plan must return ok:true for a valid operation, got: {result}"
    );
    assert!(
        val.get("query_plan").is_some(),
        "plan must include a query_plan key, got: {result}"
    );
}

// ---------------------------------------------------------------------------
// execute_mock
// ---------------------------------------------------------------------------

#[wasm_bindgen_test]
fn execute_mock_returns_data_envelope() {
    let sdl = make_supergraph();
    let result = execute_mock(&sdl, "{ me { id name } }", 42, "{}");
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(
        val.get("data").is_some(),
        "mock result must contain a data key, got: {result}"
    );
}

#[wasm_bindgen_test]
fn execute_mock_same_seed_is_deterministic() {
    let sdl = make_supergraph();
    let a = execute_mock(&sdl, "{ me { id name } }", 99, "{}");
    let b = execute_mock(&sdl, "{ me { id name } }", 99, "{}");
    assert_eq!(a, b, "same seed must produce identical output");
}

// ---------------------------------------------------------------------------
// node_at_position
// ---------------------------------------------------------------------------

#[wasm_bindgen_test]
fn node_at_position_field_line_returns_type_and_field_name() {
    // Line 2, col 3 lands on the `hello` field (1-based, Monaco convention).
    let sdl = "type Query {\n  hello: String\n}";
    let result = node_at_position(sdl, 2, 3);
    let val: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(
        val["typeName"], "Query",
        "expected typeName Query, got: {result}"
    );
    assert_eq!(
        val["fieldName"], "hello",
        "expected fieldName hello, got: {result}"
    );
}

#[wasm_bindgen_test]
fn node_at_position_whitespace_returns_null() {
    let sdl = "type Query {\n  hello: String\n}";
    let result = node_at_position(sdl, 3, 1);
    assert_eq!(result, "null", "closing brace position must return null");
}
