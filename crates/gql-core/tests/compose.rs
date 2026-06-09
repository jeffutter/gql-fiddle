//! Golden (snapshot) tests for compose().
//!
//! Each test calls `gql_core::compose()` with raw JSON input matching the WASM
//! boundary contract and snapshots the returned JSON string via insta.

use gql_core::compose;
use insta::assert_snapshot;

// ---------------------------------------------------------------------------
// Success cases (3)
// ---------------------------------------------------------------------------

#[test]
fn two_subgraphs_independent_users_and_posts() {
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
                    me: User
                }

                type User @key(fields: "id") {
                    id: ID!
                    name: String
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

    let result = compose(&input.to_string());

    assert_snapshot!(result);
}

#[test]
fn three_subgraphs_users_posts_and_comments() {
    let input = serde_json::json!([
        {
            "name": "users",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    me: User
                }

                type User @key(fields: "id") {
                    id: ID!
                    name: String
                }
            "#
        },
        {
            "name": "posts",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
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
                    author: User
                }

                extend type User @key(fields: "id") {
                    id: ID! @external
                    posts: [Post]
                }
            "#
        },
        {
            "name": "comments",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    recentComments: [Comment]
                }

                type Comment @key(fields: "id") {
                    id: ID!
                    body: String
                    author: User
                    post: Post
                }

                extend type User @key(fields: "id") {
                    id: ID! @external
                    comments: [Comment]
                }

                extend type Post @key(fields: "id") {
                    id: ID! @external
                    comments: [Comment]
                }
            "#
        }
    ]);

    let result = compose(&input.to_string());

    assert_snapshot!(result);
}

#[test]
fn two_subgraphs_sharing_entity_via_key() {
    let input = serde_json::json!([
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
                    productBySku(sku: String!): Product
                }

                type Product @key(fields: "sku") {
                    sku: String!
                    name: String!
                    stockCount: Int!
                }
            "#
        },
        {
            "name": "pricing",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    productPrice(sku: String!): Price
                }

                type Price {
                    sku: String!
                    amount: Float!
                    currency: String!
                }

                extend type Product @key(fields: "sku") {
                    sku: String! @external
                    price(currency: String): Price
                }
            "#
        }
    ]);

    let result = compose(&input.to_string());

    assert_snapshot!(result);
}

// ---------------------------------------------------------------------------
// Error cases (4)
// ---------------------------------------------------------------------------

#[test]
fn entity_key_field_type_mismatch() {
    // Two subgraphs share an `Order` entity but define its `status` field with
    // incompatible types — one returns String, the other Int.  This exercises
    // FIELD_TYPE_MISMATCH at composition time.
    let input = serde_json::json!([
        {
            "name": "orders",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    order(id: ID!): Order
                }

                type Order @key(fields: "id") {
                    id: ID!
                    status: String
                }
            "#
        },
        {
            "name": "fulfillment",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    fulfillmentStatus(orderId: ID!): FulfillmentInfo
                }

                type FulfillmentInfo {
                    orderId: ID!
                    shipped: Boolean
                }

                extend type Order @key(fields: "id") {
                    id: ID! @external
                    status: Int
                }
            "#
        }
    ]);

    let result = compose(&input.to_string());

    assert_snapshot!(result);
}

#[test]
fn duplicate_query_field_without_shareable() {
    // Both subgraphs define Query.hello without @shareable.
    let input = serde_json::json!([
        {
            "name": "service-a",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    hello: String
                }

                type User @key(fields: "id") {
                    id: ID!
                }
            "#
        },
        {
            "name": "service-b",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    hello: String
                }

                type User @key(fields: "id") {
                    id: ID!
                }
            "#
        }
    ]);

    let result = compose(&input.to_string());

    assert_snapshot!(result);
}

#[test]
fn reference_to_missing_type() {
    // User references AddressType but no subgraph defines it.
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
                    me: User
                }

                type User @key(fields: "id") {
                    id: ID!
                    name: String
                    homeAddress: AddressType
                }
            "#
        }
    ]);

    let result = compose(&input.to_string());

    assert_snapshot!(result);
}

#[test]
fn invalid_federation_directive_on_query_root() {
    // Use @override pointing to a non-existent subgraph — this is an invalid
    // federation directive usage that should cause composition to fail.
    let input = serde_json::json!([
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
                    productBySku(sku: String!): Product
                }

                type Product @key(fields: "sku") {
                    sku: String!
                    name: String!
                    price: Float
                }
            "#
        },
        {
            "name": "pricing",
            "sdl": r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@override"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Product @key(fields: "sku") {
                    sku: String! @external
                    price: Float @override(from: "nonexistent_subgraph")
                }
            "#
        }
    ]);

    let result = compose(&input.to_string());

    assert_snapshot!(result);
}
