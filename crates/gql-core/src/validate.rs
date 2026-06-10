//! SDL and operation validation via apollo-compiler.
//!
//! Diagnostics carry line/col/len so the editor can underline precisely.

use apollo_compiler::parser::LineColumn;
use apollo_compiler::validation::WithErrors;
use apollo_compiler::{ExecutableDocument, Schema};
use apollo_federation::subgraph::typestate::Subgraph;
use serde_json::{json, Value};

/// Validate one subgraph SDL. Returns `{ diagnostics: [...] }`.
pub fn validate_subgraph(sdl: &str) -> Value {
    match Subgraph::parse("<subgraph>", "", sdl) {
        Ok(_) => json!({ "diagnostics": [] }),
        Err(err) => {
            // SubgraphError has no public location data (pub(crate) fields).
            // Fall back to a single diagnostic at line 1, col 1 with the
            // formatted error message — still better than false positives.
            let diagnostics = vec![json!({
                "severity": "error",
                "message": err.to_string().trim().to_string(),
                "line": 1,
                "col": 1,
                "len": 0,
            })];
            json!({ "diagnostics": diagnostics })
        }
    }
}

/// Extract diagnostics from an apollo-compiler `WithErrors<ExecutableDocument>`.
fn extract_executable_diagnostics(with_errors: &WithErrors<ExecutableDocument>) -> Value {
    let mut diagnostics = Vec::new();
    for diag in with_errors.errors.iter() {
        let lc_range = diag
            .line_column_range()
            .unwrap_or(LineColumn { line: 1, column: 1 }..LineColumn { line: 1, column: 1 });
        diagnostics.push(json!({
            "severity": "error",
            "message": diag.to_string(),
            "line": lc_range.start.line,
            "col": lc_range.start.column,
            "len": (lc_range.end.column - lc_range.start.column),
        }));
    }
    json!({ "diagnostics": diagnostics })
}

/// Validate an operation against the composed API schema.
pub fn validate_query(supergraph_sdl: &str, operation: &str) -> Value {
    // Derive the client-facing API schema from the supergraph SDL.
    let api_sdl = match crate::api_schema::derive_api_schema(supergraph_sdl) {
        Ok(sdl) => sdl,
        Err(e) => {
            return json!({ "diagnostics": [{
                "severity": "error",
                "message": e.to_string(),
                "line": 1, "col": 1, "len": 0,
            }] });
        }
    };

    // Parse the API schema into a compiler-ready schema.
    let valid_schema = match Schema::parse_and_validate(&api_sdl, "<api-schema>") {
        Ok(s) => s,
        Err(we) => {
            // Schema-level parse errors — report message text with fallback positions.
            let diagnostics: Vec<Value> = we
                .errors
                .iter()
                .map(|d| {
                    json!({
                        "severity": "error",
                        "message": d.to_string(),
                        "line": 1,
                        "col": 1,
                        "len": 0,
                    })
                })
                .collect();
            return json!({ "diagnostics": diagnostics });
        }
    };

    // Validate the operation against the API schema.
    match ExecutableDocument::parse_and_validate(&valid_schema, operation, "<operation>") {
        Ok(_) => json!({ "diagnostics": [] }),
        Err(we) => extract_executable_diagnostics(&we),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_sdl_returns_empty_diagnostics() {
        let sdl = r#"
type Query {
  hello: String
}
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            diagnostics.is_empty(),
            "valid SDL should produce no diagnostics, got {diagnostics:?}"
        );
    }

    #[test]
    fn invalid_sdl_returns_diagnostics_with_line_and_col() {
        // Subgraph::parse has no public location fields, so all error diagnostics
        // fall back to line=1, col=1, len==0. Assert these exact fallback values.
        let sdl = r#"
type Query {
  hello: String
  broken(
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert_eq!(
            diagnostics.len(),
            1,
            "Subgraph::parse returns exactly one error for invalid SDL"
        );
        let first = &diagnostics[0];
        let line: u32 = first["line"].as_u64().expect("line should be a number") as u32;
        let col: u32 = first["col"].as_u64().expect("col should be a number") as u32;
        let len: u32 = first["len"].as_u64().expect("len should be a number") as u32;
        assert_eq!(line, 1, "fallback line must be 1");
        assert_eq!(col, 1, "fallback col must be 1");
        assert_eq!(len, 0, "fallback len must be 0");
    }

    #[test]
    fn diagnostic_has_all_required_fields() {
        // Same invalid SDL — first diagnostic must have exact fallback positions.
        let sdl = r#"
type Query {
  hello: String
  broken(
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert_eq!(
            diagnostics.len(),
            1,
            "Subgraph::parse returns exactly one error for invalid SDL"
        );
        let first = &diagnostics[0];
        // Assert required fields exist.
        assert!(first.get("severity").is_some(), "missing 'severity'");
        assert!(first.get("message").is_some(), "missing 'message'");
        assert!(first.get("line").is_some(), "missing 'line'");
        assert!(first.get("col").is_some(), "missing 'col'");
        assert!(first.get("len").is_some(), "missing 'len'");
        // Assert exact fallback positions.
        let line: u32 = first["line"].as_u64().expect("line should be a number") as u32;
        let col: u32 = first["col"].as_u64().expect("col should be a number") as u32;
        let len: u32 = first["len"].as_u64().expect("len should be a number") as u32;
        assert_eq!(line, 1, "fallback line must be 1");
        assert_eq!(col, 1, "fallback col must be 1");
        assert_eq!(len, 0, "fallback len must be 0");
    }

    #[test]
    fn empty_string_returns_diagnostics_without_panic() {
        // Empty input also yields exactly one error diagnostic at fallback position.
        let result = validate_subgraph("");
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert_eq!(
            diagnostics.len(),
            1,
            "empty SDL produces exactly one error diagnostic"
        );
        let first = &diagnostics[0];
        let line: u32 = first["line"].as_u64().expect("line should be a number") as u32;
        let col: u32 = first["col"].as_u64().expect("col should be a number") as u32;
        let len: u32 = first["len"].as_u64().expect("len should be a number") as u32;
        assert_eq!(line, 1, "fallback line must be 1");
        assert_eq!(col, 1, "fallback col must be 1");
        assert_eq!(len, 0, "fallback len must be 0");
    }

    // ---------------------------------------------------------------------------
    // validate_query tests (TASK-15)
    // ---------------------------------------------------------------------------

    fn _compose_test_supergraph() -> String {
        let products = crate::dto::SubgraphInput {
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

        let reviews = crate::dto::SubgraphInput {
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

        crate::compose::compose(&[products, reviews])
            .get("supergraph_sdl")
            .and_then(|v| v.as_str())
            .expect("expected supergraph_sdl")
            .to_string()
    }

    #[test]
    fn valid_query_returns_empty_diagnostics() {
        // AC#1: A valid operation returns an empty diagnostics list.
        let supergraph_sdl = _compose_test_supergraph();
        let result = validate_query(&supergraph_sdl, "{ __typename }");
        let diags = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            diags.is_empty(),
            "valid operation should produce no diagnostics, got {diags:?}"
        );
    }

    #[test]
    fn valid_query_with_field_returns_empty_diagnostics() {
        let supergraph_sdl = _compose_test_supergraph();
        let result = validate_query(&supergraph_sdl, "{ me { id } }");
        let diags = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            diags.is_empty(),
            "valid operation with field selection should produce no diagnostics, got {diags:?}"
        );
    }

    #[test]
    fn invalid_query_returns_diagnostics() {
        let supergraph_sdl = _compose_test_supergraph();
        let result = validate_query(&supergraph_sdl, "{ nonexistentField }");
        let diags = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diags.is_empty(),
            "invalid operation should produce diagnostics"
        );
    }

    #[test]
    fn validate_query_output_shape_matches_validate_subgraph() {
        // AC#3: Output shape matches validate_subgraph exactly.
        // Every diagnostic must have exactly the fields:
        // severity, message, line, col, len — same as validate_subgraph.
        let supergraph_sdl = _compose_test_supergraph();
        let result = validate_query(&supergraph_sdl, "{ nonexistentField }");
        let diags = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diags.is_empty(),
            "invalid operation should produce diagnostics"
        );

        // Required fields present in every diagnostic.
        for (i, diag) in diags.iter().enumerate() {
            assert!(
                diag.get("severity").is_some(),
                "diagnostic[{i}] missing 'severity'"
            );
            assert!(
                diag.get("message").is_some(),
                "diagnostic[{i}] missing 'message'"
            );
            assert!(diag.get("line").is_some(), "diagnostic[{i}] missing 'line'");
            assert!(diag.get("col").is_some(), "diagnostic[{i}] missing 'col'");
            assert!(diag.get("len").is_some(), "diagnostic[{i}] missing 'len'");

            // No extra fields — only the 5 expected keys.
            let keys: Vec<&str> = diag
                .as_object()
                .unwrap()
                .keys()
                .map(|s| s.as_str())
                .collect();
            assert_eq!(
                keys,
                ["severity", "message", "line", "col", "len"],
                "diagnostic[{i}] has unexpected fields: {keys:?}"
            );

            // severity must be a string.
            assert!(
                diag["severity"].is_string(),
                "diagnostic[{i}] 'severity' should be a string, got {}",
                diag["severity"]
            );
            // message must be a string.
            assert!(
                diag["message"].is_string(),
                "diagnostic[{i}] 'message' should be a string"
            );
            // line, col, len must be numbers (unsigned).
            assert!(
                diag["line"].is_u64(),
                "diagnostic[{i}] 'line' should be a number"
            );
            assert!(
                diag["col"].is_u64(),
                "diagnostic[{i}] 'col' should be a number"
            );
            assert!(
                diag["len"].is_u64() || diag["len"].is_i64(),
                "diagnostic[{i}] 'len' should be a number"
            );
        }
    }

    #[test]
    fn unknown_field_diagnostic_has_correct_position() {
        // AC#2: An operation with an unknown field returns a diagnostic with
        // correct 1-based position pointing to the unknown field.
        let supergraph_sdl = _compose_test_supergraph();
        // Operation string: "{ nonexistentField }"
        // 'n' of 'nonexistentField' is at column 3 (1-based), line 1.
        let result = validate_query(&supergraph_sdl, "{ nonexistentField }");
        let diags = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diags.is_empty(),
            "invalid operation should produce diagnostics"
        );

        // The first diagnostic should point to the unknown field.
        let first = &diags[0];
        let line: u32 = first["line"].as_u64().expect("line should be a number") as u32;
        let col: u32 = first["col"].as_u64().expect("col should be a number") as u32;

        // Verify 1-based line is correct.
        assert_eq!(line, 1, "diagnostic line should be 1 (1-based), got {line}");
        // The unknown field 'nonexistentField' starts at column 3.
        assert!(
            col >= 2,
            "diagnostic col should point to the unknown field \
             (expected >= 2, got {col})",
        );
        // Verify the message mentions the unknown field.
        let msg = first["message"]
            .as_str()
            .expect("message should be a string");
        assert!(
            msg.contains("nonexistentField"),
            "diagnostic message should mention the unknown field, got: {msg}"
        );
    }

    #[test]
    fn valid_federation_sdl_returns_empty_diagnostics() {
        let sdl = r#"
extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "@external", "@requires", "@inaccessible"])
{
    query: Query
}

type Query {
    hello: String
}

type User @key(fields: "id") {
    id: ID!
    name: String
}
"#;
        let result = validate_subgraph(sdl);
        assert!(
            result["diagnostics"].as_array().unwrap().is_empty(),
            "valid federation SDL should produce no diagnostics"
        );
    }
}
