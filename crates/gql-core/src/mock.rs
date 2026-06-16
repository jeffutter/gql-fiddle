//! Deterministic mock execution against the composed API schema.
//!
//! Plain single-schema GraphQL field-walker (no federated execution): derive
//! the API schema from the supergraph, then generate values per field from a
//! hash of `(seed, path, field)` so results are reproducible.

use apollo_compiler::executable::{self as exe, SelectionSet, Type};
use apollo_compiler::schema::NamedType;
use apollo_compiler::{ExecutableDocument as ECExecDoc, Name, Schema};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Mock-execute an operation. Deterministic in `seed`.
/// Variables are auto-generated from the operation's declared variable
/// definitions so callers never need to supply them manually.
pub(crate) fn execute_mock(supergraph_sdl: &str, operation: &str, seed: u64) -> Value {
    // Derive the API schema from the supergraph SDL.
    let api_sdl = match crate::api_schema::derive_api_schema(supergraph_sdl) {
        Ok(sdl) => sdl,
        Err(e) => {
            return json!({
                "data": null,
                "errors": [{ "message": e.to_string() }],
            });
        }
    };

    // Parse the API schema.
    let schema = match Schema::parse_and_validate(&api_sdl, "<api-schema>") {
        Ok(s) => s,
        Err(we) => {
            return json!({
                "data": null,
                "errors": we.errors.iter().map(|d| json!({ "message": d.to_string() })).collect::<Vec<_>>(),
            });
        }
    };

    // Parse and validate the operation.
    let doc = match ECExecDoc::parse_and_validate(&schema, operation, "<operation>") {
        Ok(d) => d,
        Err(we) => {
            return json!({
                "data": null,
                "errors": we.errors.iter().map(|d| json!({ "message": d.to_string() })).collect::<Vec<_>>(),
            });
        }
    };

    // Select the operation.
    let op = match select_operation(&doc) {
        Some(o) => o,
        None => {
            return json!({
                "data": null,
                "errors": [{ "message": "no operation found or ambiguous operations" }],
            });
        }
    };

    // Build variable definitions and auto-generate values from declared types.
    let var_defs: Vec<exe::VariableDefinition> =
        op.variables.iter().map(|v| (**v).clone()).collect();
    let variables = generate_variables(&schema, &var_defs, seed);
    let data = walk_selection_set(
        &schema,
        &doc,
        &op.selection_set,
        op.operation_type,
        &var_defs,
        &variables,
        seed,
        Vec::new(),
    );

    json!({ "data": data, "errors": [] })
}

/// Select the operation to execute from a parsed document.
fn select_operation(doc: &ECExecDoc) -> Option<&exe::Operation> {
    // Prefer anonymous (unnamed) operation if it exists and there are others.
    if let Some(anonymous) = &doc.operations.anonymous {
        if doc.operations.named.is_empty() {
            return Some(anonymous);
        }
        // If there's both anonymous and named, still pick anonymous (only one).
        if doc.operations.iter().count() == 1 {
            return Some(anonymous);
        }
    }
    // Single operation of any kind.
    let mut iter = doc.operations.iter();
    if let Some(op) = iter.next() {
        if iter.next().is_none() {
            return Some(op);
        }
    }
    // Multiple operations — fall back to anonymous, else ambiguous.
    doc.operations.anonymous.as_deref()
}

/// Walk a selection set and produce JSON values matching the shape.
#[expect(clippy::too_many_arguments)]
fn walk_selection_set(
    schema: &Schema,
    doc: &ECExecDoc,
    selection_set: &SelectionSet,
    parent_type: exe::OperationType,
    variable_definitions: &[exe::VariableDefinition],
    variables: &Value,
    seed: u64,
    path: Vec<String>,
) -> Value {
    let root_type_name = match parent_type {
        exe::OperationType::Query => "Query",
        exe::OperationType::Mutation => "Mutation",
        exe::OperationType::Subscription => "Subscription",
    };
    let root_named = Name::new(root_type_name).unwrap_or_else(|_| {
        // Fallback: construct from an already-validated name.
        Name::new("Query").expect("fallback Query name")
    });
    walk_fields(
        schema,
        doc,
        selection_set,
        &root_named,
        variable_definitions,
        variables,
        seed,
        path,
    )
}

/// Walk fields at a given object type.
#[expect(clippy::too_many_arguments)]
fn walk_fields(
    schema: &Schema,
    doc: &ECExecDoc,
    selection_set: &SelectionSet,
    object_type: &NamedType,
    variable_definitions: &[exe::VariableDefinition],
    variables: &Value,
    seed: u64,
    path: Vec<String>,
) -> Value {
    let mut result = serde_json::Map::new();

    for selection in &selection_set.selections {
        match selection {
            exe::Selection::Field(field) => {
                // Check @skip/@include directives.
                if should_skip_field(&field.directives, variable_definitions, variables) {
                    continue;
                }

                let response_key = field.response_key();
                let key_str = response_key.as_str();
                let mut field_path = path.clone();
                field_path.push(key_str.to_string());

                // Handle __typename.
                if field.name == "__typename" {
                    result.insert(key_str.to_string(), Value::String(object_type.to_string()));
                    continue;
                }

                // Look up the field definition in the schema object type.
                let value = if let Some(obj_type) = schema.get_object(object_type) {
                    if let Some(field_def) = obj_type.fields.get(&field.name) {
                        resolve_field(
                            schema,
                            doc,
                            &field_def.ty,
                            object_type,
                            &field.selection_set,
                            variable_definitions,
                            variables,
                            seed,
                            field_path,
                        )
                    } else {
                        json!(null)
                    }
                } else {
                    json!(null)
                };

                result.insert(key_str.to_string(), value);
            }
            exe::Selection::FragmentSpread(spread) => {
                if should_skip_field_from_directives(
                    &spread.directives,
                    variable_definitions,
                    variables,
                ) {
                    continue;
                }
                if let Some(fragment) = doc.fragments.get(&spread.fragment_name) {
                    let fragment_result = walk_fields(
                        schema,
                        doc,
                        &fragment.selection_set,
                        object_type,
                        variable_definitions,
                        variables,
                        seed,
                        path.clone(),
                    );
                    // Merge fragment fields into result.
                    for (k, v) in fragment_result.as_object().unwrap() {
                        result.insert(k.clone(), v.clone());
                    }
                }
            }
            exe::Selection::InlineFragment(inline_frag) => {
                if should_skip_field_from_directives(
                    &inline_frag.directives,
                    variable_definitions,
                    variables,
                ) {
                    continue;
                }
                // If there's a type condition, skip if it doesn't apply.
                let applies = inline_frag
                    .type_condition
                    .as_ref()
                    .is_none_or(|tc| *object_type == **tc);
                if applies {
                    let frag_result = walk_fields(
                        schema,
                        doc,
                        &inline_frag.selection_set,
                        object_type,
                        variable_definitions,
                        variables,
                        seed,
                        path.clone(),
                    );
                    for (k, v) in frag_result.as_object().unwrap() {
                        result.insert(k.clone(), v.clone());
                    }
                }
            }
        }
    }

    Value::Object(result)
}

/// Resolve a single field value based on its type.
#[expect(clippy::too_many_arguments)]
#[allow(clippy::only_used_in_recursion)]
fn resolve_field(
    schema: &Schema,
    doc: &ECExecDoc,
    field_type: &Type,
    parent_type: &NamedType,
    nested_selection: &SelectionSet,
    variable_definitions: &[exe::VariableDefinition],
    variables: &Value,
    seed: u64,
    path: Vec<String>,
) -> Value {
    // Unwrap NonNull and List wrappers to find the base type.
    let (base_type, is_list, inner_type) = unwrap_type(field_type);

    if is_list {
        // Lists always produce 3 elements per AC#2.
        let mut items = Vec::new();
        for i in 0..3 {
            let mut item_path = path.clone();
            item_path.push(i.to_string());
            let item_value = resolve_field(
                schema,
                doc,
                &inner_type,
                parent_type,
                nested_selection,
                variable_definitions,
                variables,
                seed,
                item_path,
            );
            items.push(item_value);
        }
        return Value::Array(items);
    }

    // Abstract type resolution: Union — hash-pick one concrete member.
    if let Some(union_type) = schema.get_union(&base_type) {
        let members: Vec<_> = union_type.members.iter().collect();
        let idx = (hash_path(seed, &path) as usize) % members.len();
        let concrete_type = members[idx].clone();
        return walk_fields(
            schema,
            doc,
            nested_selection,
            &concrete_type,
            variable_definitions,
            variables,
            seed,
            path,
        );
    }

    // Abstract type resolution: Interface — hash-pick one implementer.
    if schema.get_interface(&base_type).is_some() {
        let implementers = schema.implementers_map();
        if let Some(impl_set) = implementers.get(&base_type) {
            let impl_list: Vec<_> = impl_set.iter().collect();
            let idx = (hash_path(seed, &path) as usize) % impl_list.len();
            let concrete_type = impl_list[idx].clone();
            return walk_fields(
                schema,
                doc,
                nested_selection,
                &concrete_type,
                variable_definitions,
                variables,
                seed,
                path,
            );
        }
    }

    // Scalar types — generate deterministic values.
    match base_type.as_ref() {
        "String" => gen_string(&path, seed),
        "Int" => gen_int(&path, seed),
        "Float" => gen_float(&path, seed),
        "Boolean" => gen_bool(&path, seed),
        "ID" => gen_id(&path, seed),
        name if is_enum_type(schema, name) => gen_enum(schema, name, &path, seed),
        _ => {
            // Object type — recurse into nested selection.
            walk_fields(
                schema,
                doc,
                nested_selection,
                &base_type,
                variable_definitions,
                variables,
                seed,
                path,
            )
        }
    }
}

/// Unwrap Type wrappers (NonNull, List) to get the base NamedType.
/// Returns (base_type_name, is_list_flag, unwrapped_inner_type).
fn unwrap_type(field_type: &Type) -> (NamedType, bool, Type) {
    let mut current = field_type;
    let mut is_list = false;

    loop {
        match current {
            Type::NonNullNamed(_inner_name) => {
                // NonNullNamed wraps a Name directly (not a Type), so we've
                // reached the base type. Return it as Named for downstream use.
                return (
                    _inner_name.clone(),
                    is_list,
                    Type::Named(_inner_name.clone()),
                );
            }
            Type::List(inner) => {
                is_list = true;
                current = inner.as_ref();
            }
            Type::NonNullList(inner) => {
                is_list = true;
                current = inner.as_ref();
            }
            Type::Named(name) => {
                return (name.clone(), is_list, Type::Named(name.clone()));
            }
        }
    }
}

/// Check if a type name refers to an enum type in the schema.
fn is_enum_type(schema: &Schema, name: &str) -> bool {
    schema.get_enum(name).is_some()
}

/// Evaluate @skip/@include directives for a field node.
fn should_skip_field(
    directives: &exe::DirectiveList,
    variable_definitions: &[exe::VariableDefinition],
    variables: &Value,
) -> bool {
    // Check "include" first — if false, skip the field.
    if let Some(val) = directive_bool(directives, "include", variable_definitions, variables) {
        if !val {
            return true;
        }
    }
    // Check "skip" — if true, skip the field.
    if let Some(val) = directive_bool(directives, "skip", variable_definitions, variables) {
        if val {
            return true;
        }
    }
    false
}

/// Evaluate @skip/@include directives from a generic directive list.
fn should_skip_field_from_directives(
    directives: &exe::DirectiveList,
    variable_definitions: &[exe::VariableDefinition],
    variables: &Value,
) -> bool {
    if let Some(val) = directive_bool(directives, "include", variable_definitions, variables) {
        if !val {
            return true;
        }
    }
    if let Some(val) = directive_bool(directives, "skip", variable_definitions, variables) {
        if val {
            return true;
        }
    }
    false
}

/// Look up a directive's `if` argument and resolve it to a boolean.
fn directive_bool(
    directives: &exe::DirectiveList,
    name: &str,
    variable_definitions: &[exe::VariableDefinition],
    variables: &Value,
) -> Option<bool> {
    let dir = directives.iter().find(|d| d.name.as_str() == name)?;
    let arg = dir.arguments.iter().find(|a| a.name.as_str() == "if")?;
    resolve_value_to_bool(&arg.value, variable_definitions, variables)
}

/// Resolve an argument Value to a boolean.
fn resolve_value_to_bool(
    value: &exe::Value,
    variable_definitions: &[exe::VariableDefinition],
    variables: &Value,
) -> Option<bool> {
    match value {
        exe::Value::Boolean(b) => Some(*b),
        exe::Value::Enum(e) => Some(e.as_str() == "true"),
        exe::Value::Variable(name) => {
            // Look up the variable in variables JSON.
            if let Some(var_val) = variables.get(name.as_str()) {
                return var_val.as_bool();
            }
            // Check default value from variable definitions.
            for vd in variable_definitions {
                if vd.name.as_str() == name.as_str() {
                    if let Some(ref default) = &vd.default_value {
                        if let Some(b) = default.to_bool() {
                            return Some(b);
                        }
                    }
                }
            }
            // Default to false per the plan.
            Some(false)
        }
        _ => None,
    }
}

/// Auto-generate a variables map from the operation's declared variable
/// definitions. Each variable receives a synthetic value appropriate for its
/// type so `@skip`/`@include` directives behave sensibly without user input.
fn generate_variables(schema: &Schema, var_defs: &[exe::VariableDefinition], seed: u64) -> Value {
    let mut map = serde_json::Map::new();
    for vd in var_defs {
        let val = gen_value_for_type(schema, &vd.ty, &[vd.name.as_str().to_string()], seed);
        map.insert(vd.name.as_str().to_string(), val);
    }
    Value::Object(map)
}

/// Produce a synthetic value matching a variable's type.
fn gen_value_for_type(schema: &Schema, ty: &exe::Type, path: &[String], seed: u64) -> Value {
    match ty {
        exe::Type::NonNullNamed(name) | exe::Type::Named(name) => match name.as_str() {
            "Boolean" => json!(false),
            "Int" => gen_int(path, seed),
            "Float" => gen_float(path, seed),
            "String" => gen_string(path, seed),
            "ID" => gen_id(path, seed),
            other => {
                if is_enum_type(schema, other) {
                    gen_enum(schema, other, path, seed)
                } else {
                    json!(null)
                }
            }
        },
        exe::Type::NonNullList(inner) | exe::Type::List(inner) => {
            json!([gen_value_for_type(schema, inner, path, seed)])
        }
    }
}

/// Generate a deterministic Int value for a path.
fn gen_int(path: &[String], seed: u64) -> Value {
    let hash = hash_path(seed, path);
    let val = ((hash % 100) as i64) - 50; // range [-50, 49]
    json!(val)
}

/// Generate a deterministic Float value for a path.
fn gen_float(path: &[String], seed: u64) -> Value {
    let hash = hash_path(seed, path);
    let val = (hash as f64) / (u64::MAX as f64);
    json!(val)
}

/// Generate a deterministic String value for a path.
fn gen_string(path: &[String], seed: u64) -> Value {
    let hash = hash_path(seed, path);
    let hex = format!("{hash:016x}");
    json!(format!("{}_{}", &hex[..8], path.len()))
}

/// Generate a deterministic Boolean value for a path.
fn gen_bool(path: &[String], seed: u64) -> Value {
    let hash = hash_path(seed, path);
    json!(hash % 2 == 0)
}

/// Generate a deterministic ID value for a path.
fn gen_id(path: &[String], seed: u64) -> Value {
    let hash = hash_path(seed, path);
    let hex = format!("{hash:016x}");
    json!(format!("id-{}", &hex[..8]))
}

/// Generate a deterministic enum value for a path.
fn gen_enum(schema: &Schema, type_name: &str, path: &[String], seed: u64) -> Value {
    let hash = hash_path(seed, path);
    if let Some(enum_type) = schema.get_enum(type_name) {
        let idx = (hash as usize) % enum_type.values.len();
        if let Some(val) = enum_type.values.values().nth(idx) {
            return json!(val.value.as_str());
        }
    }
    json!("UNKNOWN")
}

/// Hash a (seed, path_segments) tuple using DefaultHasher.
fn hash_path(seed: u64, path: &[String]) -> u64 {
    let mut hasher = DefaultHasher::new();
    seed.hash(&mut hasher);
    for segment in path {
        segment.hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

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
                    name: String
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

    /// AC#1: A valid query returns data shaped exactly like the selection set
    /// (all requested fields present, correctly nested).
    #[test]
    fn valid_query_returns_data_shaped_like_selection_set() {
        let supergraph_sdl = _compose_test_supergraph();
        let result = execute_mock(&supergraph_sdl, "{ me { id name } }", 42);

        // Top-level data key must exist and errors must be empty.
        assert!(
            result.get("data").is_some(),
            "response must have 'data' key"
        );
        let errors = result.get("errors").and_then(|v| v.as_array());
        assert!(
            errors.map(|e| e.is_empty()).unwrap_or(true),
            "errors should be empty for valid query"
        );

        let data = result["data"]
            .as_object()
            .expect("data should be an object");

        // The root field 'me' must be present.
        assert!(
            data.contains_key("me"),
            "data must contain the 'me' field from the selection set"
        );

        let me = &data["me"];
        let me_obj = me.as_object().expect("me should be an object");

        // Fields requested inside 'me' must all be present.
        assert!(
            me_obj.contains_key("id"),
            "me must contain 'id' from the selection set"
        );
        assert!(
            me_obj.contains_key("name"),
            "me must contain 'name' from the selection set"
        );

        // Scalar values should be present (non-null for defined fields).
        assert!(
            me_obj["id"].is_string(),
            "id field should be a string (ID type)"
        );
        assert!(me_obj["name"].is_string(), "name field should be a string");
    }

    /// AC#1 variant: nested object fields are correctly nested.
    #[test]
    fn valid_query_with_nested_object_fields() {
        let supergraph_sdl = _compose_test_supergraph();
        let result = execute_mock(
            &supergraph_sdl,
            "{ mostRecentReview { id body product { id } } }",
            42,
        );

        assert!(result.get("data").is_some());
        let data = result["data"]
            .as_object()
            .expect("data should be an object");

        assert!(data.contains_key("mostRecentReview"));
        let review = data["mostRecentReview"]
            .as_object()
            .expect("review should be an object");

        assert!(review.contains_key("id"));
        assert!(review.contains_key("body"));
        assert!(review.contains_key("product"));

        let product = review["product"]
            .as_object()
            .expect("product should be an object");
        assert!(product.contains_key("id"));
    }

    #[test]
    fn ac2_lists_have_length_three() {
        // Use the existing composed supergraph which has list fields.
        let supergraph_sdl = _compose_test_supergraph();
        // The reviews field on Product is [Review] — a list.
        let result = execute_mock(
            &supergraph_sdl,
            "{ mostRecentReview { id body product { id reviews { id } } } }",
            42,
        );

        let data = result["data"]
            .as_object()
            .expect("data should be an object");
        let review = data["mostRecentReview"]
            .as_object()
            .expect("review should be an object");
        let product = review["product"]
            .as_object()
            .expect("product should be an object");
        let reviews = product["reviews"]
            .as_array()
            .expect("reviews should be an array");

        assert_eq!(
            reviews.len(),
            3,
            "list fields must always have exactly 3 elements (AC#2)"
        );
    }

    #[test]
    fn ac2_nonnull_fields_are_never_null() {
        // Use the existing composed supergraph — all scalar ID fields are non-null.
        let supergraph_sdl = _compose_test_supergraph();
        let result = execute_mock(
            &supergraph_sdl,
            "{ me { id } mostRecentReview { id body product { id reviews { id } } } }",
            42,
        );

        let data = result["data"]
            .as_object()
            .expect("data should be an object");

        // Query.me.id is non-null.
        assert!(
            data.get("me").is_some() && data["me"].get("id").is_some(),
            "non-null field 'me.id' must not be null"
        );

        // mostRecentReview.id is non-null.
        let review = data["mostRecentReview"]
            .as_object()
            .expect("review should be an object");
        assert!(
            review.get("id").is_some() && review["id"].is_string(),
            "non-null field 'review.id' must not be null"
        );

        // product.id is non-null.
        let product = review["product"]
            .as_object()
            .expect("product should be an object");
        assert!(
            product.get("id").is_some() && product["id"].is_string(),
            "non-null field 'product.id' must not be null"
        );

        // reviews is a non-null list (from schema: [Review]) — check length 3.
        let reviews = product["reviews"]
            .as_array()
            .expect("reviews should be an array");
        assert_eq!(reviews.len(), 3, "list must have exactly 3 elements");
    }

    /// AC#2: Union types resolve to one allowed concrete member.
    #[test]
    fn ac2_union_resolves_to_one_concrete_type() {
        // Build a plain (non-federated) API schema with union type.
        let api_sdl = r#"
            type Query {
                search(term: String!): [SearchResult]!
            }

            union SearchResult = User | Product

            type User {
                id: ID!
                name: String
            }

            type Product {
                id: ID!
                title: String
            }
        "#;
        let schema = Schema::parse_and_validate(api_sdl, "<abstract-type-schema>")
            .expect("schema should parse");

        // Parse the operation against this plain API schema.
        let op_sdl = r#"
            query($term: String!) {
                search(term: $term) {
                    __typename
                    ... on User { id name }
                    ... on Product { id title }
                }
            }
        "#;
        let doc = ECExecDoc::parse_and_validate(&schema, op_sdl, "<abstract-type-query>")
            .expect("operation should parse against abstract type schema");

        // Walk the selection set starting from Query.
        let operation = doc.operations.anonymous.as_ref().expect("anonymous op");

        let data = walk_selection_set(
            &schema,
            &doc,
            &operation.selection_set,
            exe::OperationType::Query,
            &[],
            &json!({ "term": "test" }),
            42,
            vec!["search".to_string()],
        );

        let search_arr = data
            .as_object()
            .and_then(|o| o.get("search"))
            .and_then(|v| v.as_array())
            .expect("search should be an array");

        assert_eq!(
            search_arr.len(),
            3,
            "list from union field must have length 3"
        );
        for (i, item) in search_arr.iter().enumerate() {
            let obj = item
                .as_object()
                .expect("union member must resolve to an object");
            let typename = obj["__typename"]
                .as_str()
                .expect("__typename must be present on union member");
            assert!(
                typename == "User" || typename == "Product",
                "union SearchResult at index {i} should resolve to User or Product, got {typename}"
            );
        }
    }

    /// AC#2: Interface types resolve to one allowed implementing type.
    #[test]
    fn ac2_interface_resolves_to_one_concrete_type() {
        // Build a plain (non-federated) API schema with interface type.
        let api_sdl = r#"
            type Query {
                node(id: ID!): Node
            }

            interface Node {
                id: ID!
            }

            type User implements Node {
                id: ID!
                name: String
            }

            type Product implements Node {
                id: ID!
                title: String
            }
        "#;
        let schema = Schema::parse_and_validate(api_sdl, "<abstract-type-schema>")
            .expect("schema should parse");

        let op_sdl = r#"
            query($id: ID!) {
                node(id: $id) {
                    __typename
                    ... on User { name }
                    ... on Product { title }
                }
            }
        "#;
        let doc = ECExecDoc::parse_and_validate(&schema, op_sdl, "<abstract-type-query>")
            .expect("operation should parse against abstract type schema");

        let operation = doc.operations.anonymous.as_ref().expect("anonymous op");

        let data = walk_selection_set(
            &schema,
            &doc,
            &operation.selection_set,
            exe::OperationType::Query,
            &[],
            &json!({ "id": "1" }),
            42,
            vec!["node".to_string()],
        );

        let node_obj = data
            .as_object()
            .and_then(|o| o.get("node"))
            .and_then(|v| v.as_object())
            .expect("node should resolve to an object");

        let typename = node_obj["__typename"]
            .as_str()
            .expect("__typename must be present on interface resolution");
        assert!(
            typename == "User" || typename == "Product",
            "interface Node should resolve to User or Product, got {typename}"
        );
    }

    /// AC#3: @skip/@include directives are honored via variables.
    #[test]
    fn ac3_skip_include_honored_via_variables() {
        // Plain schema with multiple fields to test skip/include independently.
        let api_sdl = r#"
            type Query {
                user: User
            }

            type User {
                name: String
                email: String
                age: Int
            }
        "#;
        let schema = Schema::parse_and_validate(api_sdl, "<skip-include-schema>")
            .expect("schema should parse");

        // Use @skip and @include with variable arguments.
        let op_sdl = r#"
            query($skip: Boolean!, $include: Boolean!) {
                user {
                    name @skip(if: $skip)
                    email @include(if: $include)
                    age
                }
            }
        "#;
        let doc = ECExecDoc::parse_and_validate(&schema, op_sdl, "<skip-include-op>")
            .expect("operation should parse");

        let operation = doc.operations.anonymous.as_ref().expect("anonymous op");

        // Case A: $skip=true -> name is skipped; $include=false -> email is skipped.
        // Only 'age' should appear.
        let data_a = walk_selection_set(
            &schema,
            &doc,
            &operation.selection_set,
            exe::OperationType::Query,
            &[],
            &json!({ "skip": true, "include": false }),
            42,
            vec!["user".to_string()],
        );

        let user_a = data_a
            .as_object()
            .and_then(|o| o.get("user"))
            .and_then(|v| v.as_object())
            .expect("user should be an object");

        assert!(
            !user_a.contains_key("name"),
            "name should be skipped when $skip=true"
        );
        assert!(
            !user_a.contains_key("email"),
            "email should be skipped when $include=false"
        );
        assert!(
            user_a.contains_key("age"),
            "age (no directive) must always appear"
        );

        // Case B: $skip=false -> name is NOT skipped; $include=true -> email IS included.
        // All three fields should appear.
        let data_b = walk_selection_set(
            &schema,
            &doc,
            &operation.selection_set,
            exe::OperationType::Query,
            &[],
            &json!({ "skip": false, "include": true }),
            42,
            vec!["user".to_string()],
        );

        let user_b = data_b
            .as_object()
            .and_then(|o| o.get("user"))
            .and_then(|v| v.as_object())
            .expect("user should be an object");

        assert!(
            user_b.contains_key("name"),
            "name must appear when $skip=false"
        );
        assert!(
            user_b.contains_key("email"),
            "email must appear when $include=true"
        );
        assert!(
            user_b.contains_key("age"),
            "age (no directive) must always appear"
        );
    }

    /// AC#4: Two calls with identical schema+operation+seed return byte-identical JSON.
    #[test]
    fn ac4_byte_identical_json_on_repeated_calls() {
        let supergraph_sdl = _compose_test_supergraph();

        // Call twice with identical inputs.
        let result_a = execute_mock(
            &supergraph_sdl,
            "{ me { id name } mostRecentReview { id body product { id title reviews { id } } } }",
            42,
        );
        let result_b = execute_mock(
            &supergraph_sdl,
            "{ me { id name } mostRecentReview { id body product { id title reviews { id } } } }",
            42,
        );

        // Byte-identical JSON strings.
        let json_a = result_a.to_string();
        let json_b = result_b.to_string();
        assert_eq!(
            json_a, json_b,
            "two calls with same inputs must produce byte-identical JSON"
        );
    }

    /// AC#4: Determinism holds across different seeds (different seed → different output).
    #[test]
    fn ac4_different_seed_produces_different_json() {
        let supergraph_sdl = _compose_test_supergraph();

        let result_42 = execute_mock(&supergraph_sdl, "{ me { id name } }", 42);
        let result_99 = execute_mock(&supergraph_sdl, "{ me { id name } }", 99);

        // Same inputs except seed → must differ.
        assert_ne!(
            result_42.to_string(),
            result_99.to_string(),
            "different seeds should produce different JSON"
        );
    }

    /// AC#3: @skip/@include on fragment spreads are honored via variables.
    #[test]
    fn ac3_skip_include_on_fragment_spreads() {
        let api_sdl = r#"
            type Query {
                user: User
            }

            type User {
                id: ID!
                name: String
            }
        "#;
        let schema = Schema::parse_and_validate(api_sdl, "<fragment-directive-schema>")
            .expect("schema should parse");

        // Fragment spread with @skip directive using a variable.
        let op_sdl = r#"
            query($skip: Boolean!) {
                user {
                    id
                    ...NameFragment @skip(if: $skip)
                }
            }

            fragment NameFragment on User {
                name
            }
        "#;
        let doc = ECExecDoc::parse_and_validate(&schema, op_sdl, "<fragment-directive-op>")
            .expect("operation should parse");

        let operation = doc.operations.anonymous.as_ref().expect("anonymous op");

        // $skip=true -> NameFragment spread is skipped; name absent.
        let data_a = walk_selection_set(
            &schema,
            &doc,
            &operation.selection_set,
            exe::OperationType::Query,
            &[],
            &json!({ "skip": true }),
            42,
            vec!["user".to_string()],
        );

        let user_a = data_a
            .as_object()
            .and_then(|o| o.get("user"))
            .and_then(|v| v.as_object())
            .expect("user should be an object");

        assert!(
            !user_a.contains_key("name"),
            "fragment spread with @skip(if: true) must be skipped"
        );
        assert!(
            user_a.contains_key("id"),
            "unrelated field 'id' must still appear"
        );

        // $skip=false -> NameFragment spread is included; name present.
        let data_b = walk_selection_set(
            &schema,
            &doc,
            &operation.selection_set,
            exe::OperationType::Query,
            &[],
            &json!({ "skip": false }),
            42,
            vec!["user".to_string()],
        );

        let user_b = data_b
            .as_object()
            .and_then(|o| o.get("user"))
            .and_then(|v| v.as_object())
            .expect("user should be an object");

        assert!(
            user_b.contains_key("name"),
            "fragment spread with @skip(if: false) must NOT be skipped"
        );
    }
}
