//! Derive the client-facing API schema from a composed supergraph SDL.

use apollo_federation::error::FederationError;
use apollo_federation::{ApiSchemaOptions, Supergraph};

/// Derive the client-facing API schema from a composed supergraph SDL.
///
/// Returns an SDL string -- matches the existing WASM boundary (all consumer
/// modules accept `&str` SDL) and avoids round-tripping through compiler types.
pub(crate) fn derive_api_schema(supergraph_sdl: &str) -> Result<String, FederationError> {
    let supergraph = Supergraph::new_with_router_specs(supergraph_sdl)?;
    let api_schema = supergraph.to_api_schema(ApiSchemaOptions::default())?;
    Ok(api_schema.schema().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compose::compose;
    use crate::dto::SubgraphInput;

    #[test]
    fn api_schema_excludes_federation_internals_and_keeps_user_types() {
        let products = SubgraphInput {
            name: "products".to_string(),
            sdl: r#"
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
                }
            "#
            .to_string(),
        };

        let reviews = SubgraphInput {
            name: "reviews".to_string(),
            sdl: r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    mostRecentReview: Review
                }

                type Review {
                    id: ID!
                    body: String
                    product: Product
                }

                type Product @key(fields: "id") {
                    id: ID!
                    reviews: [Review]
                }

                extend type User @key(fields: "id") {
                    id: ID! @external
                    reviews: [Review]
                }
            "#
            .to_string(),
        };

        let result = compose(&[products, reviews]);
        assert!(
            result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
            "compose should succeed"
        );
        let supergraph_sdl = result
            .get("supergraph_sdl")
            .and_then(|v| v.as_str())
            .expect("expected supergraph_sdl");

        let api_sdl =
            derive_api_schema(supergraph_sdl).expect("derive_api_schema should return Ok");

        assert!(
            !api_sdl.contains("@join__"),
            "should not contain @join__ directives"
        );
        assert!(
            !api_sdl.contains("_entities"),
            "should not contain _entities"
        );
        assert!(!api_sdl.contains("_Service"), "should not contain _Service");
        assert!(
            api_sdl.contains("User"),
            "should contain user-defined type User"
        );
    }
}
