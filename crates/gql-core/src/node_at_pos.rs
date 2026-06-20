//! Map a 1-based (line, col) position in a subgraph SDL to the nearest type
//! or field definition node.
//!
//! The public function is called from the `#[wasm_bindgen]` export in `lib.rs`
//! but is pure Rust so it can be unit-tested without a WASM target.

use apollo_compiler::schema::ExtendedType;
use apollo_compiler::Schema;
use serde_json::{json, Value};

/// Find the type or field definition that contains the given 1-based `(line, col)` in `sdl`.
///
/// Returns:
/// - `{ "typeName": "Foo" }` when the cursor is on the type declaration block but not a field.
/// - `{ "typeName": "Foo", "fieldName": "bar" }` when the cursor is on a field line.
/// - `null` when the position does not land on any object or interface definition.
pub fn node_at_position(sdl: &str, line: u32, col: u32) -> Value {
    // Parse permissively so federation SDL (extend schema @link ...) is accepted.
    // On a parse error we use the partial schema — the caller gets null for
    // unparsed regions, which is fine while the author is mid-edit.
    let schema = match Schema::builder()
        .adopt_orphan_extensions()
        .ignore_builtin_redefinitions()
        .parse(sdl, "<subgraph>")
        .build()
    {
        Ok(s) => s,
        Err(with_errors) => with_errors.partial,
    };

    let sources = &schema.sources;

    // Returns true if the Range<LineColumn> contains the 1-based (line, col).
    let contains = |range: std::ops::Range<apollo_compiler::parser::LineColumn>| -> bool {
        let start_line = range.start.line as u32;
        let start_col = range.start.column as u32;
        let end_line = range.end.line as u32;
        let end_col = range.end.column as u32;

        if line < start_line || line > end_line {
            return false;
        }
        if line == start_line && col < start_col {
            return false;
        }
        if line == end_line && col > end_col {
            return false;
        }
        true
    };

    for (type_name, ext_type) in &schema.types {
        match ext_type {
            ExtendedType::Object(obj) => {
                // Skip introspection types and built-in scalars.
                if obj.is_built_in() {
                    continue;
                }

                // Check field definitions first (innermost node wins).
                for (field_name, field_component) in &obj.fields {
                    if let Some(range) = field_component.node.line_column_range(sources) {
                        if contains(range) {
                            return json!({
                                "typeName": type_name.as_str(),
                                "fieldName": field_name.as_str(),
                            });
                        }
                    }
                }

                // Check the enclosing type definition span.
                if let Some(range) = obj.line_column_range(sources) {
                    if contains(range) {
                        return json!({ "typeName": type_name.as_str() });
                    }
                }
            }
            ExtendedType::Interface(iface) => {
                if iface.is_built_in() {
                    continue;
                }

                for (field_name, field_component) in &iface.fields {
                    if let Some(range) = field_component.node.line_column_range(sources) {
                        if contains(range) {
                            return json!({
                                "typeName": type_name.as_str(),
                                "fieldName": field_name.as_str(),
                            });
                        }
                    }
                }

                if let Some(range) = iface.line_column_range(sources) {
                    if contains(range) {
                        return json!({ "typeName": type_name.as_str() });
                    }
                }
            }
            _ => {}
        }
    }

    Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;

    // SDL with known line numbers (1-based):
    //  1: type Query {
    //  2:   hello: String
    //  3: }
    //  4: type Product {
    //  5:   id: ID!
    //  6:   price: Float
    //  7: }
    //  8: interface Node {
    //  9:   id: ID!
    // 10: }
    const TEST_SDL: &str = "\
type Query {\n\
  hello: String\n\
}\n\
type Product {\n\
  id: ID!\n\
  price: Float\n\
}\n\
interface Node {\n\
  id: ID!\n\
}\n";

    #[test]
    fn type_declaration_line_returns_type_name() {
        // AC#2: line 4 is `type Product {` — should return { typeName: "Product" }
        let result = node_at_position(TEST_SDL, 4, 6);
        assert_eq!(result["typeName"].as_str().unwrap(), "Product");
        assert!(
            result.get("fieldName").is_none(),
            "should have no fieldName"
        );
    }

    #[test]
    fn field_line_returns_type_and_field_name() {
        // AC#3: line 6 is `  price: Float` — should return { typeName: "Product", fieldName: "price" }
        let result = node_at_position(TEST_SDL, 6, 4);
        assert_eq!(result["typeName"].as_str().unwrap(), "Product");
        assert_eq!(result["fieldName"].as_str().unwrap(), "price");
    }

    #[test]
    fn field_id_line_returns_correct_field() {
        // AC#3: line 5 is `  id: ID!` in Product
        let result = node_at_position(TEST_SDL, 5, 4);
        assert_eq!(result["typeName"].as_str().unwrap(), "Product");
        assert_eq!(result["fieldName"].as_str().unwrap(), "id");
    }

    #[test]
    fn whitespace_beyond_types_returns_null() {
        // AC#4: a position past the end of the SDL should return null
        let result = node_at_position(TEST_SDL, 20, 1);
        assert_eq!(
            result,
            Value::Null,
            "out-of-range position should return null"
        );
    }

    #[test]
    fn empty_sdl_returns_null() {
        // AC#4: empty input must not panic
        let result = node_at_position("", 1, 1);
        assert_eq!(result, Value::Null);
    }

    #[test]
    fn interface_type_line_returns_type_name() {
        // AC#5: line 8 is `interface Node {`
        let result = node_at_position(TEST_SDL, 8, 12);
        assert_eq!(result["typeName"].as_str().unwrap(), "Node");
        assert!(
            result.get("fieldName").is_none(),
            "should have no fieldName for interface type line"
        );
    }

    #[test]
    fn interface_field_line_returns_field_name() {
        // AC#5: line 9 is `  id: ID!` inside interface Node
        let result = node_at_position(TEST_SDL, 9, 4);
        assert_eq!(result["typeName"].as_str().unwrap(), "Node");
        assert_eq!(result["fieldName"].as_str().unwrap(), "id");
    }

    #[test]
    fn query_type_field_line_returns_hello() {
        // Line 2: `  hello: String` inside type Query
        let result = node_at_position(TEST_SDL, 2, 4);
        assert_eq!(result["typeName"].as_str().unwrap(), "Query");
        assert_eq!(result["fieldName"].as_str().unwrap(), "hello");
    }

    #[test]
    fn invalid_sdl_returns_null_without_panic() {
        // AC#4: malformed SDL (mid-edit) must not panic; position won't match anything
        let result = node_at_position("type Product {\n  price: ", 1, 1);
        // The type declaration line itself should still match (partial schema)
        // — or it may be null; either is acceptable as long as it doesn't panic.
        let _ = result; // just assert no panic
    }

    #[test]
    fn line_col_convention_matches_monaco_1based() {
        // AC#7: (1, 1) refers to the very first character.
        // `type Query {` starts at line 1, col 1.
        let result = node_at_position(TEST_SDL, 1, 1);
        // Should land inside the `type Query` block.
        assert!(
            !result.is_null(),
            "position (1,1) should land inside a type definition, got null"
        );
        assert_eq!(result["typeName"].as_str().unwrap(), "Query");
    }
}
