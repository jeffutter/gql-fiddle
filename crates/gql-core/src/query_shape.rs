//! Query-driven schema slice: computes the shape of a query's response fields.
//!
//! Mirrors the JavaScript `queryToQueryShape` function in
//! `web/src/queryToQueryShape.ts`. Given a clean API schema SDL (no federation
//! directives) and a query string, it returns the `QueryShapeTree` JSON that
//! the Query Shape tab displays.
//!
//! Uses the type annotations already computed by `ExecutableDocument::parse_and_validate`
//! rather than building a separate type map — each `Field` node carries a
//! `definition: Node<FieldDefinition>` link into the schema.

use apollo_compiler::executable::{Selection, SelectionSet};
use apollo_compiler::{ExecutableDocument, Schema};
use serde_json::{json, Value};

use crate::dto::{QueryShapeOperation, QueryShapeTree, SchemaTreeField};

/// Compute the query shape tree from an API schema SDL and a query string.
///
/// Returns `{ "operations": [] }` for empty, invalid SDL, or invalid query
/// inputs — never panics.
pub fn query_shape(api_schema_sdl: &str, query: &str) -> Value {
    if api_schema_sdl.is_empty() || query.trim().is_empty() {
        return json!({ "operations": [] });
    }

    // Parse the API schema (clean, no federation directives).
    let schema = match Schema::parse_and_validate(api_schema_sdl, "api.graphql") {
        Ok(s) => s,
        Err(_) => return json!({ "operations": [] }),
    };

    // Parse the query document against the schema.
    //
    // We use `parse` (not `parse_and_validate`) to match the JS `graphql.parse()`
    // behaviour: syntactically valid but semantically imperfect queries (e.g. a
    // mutation that omits a required argument) are still walked and displayed.
    // Validation-only errors do not prevent us from showing the operation shape.
    // Syntax errors (which `parse` does catch) return `{ "operations": [] }`.
    let doc = match ExecutableDocument::parse(&schema, query, "query.graphql") {
        Ok(d) => d,
        Err(_) => return json!({ "operations": [] }),
    };

    let mut operations: Vec<QueryShapeOperation> = Vec::new();

    // Named operations — IndexMap preserves document source order.
    for (name, op) in &doc.operations.named {
        let op_kind = op_kind_str(op.operation_type);
        let header = format!("{} {}", op_kind, name);
        let fields = build_shape_fields(&op.selection_set, &doc);
        operations.push(QueryShapeOperation { header, fields });
    }

    // Anonymous operation (if present).
    if let Some(anon) = &doc.operations.anonymous {
        let op_kind = op_kind_str(anon.operation_type);
        let fields = build_shape_fields(&anon.selection_set, &doc);
        operations.push(QueryShapeOperation {
            header: op_kind.to_string(),
            fields,
        });
    }

    let tree = QueryShapeTree { operations };
    serde_json::to_value(&tree).unwrap_or_else(|_| json!({ "operations": [] }))
}

/// Returns the lowercase operation keyword string for an operation type.
fn op_kind_str(op_type: apollo_compiler::executable::OperationType) -> &'static str {
    use apollo_compiler::executable::OperationType;
    match op_type {
        OperationType::Query => "query",
        OperationType::Mutation => "mutation",
        OperationType::Subscription => "subscription",
    }
}

/// Recursively build `SchemaTreeField` list from a selection set.
///
/// Mirrors `buildShapeFields` in `queryToQueryShape.ts`:
/// - Named field: uses the linked `FieldDefinition` for type metadata.
/// - Fragment spread: inlines the fragment's fields with no wrapper node.
/// - Inline fragment: emits a `"… on TypeName"` wrapper node (U+2026).
///
/// The `__typename` meta-field is handled specially to match the JS output
/// (`typeName: "__typename"`, `isList: false`, `isNonNull: false`).
fn build_shape_fields(
    selection_set: &SelectionSet,
    doc: &ExecutableDocument,
) -> Vec<SchemaTreeField> {
    let mut result = Vec::new();

    for selection in &selection_set.selections {
        match selection {
            Selection::Field(field) => {
                // Special case: __typename introspection meta-field.
                // The JS implementation doesn't find it in the typeMap, so it emits
                // typeName: "__typename" with isList/isNonNull both false.
                if field.name.as_str() == "__typename" {
                    result.push(SchemaTreeField {
                        field_name: "__typename".to_string(),
                        type_name: "__typename".to_string(),
                        is_list: false,
                        is_non_null: false,
                        is_leaf: true,
                        is_cycle_ref: false,
                        children: vec![],
                    });
                    continue;
                }

                let field_name = field.name.as_str().to_string();
                let type_name = field.definition.ty.inner_named_type().as_str().to_string();
                let is_list = field.definition.ty.is_list();
                let is_non_null = field.definition.ty.is_non_null();
                // In a validated document, leaf fields (scalar/enum) have empty selection
                // sets. Non-leaf fields (object/interface/union) always have selections.
                let is_leaf = field.selection_set.selections.is_empty();

                let children = if !is_leaf {
                    build_shape_fields(&field.selection_set, doc)
                } else {
                    vec![]
                };

                result.push(SchemaTreeField {
                    field_name,
                    type_name,
                    is_list,
                    is_non_null,
                    is_leaf,
                    is_cycle_ref: false,
                    children,
                });
            }

            Selection::FragmentSpread(spread) => {
                // Inline the named fragment's fields at this position — no wrapper node.
                // Mirrors the JS: `result.push(...inlined)`.
                if let Some(fragment) = doc.fragments.get(&spread.fragment_name) {
                    let inlined = build_shape_fields(&fragment.selection_set, doc);
                    result.extend(inlined);
                }
            }

            Selection::InlineFragment(inline) => {
                // Emit a "… on TypeName" wrapper node (U+2026 ellipsis).
                // The type name comes from the selection set's resolved type, which
                // equals the type condition if one was specified, or the enclosing type
                // if no condition was given.
                let type_name = inline.selection_set.ty.as_str().to_string();
                let children = build_shape_fields(&inline.selection_set, doc);
                result.push(SchemaTreeField {
                    field_name: format!("\u{2026} on {}", type_name),
                    type_name,
                    is_list: false,
                    is_non_null: false,
                    is_leaf: false,
                    is_cycle_ref: false,
                    children,
                });
            }
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn simple_sdl() -> &'static str {
        "type Query { hello: String }"
    }

    fn nested_sdl() -> &'static str {
        "type Query { user: User }
         type User { id: ID! name: String }"
    }

    fn list_sdl() -> &'static str {
        "type Query { products: [Product!]! }
         type Product { id: ID! name: String }"
    }

    fn union_sdl() -> &'static str {
        "type Query { search: SearchResult }
         union SearchResult = User | Post
         type User { id: ID! name: String }
         type Post { id: ID! title: String }"
    }

    fn mutation_sdl() -> &'static str {
        "type Query { user: User }
         type Mutation { createUser(name: String!): User }
         type User { id: ID! name: String }"
    }

    #[test]
    fn empty_sdl_returns_empty_operations() {
        let result = query_shape("", "{ hello }");
        assert_eq!(result["operations"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn empty_query_returns_empty_operations() {
        let result = query_shape(simple_sdl(), "");
        assert_eq!(result["operations"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn whitespace_only_query_returns_empty_operations() {
        let result = query_shape(simple_sdl(), "   \n  ");
        assert_eq!(result["operations"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn invalid_sdl_returns_empty_operations() {
        let result = query_shape("not valid SDL {{{", "{ hello }");
        assert_eq!(result["operations"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn invalid_query_returns_empty_operations() {
        let result = query_shape(simple_sdl(), "{ not valid {{{");
        assert_eq!(result["operations"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn simple_scalar_field_is_leaf_with_correct_type() {
        let result = query_shape(simple_sdl(), "{ hello }");
        let ops = result["operations"].as_array().unwrap();
        assert_eq!(ops.len(), 1);
        let fields = ops[0]["fields"].as_array().unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0]["fieldName"], "hello");
        assert_eq!(fields[0]["typeName"], "String");
        assert_eq!(fields[0]["isLeaf"], true);
        assert_eq!(fields[0]["isList"], false);
        assert_eq!(fields[0]["isNonNull"], false);
    }

    #[test]
    fn named_operation_produces_correct_header() {
        let result = query_shape(simple_sdl(), "query GetHello { hello }");
        let ops = result["operations"].as_array().unwrap();
        assert_eq!(ops[0]["header"], "query GetHello");
    }

    #[test]
    fn anonymous_operation_produces_bare_op_kind_header() {
        let result = query_shape(simple_sdl(), "{ hello }");
        let ops = result["operations"].as_array().unwrap();
        assert_eq!(ops[0]["header"], "query");
    }

    #[test]
    fn nested_object_field_has_children() {
        let result = query_shape(nested_sdl(), "{ user { id name } }");
        let ops = result["operations"].as_array().unwrap();
        let user = &ops[0]["fields"][0];
        assert_eq!(user["fieldName"], "user");
        assert_eq!(user["isLeaf"], false);
        let children = user["children"].as_array().unwrap();
        assert_eq!(children.len(), 2);
        assert_eq!(children[0]["fieldName"], "id");
        assert_eq!(children[0]["isNonNull"], true);
        assert_eq!(children[1]["fieldName"], "name");
    }

    #[test]
    fn list_field_has_correct_flags() {
        let result = query_shape(list_sdl(), "{ products { id } }");
        let products = &result["operations"][0]["fields"][0];
        assert_eq!(products["isList"], true);
        assert_eq!(products["isNonNull"], true);
        assert_eq!(products["typeName"], "Product");
    }

    #[test]
    fn typename_field_is_handled_as_leaf_with_special_type_name() {
        let result = query_shape(simple_sdl(), "{ __typename }");
        let field = &result["operations"][0]["fields"][0];
        assert_eq!(field["fieldName"], "__typename");
        assert_eq!(field["typeName"], "__typename");
        assert_eq!(field["isLeaf"], true);
        assert_eq!(field["isList"], false);
        assert_eq!(field["isNonNull"], false);
    }

    #[test]
    fn fragment_spread_is_inlined_without_wrapper_node() {
        let sdl = "type Query { user: User }
                   type User { id: ID! name: String email: String }";
        let query = "fragment UserFields on User { id name }
                     query GetUser { user { ...UserFields email } }";
        let result = query_shape(sdl, query);
        let user_fields = &result["operations"][0]["fields"][0]["children"];
        let names: Vec<&str> = user_fields
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["fieldName"].as_str().unwrap())
            .collect();
        // Fragment fields inlined — no "UserFields" wrapper node.
        assert!(names.contains(&"id"));
        assert!(names.contains(&"name"));
        assert!(names.contains(&"email"));
        assert!(!names.contains(&"UserFields"));
    }

    #[test]
    fn inline_fragment_emits_ellipsis_wrapper_node() {
        let query = "query Search { search { ... on User { id } ... on Post { id } } }";
        let result = query_shape(union_sdl(), query);
        let search_children = &result["operations"][0]["fields"][0]["children"];
        let names: Vec<&str> = search_children
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["fieldName"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"\u{2026} on User"));
        assert!(names.contains(&"\u{2026} on Post"));
    }

    #[test]
    fn multiple_named_operations_in_source_order() {
        let query = "query GetUser { user { id } }
                     mutation CreateUser { createUser { id } }";
        let result = query_shape(mutation_sdl(), query);
        let ops = result["operations"].as_array().unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0]["header"], "query GetUser");
        assert_eq!(ops[1]["header"], "mutation CreateUser");
    }

    #[test]
    fn alias_uses_field_name_not_alias_in_output() {
        let sdl = "type Query { user: User }\ntype User { id: ID! name: String }";
        // "me" is the alias; "user" is the field name.
        let result = query_shape(sdl, "{ me: user { id } }");
        let field = &result["operations"][0]["fields"][0];
        assert_eq!(field["fieldName"], "user");
    }
}
