//! Integration tests for mock execution (determinism + coverage).
//!
//! Each test calls `gql_core::execute_mock()` with a composed supergraph SDL
//! and snapshots or asserts on the returned JSON envelope.

use gql_core::{compose, execute_mock};
use insta::assert_snapshot;

// ---------------------------------------------------------------------------
// AC#1 — Determinism
// ---------------------------------------------------------------------------

#[test]
fn determinism_same_seed_identical_output() {
    // Compose two small subgraphs into a supergraph.
    let input = serde_json::json!([
        {
            "name": "users",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    user: User
                }

                type User @key(fields: "id") {
                    id: ID!
                    name: String
                    email: String
                }
            "#
        },
        {
            "name": "posts",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    topPosts: [Post]
                }

                type Post @key(fields: "id") {
                    id: ID!
                    title: String
                    body: String
                }
            "#
        }
    ]);

    let compose_result: serde_json::Value =
        serde_json::from_str(&compose(&input.to_string())).unwrap();
    let supergraph_sdl = compose_result["supergraph_sdl"]
        .as_str()
        .expect("compose should return supergraph_sdl");

    let operation = r#"
        query GetUser {
            user {
                id
                name
            }
        }
    "#;

    let seed = 42u64;

    // Run twice with identical inputs.
    let output_a = execute_mock(supergraph_sdl, operation, seed);
    let output_b = execute_mock(supergraph_sdl, operation, seed);

    // Parse both as JSON and assert they are equal.
    let val_a: serde_json::Value = serde_json::from_str(&output_a).unwrap();
    let val_b: serde_json::Value = serde_json::from_str(&output_b).unwrap();
    assert_eq!(val_a, val_b, "same seed must produce identical output");

    // Snapshot one result for regression tracking.
    assert_snapshot!(output_a);
}

// ---------------------------------------------------------------------------
// AC#2 — Nullability, list length, abstract types, @skip/@include
// ---------------------------------------------------------------------------

/// AC#2a: Non-null fields are never null in mock output.
#[test]
fn ac2_nullability_nonnull_fields_are_never_null() {
    // Compose two minimal subgraphs where EVERY field is non-null.
    let input = serde_json::json!([
        {
            "name": "users",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    user: User
                }

                type User @key(fields: "id") {
                    id: ID!
                    name: String!
                }
            "#
        },
        {
            "name": "products",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    product: Product
                }

                type Product @key(fields: "id") {
                    id: ID!
                    title: String!
                    price: Int!
                }
            "#
        }
    ]);

    let compose_result: serde_json::Value =
        serde_json::from_str(&compose(&input.to_string())).unwrap();
    let supergraph_sdl = compose_result["supergraph_sdl"]
        .as_str()
        .expect("compose should return supergraph_sdl");

    // Query ALL fields from both types.
    let operation = r#"
        query {
            user { id name }
            product { id title price }
        }
    "#;

    let output = execute_mock(supergraph_sdl, operation, 42);
    let result: serde_json::Value = serde_json::from_str(&output).expect("valid JSON envelope");
    let data = result["data"]
        .as_object()
        .expect("data should be an object");

    // Every field must have a non-null value.
    for (field, value) in data {
        match field.as_str() {
            "user" => {
                let user = value.as_object().expect("user is an object");
                for (k, v) in user {
                    assert!(!v.is_null(), "user.{k} must not be null (non-null type)");
                }
            }
            "product" => {
                let product = value.as_object().expect("product is an object");
                for (k, v) in product {
                    assert!(!v.is_null(), "product.{k} must not be null (non-null type)");
                }
            }
            _ => unreachable!("unexpected root field: {field}"),
        }
    }
}

/// AC#2b: List fields always have exactly 3 elements.
#[test]
fn ac2_list_fields_have_length_three() {
    // Two subgraphs each define a list field; the supergraph should merge them.
    let input = serde_json::json!([
        {
            "name": "catalog",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    items: [Item]
                }

                type Item @key(fields: "id") {
                    id: ID!
                    label: String
                }
            "#
        },
        {
            "name": "inventory",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    stockItems: [StockItem]
                }

                type StockItem @key(fields: "id") {
                    id: ID!
                    quantity: Int
                }
            "#
        }
    ]);

    let compose_result: serde_json::Value =
        serde_json::from_str(&compose(&input.to_string())).unwrap();
    let supergraph_sdl = compose_result["supergraph_sdl"]
        .as_str()
        .expect("compose should return supergraph_sdl");

    let operation = r#"
        query {
            items { id label }
            stockItems { id quantity }
        }
    "#;

    let output = execute_mock(supergraph_sdl, operation, 42);
    let result: serde_json::Value = serde_json::from_str(&output).expect("valid JSON envelope");
    let data = result["data"]
        .as_object()
        .expect("data should be an object");

    for field in ["items", "stockItems"] {
        let arr = data[field]
            .as_array()
            .unwrap_or_else(|| panic!("{field} should be an array"));
        assert_eq!(arr.len(), 3, "{field} must have exactly 3 elements");
    }
}

/// AC#2d: @skip/@include with literal boolean values are honored.
#[test]
fn ac2_skip_include_honored_via_literals() {
    // Minimal subgraph with multiple scalar fields.
    let input = serde_json::json!([
        {
            "name": "users",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    user: User
                }

                type User @key(fields: "id") {
                    id: ID!
                    name: String
                    email: String
                    age: Int
                }
            "#
        }
    ]);

    let compose_result: serde_json::Value =
        serde_json::from_str(&compose(&input.to_string())).unwrap();
    let supergraph_sdl = compose_result["supergraph_sdl"]
        .as_str()
        .expect("compose should return supergraph_sdl");

    // @skip(if: true) removes 'name'; @include(if: false) removes 'email'; 'age' always present.
    let operation_a = r#"
        query {
            user {
                name @skip(if: true)
                email @include(if: false)
                age
            }
        }
    "#;

    let output_a = execute_mock(supergraph_sdl, operation_a, 42);
    let result_a: serde_json::Value = serde_json::from_str(&output_a).expect("valid JSON envelope");
    let user_a = &result_a["data"]["user"];
    assert!(
        user_a.get("name").is_none(),
        "name must be absent when @skip(if: true)"
    );
    assert!(
        user_a.get("email").is_none(),
        "email must be absent when @include(if: false)"
    );
    assert!(
        user_a.get("age").is_some(),
        "age (no directive) must always appear"
    );

    // @skip(if: false) keeps 'name'; @include(if: true) keeps 'email'; all three present.
    let operation_b = r#"
        query {
            user {
                name @skip(if: false)
                email @include(if: true)
                age
            }
        }
    "#;

    let output_b = execute_mock(supergraph_sdl, operation_b, 42);
    let result_b: serde_json::Value = serde_json::from_str(&output_b).expect("valid JSON envelope");
    let user_b = &result_b["data"]["user"];
    assert!(
        user_b.get("name").is_some(),
        "name must appear when @skip(if: false)"
    );
    assert!(
        user_b.get("email").is_some(),
        "email must appear when @include(if: true)"
    );
    assert!(
        user_b.get("age").is_some(),
        "age (no directive) must always appear"
    );
}
