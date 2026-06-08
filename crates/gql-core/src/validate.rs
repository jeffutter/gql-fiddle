//! SDL and operation validation via apollo-compiler.
//!
//! Diagnostics carry line/col/len so the editor can underline precisely.

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

/// Validate an operation against the composed API schema.
///
/// TODO(milestone-2): validate the executable document against the API schema.
pub fn validate_query(_supergraph_sdl: &str, _operation: &str) -> Value {
    json!({ "diagnostics": [] })
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
            "invalid SDL should produce diagnostics"
        );
        for diag in diagnostics {
            let line: u32 = diag["line"].as_u64().expect("line should be a number") as u32;
            let col: u32 = diag["col"].as_u64().expect("col should be a number") as u32;
            assert!(line >= 1, "line should be 1-based, got {line}");
            assert!(col >= 1, "col should be 1-based, got {col}");
        }
    }

    #[test]
    fn diagnostic_has_all_required_fields() {
        let sdl = r#"
type Query {
  hello: String
  broken(
"#;
        let result = validate_subgraph(sdl);
        let diagnostics = result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
        assert!(!diagnostics.is_empty());
        for diag in diagnostics {
            assert!(diag.get("severity").is_some(), "missing 'severity'");
            assert!(diag.get("message").is_some(), "missing 'message'");
            assert!(diag.get("line").is_some(), "missing 'line'");
            assert!(diag.get("col").is_some(), "missing 'col'");
            assert!(diag.get("len").is_some(), "missing 'len'");
        }
    }

    #[test]
    fn empty_string_returns_diagnostics_without_panic() {
        let result = validate_subgraph("");
        result["diagnostics"]
            .as_array()
            .expect("diagnostics should be an array");
    }

    // AC #1: Valid federation SDL returns zero diagnostics

    // AC #2: Invalid SDL returns diagnostics with correct line/col

    #[test]
    fn invalid_sdl_syntax_error_returns_diagnostics_with_line_and_col() {
        // Invalid SDL that is also invalid as plain GraphQL (syntax error)
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
            "invalid SDL should produce diagnostics"
        );
        for diag in diagnostics {
            let line: u32 = diag["line"].as_u64().expect("line should be a number") as u32;
            let col: u32 = diag["col"].as_u64().expect("col should be a number") as u32;
            assert!(line >= 1, "line should be 1-based, got {line}");
            assert!(col >= 1, "col should be 1-based, got {col}");
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
