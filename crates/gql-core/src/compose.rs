//! Federation composition: subgraphs -> supergraph SDL.
//!
//! This is the only place federation logic runs. Wired to `apollo-federation`
//! in Spike 0.

use apollo_compiler::schema::ExtendedType;
use apollo_federation::composition::{compose as fed_compose, CompositionOptions};
use apollo_federation::error::{CompositionError, SubgraphLocation};
use apollo_federation::subgraph::typestate::Subgraph;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};

use crate::dto::{
    EntityGraph, GraphEdge, GraphNode, SchemaTree, SchemaTreeField, SchemaTreeNode, SubgraphInput,
    TypeGraph,
};

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
            let api_schema_sdl = crate::api_schema::derive_api_schema(&sdl).unwrap_or_default();
            let entity_graph = build_entity_graph(&sdl);
            let type_graph = build_type_graph(&sdl);
            let schema_tree = build_schema_tree(&sdl);
            json!({
                "ok": true,
                "supergraph_sdl": sdl,
                "api_schema_sdl": api_schema_sdl,
                "hints": hints,
                "entity_graph": entity_graph,
                "type_graph": type_graph,
                "schema_tree": schema_tree,
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

// ---------------------------------------------------------------------------
// Graph builders — walk the composed supergraph SDL to extract entity and type
// graph structures for the web visualizer.
// ---------------------------------------------------------------------------

/// Federation-internal or GraphQL introspection type — excluded from both graphs.
fn is_federation_internal(name: &str) -> bool {
    name.starts_with("join__")
        || name.starts_with("link__")
        || name.starts_with("federation__")
        || name.starts_with("__")
        || matches!(name, "_Service" | "_Any" | "_FieldSet" | "_Entity")
}

/// Built-in scalar names — excluded from the type graph.
fn is_builtin_scalar(name: &str) -> bool {
    matches!(name, "String" | "Boolean" | "Int" | "Float" | "ID")
}

/// Root operation type names — excluded from type graph nodes.
fn is_root_operation_type(name: &str) -> bool {
    matches!(name, "Query" | "Mutation" | "Subscription")
}

/// Extract @join__type(graph: ...) argument values from a schema directive list.
///
/// Returns the list of subgraph enum values (e.g. ["USERS", "ORDERS"]).
fn extract_join_subgraphs(directives: &apollo_compiler::schema::DirectiveList) -> Vec<String> {
    let mut result = Vec::new();
    for dir in directives.get_all("join__type") {
        if let Some(graph_arg) = dir.arguments.iter().find(|a| a.name.as_str() == "graph") {
            if let Some(enum_val) = graph_arg.value.as_enum() {
                let s = enum_val.as_str().to_string();
                if !result.contains(&s) {
                    result.push(s);
                }
            }
        }
    }
    result
}

/// Build the entity ownership graph from the composed supergraph SDL.
///
/// An entity is an ObjectType with at least one `@join__type(key: "...")` directive.
/// One node per (subgraph, entity-type) pair is emitted. Cross-subgraph edges are
/// derived from field return types.
fn build_entity_graph(sdl: &str) -> EntityGraph {
    use apollo_compiler::Schema;

    let schema = match Schema::builder()
        .adopt_orphan_extensions()
        .ignore_builtin_redefinitions()
        .parse(sdl, "supergraph.graphql")
        .build()
    {
        Ok(s) => s,
        Err(_) => {
            return EntityGraph {
                nodes: vec![],
                edges: vec![],
                subgraphs: vec![],
            }
        }
    };

    // Pass 1: collect entity ownership — types with @join__type(key: ...) directives.
    // Map: type_name → { subgraph_enum_value → [key_fields] }
    let mut entity_ownership: BTreeMap<String, BTreeMap<String, Vec<String>>> = BTreeMap::new();

    for (type_name, type_def) in &schema.types {
        let name_str = type_name.as_str();
        if is_federation_internal(name_str) {
            continue;
        }
        let ExtendedType::Object(obj) = type_def else {
            continue;
        };
        for dir in obj.directives.get_all("join__type") {
            let graph_arg = dir.arguments.iter().find(|a| a.name.as_str() == "graph");
            let key_arg = dir.arguments.iter().find(|a| a.name.as_str() == "key");
            let graph = graph_arg
                .and_then(|a| a.value.as_enum())
                .map(|e| e.as_str().to_string());
            let key = key_arg
                .and_then(|a| a.value.as_str())
                .map(|s| s.to_string());
            if let (Some(graph), Some(key)) = (graph, key) {
                entity_ownership
                    .entry(name_str.to_string())
                    .or_default()
                    .entry(graph)
                    .or_default()
                    .push(key);
            }
        }
    }

    if entity_ownership.is_empty() {
        return EntityGraph {
            nodes: vec![],
            edges: vec![],
            subgraphs: vec![],
        };
    }

    // Build nodes — one per (subgraph, entity-type) pair.
    let mut nodes = Vec::new();
    let mut subgraph_set: BTreeSet<String> = BTreeSet::new();

    for (type_name, by_subgraph) in &entity_ownership {
        let sg_list: Vec<String> = by_subgraph.keys().cloned().collect();
        for sg in &sg_list {
            subgraph_set.insert(sg.clone());
        }
        for sg in &sg_list {
            nodes.push(GraphNode {
                id: format!("{}:{}", sg, type_name),
                label: type_name.clone(),
                subgraphs: sg_list.clone(),
                kind: None,
            });
        }
    }

    // Pass 2: cross-subgraph edges from field return types.
    let mut edge_set: HashSet<String> = HashSet::new();
    let mut edges = Vec::new();

    for (type_name, src_ownership) in &entity_ownership {
        let Some(ExtendedType::Object(obj)) = schema.types.get(type_name.as_str()) else {
            continue;
        };
        for (_field_name, field_def) in &obj.fields {
            let ret_type = field_def.ty.inner_named_type().as_str().to_string();
            let Some(tgt_ownership) = entity_ownership.get(&ret_type) else {
                continue;
            };
            for src_sg in src_ownership.keys() {
                for (tgt_sg, tgt_keys) in tgt_ownership {
                    if src_sg == tgt_sg {
                        continue;
                    }
                    // Edge key mirrors the TS: "SRCSUB->TGTSUB:TargetType"
                    let edge_key = format!("{}->{}", src_sg, tgt_sg);
                    if edge_set.insert(edge_key) {
                        edges.push(GraphEdge {
                            source: format!("{}:{}", src_sg, type_name),
                            target: format!("{}:{}", tgt_sg, ret_type),
                            label: tgt_keys.first().cloned(),
                        });
                    }
                }
            }
        }
    }

    let subgraphs: Vec<String> = subgraph_set.into_iter().collect();
    EntityGraph {
        nodes,
        edges,
        subgraphs,
    }
}

/// Build the schema type graph from the composed supergraph SDL.
///
/// Includes all named domain types (Object, Interface, Union, Input, Scalar, Enum),
/// excluding built-ins, federation internals, and root operation types.
/// Emits edges for field-return-type and union-member relationships.
fn build_type_graph(sdl: &str) -> TypeGraph {
    use apollo_compiler::Schema;

    let schema = match Schema::builder()
        .adopt_orphan_extensions()
        .ignore_builtin_redefinitions()
        .parse(sdl, "supergraph.graphql")
        .build()
    {
        Ok(s) => s,
        Err(_) => {
            return TypeGraph {
                nodes: vec![],
                edges: vec![],
                subgraphs: vec![],
            }
        }
    };

    // Pass 1: collect all named domain types.
    // type_map: type_name → { kind, subgraphs }
    let mut type_map: BTreeMap<String, (String, Vec<String>)> = BTreeMap::new();

    for (type_name, type_def) in &schema.types {
        let name_str = type_name.as_str();
        if is_federation_internal(name_str) || is_builtin_scalar(name_str) {
            continue;
        }
        match type_def {
            ExtendedType::Object(obj) => {
                if is_root_operation_type(name_str) {
                    continue;
                }
                let sgs = extract_join_subgraphs(&obj.directives);
                type_map
                    .entry(name_str.to_string())
                    .or_insert(("object".to_string(), sgs));
            }
            ExtendedType::Interface(iface) => {
                let sgs = extract_join_subgraphs(&iface.directives);
                type_map
                    .entry(name_str.to_string())
                    .or_insert(("interface".to_string(), sgs));
            }
            ExtendedType::Union(u) => {
                let sgs = extract_join_subgraphs(&u.directives);
                type_map
                    .entry(name_str.to_string())
                    .or_insert(("union".to_string(), sgs));
            }
            ExtendedType::InputObject(input) => {
                let sgs = extract_join_subgraphs(&input.directives);
                type_map
                    .entry(name_str.to_string())
                    .or_insert(("input".to_string(), sgs));
            }
            ExtendedType::Scalar(_) => {
                type_map
                    .entry(name_str.to_string())
                    .or_insert(("scalar".to_string(), vec![]));
            }
            ExtendedType::Enum(e) => {
                // Skip federation-internal enums.
                if name_str == "join__Graph" || name_str == "link__Import" {
                    continue;
                }
                let sgs = extract_join_subgraphs(&e.directives);
                type_map
                    .entry(name_str.to_string())
                    .or_insert(("enum".to_string(), sgs));
            }
        }
    }

    if type_map.is_empty() {
        return TypeGraph {
            nodes: vec![],
            edges: vec![],
            subgraphs: vec![],
        };
    }

    // Build node list.
    let mut subgraph_set: BTreeSet<String> = BTreeSet::new();
    let mut nodes = Vec::new();
    for (type_name, (kind, sgs)) in &type_map {
        for sg in sgs {
            subgraph_set.insert(sg.clone());
        }
        nodes.push(GraphNode {
            id: type_name.clone(),
            label: type_name.clone(),
            subgraphs: sgs.clone(),
            kind: Some(kind.clone()),
        });
    }

    // Pass 2: collect field-return-type and union-member edges.
    let mut edge_set: HashSet<String> = HashSet::new();
    let mut edges = Vec::new();

    for (type_name, type_def) in &schema.types {
        let name_str = type_name.as_str();
        if !type_map.contains_key(name_str) {
            continue;
        }

        match type_def {
            ExtendedType::Object(obj) => {
                for (_field_name, field_def) in &obj.fields {
                    let target = field_def.ty.inner_named_type().as_str().to_string();
                    if !type_map.contains_key(&target) || target == name_str {
                        continue;
                    }
                    let edge_key = format!("{}->{}", name_str, target);
                    if edge_set.insert(edge_key.clone()) {
                        edges.push(GraphEdge {
                            source: name_str.to_string(),
                            target,
                            label: None,
                        });
                    }
                }
            }
            ExtendedType::Interface(iface) => {
                for (_field_name, field_def) in &iface.fields {
                    let target = field_def.ty.inner_named_type().as_str().to_string();
                    if !type_map.contains_key(&target) || target == name_str {
                        continue;
                    }
                    let edge_key = format!("{}->{}", name_str, target);
                    if edge_set.insert(edge_key.clone()) {
                        edges.push(GraphEdge {
                            source: name_str.to_string(),
                            target,
                            label: None,
                        });
                    }
                }
            }
            ExtendedType::InputObject(input) => {
                for (_field_name, field_def) in &input.fields {
                    let target = field_def.ty.inner_named_type().as_str().to_string();
                    if !type_map.contains_key(&target) || target == name_str {
                        continue;
                    }
                    let edge_key = format!("{}->{}", name_str, target);
                    if edge_set.insert(edge_key.clone()) {
                        edges.push(GraphEdge {
                            source: name_str.to_string(),
                            target,
                            label: None,
                        });
                    }
                }
            }
            ExtendedType::Union(u) => {
                for member in &u.members {
                    let target = member.as_str().to_string();
                    if !type_map.contains_key(&target) || target == name_str {
                        continue;
                    }
                    let edge_key = format!("{}->{}", name_str, target);
                    if edge_set.insert(edge_key.clone()) {
                        edges.push(GraphEdge {
                            source: name_str.to_string(),
                            target,
                            label: None,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    let subgraphs: Vec<String> = subgraph_set.into_iter().collect();
    TypeGraph {
        nodes,
        edges,
        subgraphs,
    }
}

// ---------------------------------------------------------------------------
// Schema tree builder — walks the composed supergraph to produce the
// containment hierarchy used by the Schema Tree tab.
// Mirrors the TypeScript implementation in schemaToSchemaTree.ts.
// ---------------------------------------------------------------------------

/// Returns `true` if the type is a scalar or enum leaf (no children to expand).
fn is_schema_tree_leaf(schema: &apollo_compiler::Schema, type_name: &str) -> bool {
    use apollo_compiler::schema::ExtendedType;
    if is_builtin_scalar(type_name) {
        return true;
    }
    matches!(
        schema.types.get(type_name),
        None | Some(ExtendedType::Scalar(_)) | Some(ExtendedType::Enum(_))
    )
}

/// Build the children of a field whose unwrapped type is `type_name`.
///
/// For union types: emits `"… on MemberType"` stub children (U+2026 ellipsis).
/// For object/interface types: emits each non-federation-internal field.
/// `ancestor_path` tracks the chain of type names currently being expanded;
/// a type that already appears in the path becomes a cycle-ref leaf.
fn build_schema_tree_children(
    schema: &apollo_compiler::Schema,
    type_name: &str,
    ancestor_path: &mut HashSet<String>,
) -> Vec<SchemaTreeField> {
    use apollo_compiler::schema::ExtendedType;

    let Some(type_def) = schema.types.get(type_name) else {
        return vec![];
    };

    match type_def {
        ExtendedType::Union(u) => {
            let mut fields = Vec::new();
            for member in &u.members {
                let member_name = member.as_str().to_string();
                if is_federation_internal(&member_name) {
                    continue;
                }
                let is_leaf = is_schema_tree_leaf(schema, &member_name);
                let is_cycle_ref = ancestor_path.contains(&member_name);
                let children = if !is_leaf && !is_cycle_ref {
                    ancestor_path.insert(member_name.clone());
                    let ch = build_schema_tree_children(schema, &member_name, ancestor_path);
                    ancestor_path.remove(&member_name);
                    ch
                } else {
                    vec![]
                };
                // Use the Unicode ellipsis character U+2026 ("…"), not three ASCII dots.
                fields.push(SchemaTreeField {
                    field_name: format!("\u{2026} on {}", member_name),
                    type_name: member_name,
                    is_list: false,
                    is_non_null: false,
                    is_leaf,
                    is_cycle_ref,
                    children,
                });
            }
            fields
        }

        ExtendedType::Object(obj) => {
            build_schema_tree_from_field_iter(schema, obj.fields.iter(), ancestor_path)
        }

        ExtendedType::Interface(iface) => {
            build_schema_tree_from_field_iter(schema, iface.fields.iter(), ancestor_path)
        }

        _ => vec![],
    }
}

/// Build `SchemaTreeField` list from an iterator of `(Name, FieldDefinition)` pairs.
/// Shared implementation for both object and interface types.
fn build_schema_tree_from_field_iter<'a>(
    schema: &apollo_compiler::Schema,
    fields: impl Iterator<
        Item = (
            &'a apollo_compiler::Name,
            &'a apollo_compiler::schema::Component<apollo_compiler::schema::FieldDefinition>,
        ),
    >,
    ancestor_path: &mut HashSet<String>,
) -> Vec<SchemaTreeField> {
    let mut result = Vec::new();
    for (field_name, field_def) in fields {
        let fn_str = field_name.as_str();
        if is_federation_internal(fn_str) {
            continue;
        }
        let type_name = field_def.ty.inner_named_type().as_str().to_string();
        let is_list = field_def.ty.is_list();
        let is_non_null = field_def.ty.is_non_null();
        let is_leaf = is_schema_tree_leaf(schema, &type_name);
        let is_cycle_ref = !is_leaf && ancestor_path.contains(&type_name);

        let children = if !is_leaf && !is_cycle_ref {
            ancestor_path.insert(type_name.clone());
            let ch = build_schema_tree_children(schema, &type_name, ancestor_path);
            ancestor_path.remove(&type_name);
            ch
        } else {
            vec![]
        };

        result.push(SchemaTreeField {
            field_name: fn_str.to_string(),
            type_name,
            is_list,
            is_non_null,
            is_leaf,
            is_cycle_ref,
            children,
        });
    }
    result
}

/// Build the schema containment hierarchy tree from the composed supergraph SDL.
///
/// Mirrors `schemaToSchemaTree` in `web/src/schemaToSchemaTree.ts`. Returns an
/// empty tree on parse failure.
pub(crate) fn build_schema_tree(sdl: &str) -> SchemaTree {
    use apollo_compiler::Schema;

    let schema = match Schema::builder()
        .adopt_orphan_extensions()
        .ignore_builtin_redefinitions()
        .parse(sdl, "supergraph.graphql")
        .build()
    {
        Ok(s) => s,
        Err(_) => return SchemaTree { roots: vec![] },
    };

    let mut roots = Vec::new();

    for root_type_name in &["Query", "Mutation", "Subscription"] {
        use apollo_compiler::schema::ExtendedType;

        let Some(ExtendedType::Object(obj)) = schema.types.get(*root_type_name) else {
            continue;
        };

        let mut fields = Vec::new();
        for (field_name, field_def) in obj.fields.iter() {
            let fn_str = field_name.as_str();
            if is_federation_internal(fn_str) {
                continue;
            }

            let type_name = field_def.ty.inner_named_type().as_str().to_string();
            let is_list = field_def.ty.is_list();
            let is_non_null = field_def.ty.is_non_null();
            let is_leaf = is_schema_tree_leaf(&schema, &type_name);

            // Root fields are never cycle refs; initialise a fresh ancestor path
            // seeded with the root type name and this field's type — mirroring
            // the JS `new Set([rootTypeName, fieldTypeName])` approach so that
            // self-referential types at depth-1 are correctly flagged.
            let mut ancestor_path: HashSet<String> = HashSet::new();
            ancestor_path.insert(root_type_name.to_string());
            ancestor_path.insert(type_name.clone());

            let children = if is_leaf {
                vec![]
            } else {
                build_schema_tree_children(&schema, &type_name, &mut ancestor_path)
            };

            fields.push(SchemaTreeField {
                field_name: fn_str.to_string(),
                type_name,
                is_list,
                is_non_null,
                is_leaf,
                is_cycle_ref: false,
                children,
            });
        }

        if !fields.is_empty() {
            roots.push(SchemaTreeNode {
                root_type_name: root_type_name.to_string(),
                fields,
            });
        }
    }

    SchemaTree { roots }
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
    fn success_result_includes_api_schema_sdl() {
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
            "expected ok:true"
        );
        let api_schema_sdl = result
            .get("api_schema_sdl")
            .and_then(|v| v.as_str())
            .expect("success result must contain api_schema_sdl key");
        assert!(
            !api_schema_sdl.is_empty(),
            "api_schema_sdl must be non-empty on successful composition"
        );
    }

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
            vec![
                "ok",
                "supergraph_sdl",
                "api_schema_sdl",
                "hints",
                "entity_graph",
                "type_graph",
                "schema_tree"
            ],
            "success path must return exactly {{ok, supergraph_sdl, api_schema_sdl, hints, entity_graph, type_graph, schema_tree}}"
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

    // ---- AC #5: entity_graph and type_graph are populated for a schema with entities ----

    #[test]
    fn entity_graph_and_type_graph_populated_for_entity_schema() {
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
            "expected ok:true"
        );

        // entity_graph must be non-empty.
        let entity_graph = result
            .get("entity_graph")
            .expect("entity_graph key must exist");
        let entity_nodes = entity_graph
            .get("nodes")
            .and_then(|v| v.as_array())
            .expect("entity_graph.nodes must be an array");
        assert!(
            !entity_nodes.is_empty(),
            "entity_graph.nodes should not be empty for a schema with entities"
        );

        let entity_subgraphs = entity_graph
            .get("subgraphs")
            .and_then(|v| v.as_array())
            .expect("entity_graph.subgraphs must be an array");
        // Should contain both subgraph names.
        let sg_names: Vec<&str> = entity_subgraphs.iter().filter_map(|v| v.as_str()).collect();
        assert!(
            sg_names
                .iter()
                .any(|s| s.contains("PRODUCTS") || s.contains("products")),
            "entity subgraphs should include PRODUCTS, got: {sg_names:?}"
        );
        assert!(
            sg_names
                .iter()
                .any(|s| s.contains("REVIEWS") || s.contains("reviews")),
            "entity subgraphs should include REVIEWS, got: {sg_names:?}"
        );

        // type_graph must be non-empty.
        let type_graph = result.get("type_graph").expect("type_graph key must exist");
        let type_nodes = type_graph
            .get("nodes")
            .and_then(|v| v.as_array())
            .expect("type_graph.nodes must be an array");
        assert!(
            !type_nodes.is_empty(),
            "type_graph.nodes should not be empty for a schema with domain types"
        );

        // Verify that node kind field is present on type graph nodes.
        let first_node = &type_nodes[0];
        assert!(
            first_node.get("kind").is_some(),
            "type graph nodes must have a 'kind' field"
        );
    }

    // ---- schema_tree tests ----

    #[test]
    fn schema_tree_basic_query_fields() {
        // Minimal two-type schema: Query with a scalar field and an object field.
        let products = SubgraphInput {
            name: "products".to_string(),
            sdl: r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
                {
                    query: Query
                }
                type Query {
                    me: User
                    version: String
                }
                type User @key(fields: "id") {
                    id: ID!
                    name: String
                }
            "#
            .to_string(),
        };

        let result = compose(&[products]);
        assert!(
            result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
            "expected ok:true"
        );

        let schema_tree = result.get("schema_tree").expect("schema_tree must exist");
        let roots = schema_tree
            .get("roots")
            .and_then(|v| v.as_array())
            .expect("roots must be an array");

        // Should have exactly one root (Query).
        assert_eq!(roots.len(), 1, "expected exactly one root (Query)");
        let query_root = &roots[0];
        assert_eq!(
            query_root.get("rootTypeName").and_then(|v| v.as_str()),
            Some("Query")
        );

        let fields = query_root
            .get("fields")
            .and_then(|v| v.as_array())
            .expect("fields must be an array");

        // version: String — scalar leaf
        let version_field = fields
            .iter()
            .find(|f| f.get("fieldName").and_then(|v| v.as_str()) == Some("version"))
            .expect("version field must exist");
        assert_eq!(
            version_field.get("isLeaf").and_then(|v| v.as_bool()),
            Some(true),
            "version field must be a leaf (String scalar)"
        );
        assert_eq!(
            version_field.get("typeName").and_then(|v| v.as_str()),
            Some("String")
        );

        // me: User — object type with children
        let me_field = fields
            .iter()
            .find(|f| f.get("fieldName").and_then(|v| v.as_str()) == Some("me"))
            .expect("me field must exist");
        assert_eq!(
            me_field.get("isLeaf").and_then(|v| v.as_bool()),
            Some(false),
            "me field must not be a leaf (User is an object type)"
        );
        let me_children = me_field
            .get("children")
            .and_then(|v| v.as_array())
            .expect("me.children must be an array");
        assert!(
            !me_children.is_empty(),
            "User type must have at least one child field"
        );
    }

    #[test]
    fn schema_tree_excludes_federation_internal_types() {
        let products = SubgraphInput {
            name: "products".to_string(),
            sdl: r#"
                extend schema
                    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])
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
                {
                    query: Query
                }
                type Query {
                    review: Review
                }
                type Review {
                    id: ID!
                }
                extend type User @key(fields: "id") {
                    id: ID! @external
                }
            "#
            .to_string(),
        };

        let result = compose(&[products, reviews]);
        assert!(
            result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
            "expected ok:true"
        );

        let schema_tree_json =
            serde_json::to_string(result.get("schema_tree").expect("schema_tree must exist"))
                .unwrap();

        // federation-internal type name prefixes must not appear anywhere in the tree.
        assert!(
            !schema_tree_json.contains("join__"),
            "schema_tree must not contain join__ names"
        );
        assert!(
            !schema_tree_json.contains("link__"),
            "schema_tree must not contain link__ names"
        );
    }

    #[test]
    fn schema_tree_cycle_detection() {
        // Self-referential type: Category.children: [Category].
        // The supergraph SDL is crafted directly since a single-subgraph
        // schema can be composed without issues.
        let sdl = r#"
            schema @link(url: "https://specs.apollo.dev/link/v1.0")
                   @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION)
            {
                query: Query
            }
            directive @link(url: String, for: link__Purpose, import: [link__Import]) repeatable on SCHEMA
            directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
            directive @join__field(graph: join__Graph) repeatable on FIELD_DEFINITION | INPUT_FIELD_DEFINITION
            directive @join__graph(name: String!, url: String!) on ENUM_VALUE
            enum link__Purpose { EXECUTION SECURITY }
            scalar link__Import
            enum join__Graph { CATALOG @join__graph(name: "catalog", url: "") }
            type Query @join__type(graph: CATALOG) {
                root: Category @join__field(graph: CATALOG)
            }
            type Category @join__type(graph: CATALOG) {
                name: String @join__field(graph: CATALOG)
                children: [Category] @join__field(graph: CATALOG)
            }
        "#;

        let tree = build_schema_tree(sdl);
        assert_eq!(tree.roots.len(), 1, "expected one root (Query)");
        let query_root = &tree.roots[0];
        assert_eq!(query_root.root_type_name, "Query");

        let root_field = query_root
            .fields
            .iter()
            .find(|f| f.field_name == "root")
            .expect("root field must exist");

        assert!(
            !root_field.is_cycle_ref,
            "root field must not be a cycle ref"
        );
        assert!(!root_field.is_leaf, "Category must not be a leaf");

        // Category.children: [Category] should be marked as isCycleRef.
        let children_field = root_field
            .children
            .iter()
            .find(|f| f.field_name == "children")
            .expect("children field must exist on Category");

        assert!(
            children_field.is_cycle_ref,
            "Category.children must be a cycle ref (Category is an ancestor)"
        );
        assert!(
            children_field.children.is_empty(),
            "cycle ref nodes must have no children"
        );
        assert!(
            children_field.is_list,
            "children: [Category] must be a list"
        );
    }
}
