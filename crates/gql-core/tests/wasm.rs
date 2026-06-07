//! Browser integration tests, run with `wasm-pack test --headless --chrome`.
//!
//! This is Spike 0's permanent home: it proves the crate not only compiles to
//! wasm32 but that the exports actually run in a real browser. Gated to wasm so
//! native `cargo test` skips it.
#![cfg(target_arch = "wasm32")]

use gql_core::compose;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
fn compose_two_valid_subgraphs_returns_ok_and_sdl() {
    // Two subgraphs sharing a User entity — same pair used in native tests
    // (crates/gql-core/src/compose.rs). Products defines the @key; reviews
    // extends it with @external.
    let subgraphs_json = r#"[
        {
            "name": "products",
            "sdl": "extend schema @link(url: \"https://specs.apollo.dev/federation/v2.3\", import: [\"@key\"]) @link(url: \"https://specs.apollo.dev/join/v0.3\", for: EXECUTION) { query: Query } type Query { me: User } type User @key(fields: \"id\") { id: ID! }"
        },
        {
            "name": "reviews",
            "sdl": "extend schema @link(url: \"https://specs.apollo.dev/federation/v2.3\", import: [\"@key\", \"@external\"]) @link(url: \"https://specs.apollo.dev/join/v0.3\", for: EXECUTION) { query: Query } type Query { mostRecentReview: Review } type Review { id: ID! body: String product: Product } type Product @key(fields: \"id\") { id: ID! reviews: [Review] } extend type User @key(fields: \"id\") { id: ID! @external reviews: [Review] }"
        }
    ]"#;

    let result = compose(subgraphs_json);

    // AC #1 — assert ok:true is present
    assert!(
        result.contains("\"ok\":true"),
        "expected ok:true in composition result, got: {}",
        result
    );

    // AC #1 — assert a token from the composed SDL (both subgraphs define Query)
    assert!(
        result.contains("type Query"),
        "expected composed supergraph SDL to contain 'type Query', got: {}",
        result
    );
}
