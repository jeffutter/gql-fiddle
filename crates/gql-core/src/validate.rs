//! SDL and operation validation via apollo-compiler.
//!
//! Diagnostics carry line/col/len so the editor can underline precisely.

use apollo_compiler::parser::LineColumn;
use apollo_compiler::validation::WithErrors;
use apollo_compiler::{ExecutableDocument, Schema};
use apollo_federation::subgraph::typestate::Subgraph;
use serde_json::{json, Value};

/// Validate one subgraph SDL. Returns `{ diagnostics: [...] }`.
///
/// Uses a two-phase approach to expose real line/col for syntax errors:
///
/// - **Phase 1 (syntax):** Parse with `apollo_compiler` using the same builder
///   flags as `Subgraph::parse` internally. `apollo_compiler` diagnostics carry
///   public location data, so real positions are reported and we return early.
/// - **Phase 2 (federation semantics):** Only reached when Phase 1 is clean.
///   `Subgraph::parse` location fields are `pub(crate)`, so federation semantic
///   errors still fall back to `(1, 1, 0)` — acceptable since they are rare and
///   not syntactic.
pub fn validate_subgraph(sdl: &str) -> Value {
    // Phase 1 — syntax check via apollo_compiler with federation-compatible flags.
    let build_result = Schema::builder()
        .adopt_orphan_extensions() // accept `extend schema @link(...)` without base def
        .ignore_builtin_redefinitions() // accept redefined built-in scalars
        .parse(sdl, "<subgraph>")
        .build();

    if let Err(with_errors) = build_result {
        let diagnostics: Vec<Value> = with_errors
            .errors
            .iter()
            .map(|diag| {
                let lc_range = diag.line_column_range().unwrap_or(
                    LineColumn { line: 1, column: 1 }..LineColumn { line: 1, column: 1 },
                );
                json!({
                    "severity": "error",
                    "message": diag.to_string(),
                    "line": lc_range.start.line,
                    "col": lc_range.start.column,
                    "len": lc_range.end.column.saturating_sub(lc_range.start.column),
                })
            })
            .collect();
        return json!({ "diagnostics": diagnostics });
    }

    // Phase 2 — federation semantic check (only reached when Phase 1 is clean).
    // Run the full single-subgraph pipeline: parse → expand_links → assume_upgraded → validate.
    // expand_links validates @key field-sets and unknown type references.
    // assume_upgraded is infallible (Expanded → Upgraded, no Result).
    // validate re-runs post-upgrade checks; benign on valid Fed v2 SDL.
    // SubgraphError location fields are pub(crate), so all semantic errors fall back to (1,1,0).
    let result = Subgraph::parse("<subgraph>", "", sdl)
        .and_then(|s| s.expand_links())
        .map(|s| s.assume_upgraded())
        .and_then(|s| s.validate());

    match result {
        Ok(_) => json!({ "diagnostics": [] }),
        Err(err) => {
            json!({ "diagnostics": [json!({
                "severity": "error",
                "message": err.to_string().trim().to_string(),
                "line": 1,
                "col": 1,
                "len": 0,
            })] })
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
            // The editor collapses a diagnostic to one line (endLineNumber == startLineNumber
            // in web/src/App.tsx:40-41), so len is a same-line column count. Multi-line spans
            // clamp to 0 to avoid unsigned underflow; saturating_sub guards any end<start case.
            // Mirrors the safe pattern already used in validate_subgraph (validate.rs:43).
            "len": if lc_range.end.line == lc_range.start.line {
                lc_range.end.column.saturating_sub(lc_range.start.column)
            } else {
                0
            },
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
        // Phase 1 (apollo_compiler) reports real positions for syntax errors.
        let sdl = r#"
type Query {
  hello: String
  broken(
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diagnostics.is_empty(),
            "invalid SDL should produce at least one diagnostic"
        );
        let first = &diagnostics[0];
        let line: u32 = first["line"].as_u64().expect("line should be a number") as u32;
        let col: u32 = first["col"].as_u64().expect("col should be a number") as u32;
        assert!(
            line > 1 || col > 1,
            "should report real position, not (1,1), got line={line} col={col}"
        );
    }

    #[test]
    fn diagnostic_has_all_required_fields() {
        // Same invalid SDL — first diagnostic must carry all required fields.
        let sdl = r#"
type Query {
  hello: String
  broken(
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diagnostics.is_empty(),
            "invalid SDL should produce at least one diagnostic"
        );
        let first = &diagnostics[0];
        // Assert required fields exist and are correctly typed.
        assert!(first.get("severity").is_some(), "missing 'severity'");
        assert!(first.get("message").is_some(), "missing 'message'");
        assert!(first.get("line").is_some(), "missing 'line'");
        assert!(first.get("col").is_some(), "missing 'col'");
        assert!(first.get("len").is_some(), "missing 'len'");
        assert!(
            first["severity"].is_string(),
            "'severity' should be a string"
        );
        assert!(first["message"].is_string(), "'message' should be a string");
        assert!(first["line"].is_u64(), "'line' should be a number");
        assert!(first["col"].is_u64(), "'col' should be a number");
        assert!(
            first["len"].is_u64() || first["len"].is_i64(),
            "'len' should be a number"
        );
    }

    #[test]
    fn empty_string_returns_diagnostics_without_panic() {
        // Empty input must not panic and must produce at least one error diagnostic.
        let result = validate_subgraph("");
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diagnostics.is_empty(),
            "empty SDL should produce at least one error diagnostic"
        );
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
    fn key_with_nonexistent_field_returns_diagnostic() {
        // AC#1: A subgraph with a @key pointing to a non-existent field shows an error marker.
        // The @link header is required to pass Phase 1 (syntax) so Phase 2 (semantic) is reached.
        let sdl = r#"
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) {
    query: Query
}
type Query { hello: String }
type User @key(fields: "nonExistent") { id: ID! }
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diagnostics.is_empty(),
            "SDL with @key pointing to non-existent field should produce diagnostics"
        );
        let first = &diagnostics[0];
        assert_eq!(
            first["severity"]
                .as_str()
                .expect("severity should be a string"),
            "error",
            "diagnostic severity should be 'error'"
        );
    }

    #[test]
    fn field_referencing_undefined_type_returns_diagnostic() {
        // AC#2: A subgraph with a field referencing an undefined type shows an error marker.
        // The @link header is required to pass Phase 1 (syntax) so Phase 2 (semantic) is reached.
        let sdl = r#"
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) {
    query: Query
}
type Query { hello: NonExistentType }
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diagnostics.is_empty(),
            "SDL with field referencing undefined type should produce diagnostics"
        );
    }

    #[test]
    fn cross_subgraph_concern_not_flagged_for_single_subgraph() {
        // AC#4: Cross-subgraph errors (e.g. @shareable conflicts between two subgraphs)
        // are structurally impossible to detect in a single validate_subgraph call.
        // A @shareable field that is valid standalone but would conflict when composed
        // with a second subgraph must NOT produce diagnostics here — that is the
        // composition error banner's responsibility.
        //
        // This test documents the scope limit: validate_subgraph only sees one subgraph,
        // so multi-subgraph conflicts can never be surfaced here.
        let sdl = r#"
extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"]) {
    query: Query
}
type Query {
    hello: String
}
type Product @key(fields: "id") {
    id: ID!
    name: String @shareable
    price: Float @shareable
}
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            diagnostics.is_empty(),
            "A valid single-subgraph SDL with @shareable fields should produce zero diagnostics; \
             cross-subgraph conflicts are out of scope for validate_subgraph. Got: {diagnostics:?}"
        );
    }

    #[test]
    fn multiline_diagnostic_span_does_not_underflow() {
        let supergraph_sdl = _compose_test_supergraph();
        let operation = "{\n  me {\n    id {\n      x\n    }\n  }\n}";
        let result = validate_query(&supergraph_sdl, operation);
        let diags = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(
            !diags.is_empty(),
            "invalid selection should produce diagnostics"
        );
        for d in diags {
            let len = d["len"].as_u64().expect("len should be a number");
            assert!(
                len <= operation.len() as u64,
                "len {len} must not exceed operation length {} (underflow/wrap regression)",
                operation.len()
            );
        }
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
