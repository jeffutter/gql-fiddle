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
