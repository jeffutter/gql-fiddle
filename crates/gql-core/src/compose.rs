//! Federation composition: subgraphs -> supergraph SDL.
//!
//! This is the only place federation logic runs. Wired to `apollo-federation`
//! in Spike 0.

use apollo_federation::composition::{compose as fed_compose, CompositionOptions};
use apollo_federation::error::{CompositionError, SubgraphLocation};
use apollo_federation::subgraph::typestate::Subgraph;
use serde_json::{json, Value};

use crate::dto::SubgraphInput;

/// Compose subgraphs into a supergraph SDL, or report composition errors.
pub fn compose(subgraphs: &[SubgraphInput]) -> Value {
    // Parse each subgraph SDL into apollo-federation's Subgraph<Initial>
    let mut fed_subgraphs = Vec::new();
    for sub in subgraphs {
        match Subgraph::parse(&sub.name, "", &sub.sdl) {
            Ok(fed) => fed_subgraphs.push(fed),
            Err(err) => {
                return json!({
                    "ok": false,
                    "errors": [{
                        "code": "INVALID_SUBGRAPH",
                        "message": format!("Subgraph '{}' failed to parse: {}", sub.name, err),
                        "locations": [],
                    }],
                });
            }
        }
    }

    // Run federation composition
    match fed_compose(fed_subgraphs, CompositionOptions::default()) {
        Ok(supergraph) => {
            let sdl = supergraph.schema().schema().to_string();
            let hints: Vec<Value> = supergraph
                .hints()
                .iter()
                .map(|h| {
                    json!({
                        "code": h.code(),
                        "message": h.message(),
                    })
                })
                .collect();
            json!({
                "ok": true,
                "supergraph_sdl": sdl,
                "hints": hints,
            })
        }
        Err(failure) => {
            let errors: Vec<Value> = failure
                .errors
                .iter()
                .map(composition_error_to_json)
                .collect();
            json!({
                "ok": false,
                "errors": errors,
            })
        }
    }
}

fn composition_error_to_json(err: &CompositionError) -> Value {
    let code = error_code(err);
    let message = format_error_message(err);
    let locations = error_locations(err);
    json!({
        "code": code,
        "message": message,
        "locations": locations,
    })
}

fn error_code(err: &CompositionError) -> String {
    match err {
        CompositionError::SubgraphError { .. } => "SUBGRAPH_ERROR".to_string(),
        CompositionError::MergeError { .. } => "MERGE_ERROR".to_string(),
        CompositionError::MergeValidationError { .. } => "MERGE_VALIDATION_ERROR".to_string(),
        CompositionError::ContextualArgumentNotContextualInAllSubgraphs { .. } => {
            "CONTEXTUAL_ARGUMENT_NOT_CONTEXTUAL".to_string()
        }
        CompositionError::EmptyMergedEnumType { .. } => "EMPTY_MERGED_ENUM_TYPE".to_string(),
        CompositionError::EnumValueMismatch { .. } => "ENUM_VALUE_MISMATCH".to_string(),
        CompositionError::ExternalArgumentTypeMismatch { .. } => {
            "EXTERNAL_ARGUMENT_TYPE_MISMATCH".to_string()
        }
        CompositionError::ExternalTypeMismatch { .. } => "EXTERNAL_TYPE_MISMATCH".to_string(),
        CompositionError::ExternalArgumentDefaultMismatch { .. } => {
            "EXTERNAL_ARGUMENT_DEFAULT_MISMATCH".to_string()
        }
        CompositionError::InvalidGraphQL { .. } => "INVALID_GRAPHQL".to_string(),
        CompositionError::InvalidGraphQLName(_) => "INVALID_GRAPHQL_NAME".to_string(),
        CompositionError::FromContextParseError { .. } => "FROM_CONTEXT_PARSE_ERROR".to_string(),
        CompositionError::UnsupportedSpreadDirective { .. } => {
            "UNSUPPORTED_SPREAD_DIRECTIVE".to_string()
        }
        CompositionError::DirectiveDefinitionInvalid { .. } => {
            "DIRECTIVE_DEFINITION_INVALID".to_string()
        }
        CompositionError::TypeDefinitionInvalid { .. } => "TYPE_DEFINITION_INVALID".to_string(),
        CompositionError::InterfaceObjectUsageError { .. } => {
            "INTERFACE_OBJECT_USAGE_ERROR".to_string()
        }
        CompositionError::InterfaceKeyMissingImplementationType { .. } => {
            "INTERFACE_KEY_MISSING_IMPLEMENTATION_TYPE".to_string()
        }
        CompositionError::TypeKindMismatch { .. } => "TYPE_KIND_MISMATCH".to_string(),
        CompositionError::ShareableHasMismatchedRuntimeTypes { .. } => {
            "SHAREABLE_HAS_MISMATCHED_RUNTIME_TYPES".to_string()
        }
        CompositionError::SatisfiabilityError { .. } => "SATISFIABILITY_ERROR".to_string(),
        CompositionError::MaxValidationSubgraphPathsExceeded { .. } => {
            "MAX_VALIDATION_SUBGRAPH_PATHS_EXCEEDED".to_string()
        }
        CompositionError::InternalError { .. } => "INTERNAL_ERROR".to_string(),
        CompositionError::ExternalArgumentMissing { .. } => "EXTERNAL_ARGUMENT_MISSING".to_string(),
        CompositionError::ExternalMissingOnBase { .. } => "EXTERNAL_MISSING_ON_BASE".to_string(),
        CompositionError::MergedDirectiveApplicationOnExternal { .. } => {
            "MERGED_DIRECTIVE_APPLICATION_ON_EXTERNAL".to_string()
        }
        CompositionError::LinkImportNameMismatch { .. } => "LINK_IMPORT_NAME_MISMATCH".to_string(),
        CompositionError::InvalidFieldSharing { .. } => "INVALID_FIELD_SHARING".to_string(),
        CompositionError::ExtensionWithNoBase { .. } => "EXTENSION_WITH_NO_BASE".to_string(),
        CompositionError::DirectiveCompositionError { .. } => {
            "DIRECTIVE_COMPOSITION_ERROR".to_string()
        }
        CompositionError::InconsistentInputObjectField { .. } => {
            "INCONSISTENT_INPUT_OBJECT_FIELD".to_string()
        }
        CompositionError::RequiredArgumentMissingInSomeSubgraph { .. } => {
            "REQUIRED_ARGUMENT_MISSING_IN_SOME_SUBGRAPH".to_string()
        }
        CompositionError::RequiredInputFieldMissingInSomeSubgraph { .. } => {
            "REQUIRED_INPUT_FIELD_MISSING_IN_SOME_SUBGRAPH".to_string()
        }
        CompositionError::EmptyMergedInputType { .. } => "EMPTY_MERGED_INPUT_TYPE".to_string(),
        CompositionError::InputFieldMergeFailed { .. } => "INPUT_FIELD_MERGE_FAILED".to_string(),
        CompositionError::FieldArgumentTypeMismatch { .. } => {
            "FIELD_ARGUMENT_TYPE_MISMATCH".to_string()
        }
        CompositionError::FieldTypeMismatch { .. } => "FIELD_TYPE_MISMATCH".to_string(),
        CompositionError::OverrideCollisionWithAnotherDirective { .. } => {
            "OVERRIDE_COLLISION_WITH_ANOTHER_DIRECTIVE".to_string()
        }
        CompositionError::OverrideFromSelfError { .. } => "OVERRIDE_FROM_SELF_ERROR".to_string(),
        CompositionError::OverrideLabelInvalid { .. } => "OVERRIDE_LABEL_INVALID".to_string(),
        CompositionError::OverrideOnInterface { .. } => "OVERRIDE_ON_INTERFACE".to_string(),
        CompositionError::OverrideSourceHasOverride { .. } => {
            "OVERRIDE_SOURCE_HAS_OVERRIDE".to_string()
        }
        CompositionError::QueryRootMissing { .. } => "QUERY_ROOT_MISSING".to_string(),
        CompositionError::ArgumentDefaultMismatch { .. } => "ARGUMENT_DEFAULT_MISMATCH".to_string(),
        CompositionError::InputFieldDefaultMismatch { .. } => {
            "INPUT_FIELD_DEFAULT_MISMATCH".to_string()
        }
        CompositionError::InterfaceFieldNoImplem { .. } => "INTERFACE_FIELD_NO_IMPLEM".to_string(),
    }
}

fn format_error_message(err: &CompositionError) -> String {
    match err {
        CompositionError::SubgraphError {
            subgraph, error, ..
        } => {
            format!("[{}] {}", subgraph, error)
        }
        _ => format!("{}", err),
    }
}

fn error_locations(err: &CompositionError) -> Value {
    match err {
        CompositionError::SubgraphError { locations, .. } => locations_to_json(locations),
        CompositionError::MergeError { locations, .. } => locations_to_json(locations),
        CompositionError::ContextualArgumentNotContextualInAllSubgraphs { locations, .. } => {
            locations_to_json(locations)
        }
        CompositionError::EmptyMergedEnumType { locations, .. } => locations_to_json(locations),
        CompositionError::InvalidFieldSharing { locations, .. } => locations_to_json(locations),
        CompositionError::ExtensionWithNoBase { locations, .. } => locations_to_json(locations),
        CompositionError::RequiredArgumentMissingInSomeSubgraph { locations, .. } => {
            locations_to_json(locations)
        }
        CompositionError::RequiredInputFieldMissingInSomeSubgraph { locations, .. } => {
            locations_to_json(locations)
        }
        CompositionError::EmptyMergedInputType { locations, .. } => locations_to_json(locations),
        CompositionError::InputFieldMergeFailed { locations, .. } => locations_to_json(locations),
        CompositionError::ArgumentDefaultMismatch { locations, .. } => locations_to_json(locations),
        CompositionError::InputFieldDefaultMismatch { locations, .. } => {
            locations_to_json(locations)
        }
        CompositionError::InterfaceFieldNoImplem { locations, .. } => locations_to_json(locations),
        _ => json!([]),
    }
}

fn locations_to_json(locations: &[SubgraphLocation]) -> Value {
    let locs: Vec<Value> = locations
        .iter()
        .map(|l| {
            json!({
                "subgraph": l.subgraph,
                "line": l.range.start.line,
                "col": l.range.start.column,
            })
        })
        .collect();
    if locs.is_empty() {
        json!([])
    } else {
        json!(locs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- AC #4: The UNIMPLEMENTED stub response is gone ----

    #[test]
    fn no_unimplemented_stub_response() {
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
            "#.to_string(),
        };

        let result = compose(&[products, reviews]);
        let json_str = serde_json::to_string(&result).unwrap();
        assert!(
            !json_str.to_lowercase().contains("unimplemented"),
            "compose must not return an UNIMPLEMENTED stub response"
        );
        assert!(
            !json_str.to_lowercase().contains("stub"),
            "compose must not contain a stub placeholder"
        );
    }

    #[test]
    fn two_valid_subgraphs_sharing_entity_compose_successfully() {
        // Two subgraphs sharing an `User` entity — one defines the key, the other extends it.
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
            "#.to_string(),
        };

        let result = compose(&[products, reviews]);
        assert!(
            result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
            "expected ok:true"
        );
        let sdl = result
            .get("supergraph_sdl")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(!sdl.is_empty(), "expected non-empty supergraph_sdl");
    }

    // ---- AC #3: Returned JSON keys exactly match the contract ----

    #[test]
    fn success_path_keys_match_contract() {
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
            "#.to_string(),
        };

        let result = compose(&[products, reviews]);

        // Success path must have exactly {ok, supergraph_sdl, hints}
        let keys: Vec<&str> = result
            .as_object()
            .expect("result should be an object")
            .keys()
            .map(|k| k.as_str())
            .collect();

        assert_eq!(
            keys,
            vec!["ok", "supergraph_sdl", "hints"],
            "success path must return exactly {{ok, supergraph_sdl, hints}}"
        );
    }

    #[test]
    fn error_path_keys_match_contract() {
        let shop = SubgraphInput {
            name: "shop".to_string(),
            sdl: r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    users: [String]
                }
            "#
            .to_string(),
        };

        let catalog = SubgraphInput {
            name: "catalog".to_string(),
            sdl: r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    users: [Int]
                }
            "#
            .to_string(),
        };

        let result = compose(&[shop, catalog]);

        // Error path must have exactly {ok, errors}
        let keys: Vec<&str> = result
            .as_object()
            .expect("result should be an object")
            .keys()
            .map(|k| k.as_str())
            .collect();

        assert_eq!(
            keys,
            vec!["ok", "errors"],
            "error path must return exactly {{ok, errors}}"
        );
    }

    #[test]
    fn incompatible_subgraphs_return_ok_false_with_errors() {
        // Two subgraphs with conflicting field types on the Query type —
        // one declares `users: [String]`, the other `users: [Int]`.
        let shop = SubgraphInput {
            name: "shop".to_string(),
            sdl: r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    users: [String]
                }
            "#
            .to_string(),
        };

        let catalog = SubgraphInput {
            name: "catalog".to_string(),
            sdl: r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                    @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
                {
                    query: Query
                }

                type Query {
                    users: [Int]
                }
            "#
            .to_string(),
        };

        let result = compose(&[shop, catalog]);
        assert!(
            !result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true),
            "expected ok:false for incompatible subgraphs"
        );
        let errors = result
            .get("errors")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            !errors.is_empty(),
            "expected at least one error when subgraphs cannot compose"
        );
    }
}
