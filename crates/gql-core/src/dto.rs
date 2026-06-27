//! Serde types that define the JSON boundary between JS and Rust.
//!
//! The JS shell depends on *these* shapes, never on `apollo-federation`'s
//! internal types — so Apollo API churn stays contained in the wrapper modules.

use serde::Deserialize;

/// One subgraph as supplied by the editor.
#[derive(Debug, Deserialize)]
pub struct SubgraphInput {
    pub name: String,
    pub sdl: String,
}

/// A field resolved by a single Fetch node, including its type condition when
/// the fetch is an entity fetch (i.e., the field lives inside `... on TypeName`).
#[derive(Debug, serde::Serialize)]
pub struct ResolvedField {
    pub field_name: String,
    /// Set to the inline-fragment type name for entity fetches; `None` for root fetches.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_condition: Option<String>,
}

/// A field or inline fragment in a `@requires` selection set.
#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind")]
pub enum RequiresSelection {
    Field {
        #[serde(skip_serializing_if = "Option::is_none")]
        alias: Option<String>,
        name: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        selections: Vec<RequiresSelection>,
    },
    InlineFragment {
        #[serde(rename = "typeCondition", skip_serializing_if = "Option::is_none")]
        type_condition: Option<String>,
        selections: Vec<RequiresSelection>,
    },
}

/// A single node in a query plan tree.  Serializes with a `kind` discriminant
/// so the visualizer can render each variant differently.
///
/// Covers every variant Apollo's query planner can produce:
/// Fetch, Sequence, Parallel, Flatten, Subscription, Defer, Condition.
#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind")]
pub enum PlanNode {
    Fetch {
        service: String,
        #[serde(rename = "operation")]
        operation_str: String,
        operation_kind: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        requires: Vec<RequiresSelection>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        resolved_fields: Vec<ResolvedField>,
        /// Distinct entity type names from `... on TypeName` fragments in `_entities` fetches.
        /// Empty for non-entity fetches. Skipped from JSON when empty.
        #[serde(skip_serializing_if = "Vec::is_empty")]
        entity_types: Vec<String>,
    },
    Sequence {
        nodes: Vec<PlanNode>,
    },
    Parallel {
        nodes: Vec<PlanNode>,
    },
    Flatten {
        path: Vec<String>,
        node: Box<PlanNode>,
    },
    Subscription {
        primary: Box<PlanNode>,
        #[serde(skip_serializing_if = "Option::is_none")]
        rest: Option<Box<PlanNode>>,
    },
    Defer {
        #[serde(skip_serializing_if = "Option::is_none")]
        primary: Option<Box<PlanNode>>,
        deferred: Vec<DeferredBranch>,
    },
    Condition {
        #[serde(rename = "conditionVariable")]
        condition_variable: String,
        #[serde(rename = "ifBranch", skip_serializing_if = "Option::is_none")]
        if_branch: Option<Box<PlanNode>>,
        #[serde(rename = "elseBranch", skip_serializing_if = "Option::is_none")]
        else_branch: Option<Box<PlanNode>>,
    },
}

/// One deferred branch inside a Defer node.
#[derive(Debug, serde::Serialize)]
pub struct DeferredBranch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<Box<PlanNode>>,
}

/// A node in an entity or type graph.
///
/// For the entity graph: `id` is `"SUBGRAPH:TypeName"`, `label` is the type name,
/// `subgraphs` is the list of subgraph enum values that own this entity.
/// For the type graph: `id` and `label` are both the type name, `subgraphs` are
/// the subgraph enum values where the type is declared.
#[derive(Debug, serde::Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub subgraphs: Vec<String>,
    /// Type kind: "object" | "interface" | "union" | "input" | "scalar" | "enum".
    /// Only present for type graph nodes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// A directed edge in an entity or type graph.
#[derive(Debug, serde::Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    /// For entity edges: the @key(fields) string of the target entity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Entity ownership graph: entity types and cross-subgraph relationships.
#[derive(Debug, serde::Serialize)]
pub struct EntityGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub subgraphs: Vec<String>,
}

/// Schema type graph: all domain types and their field-return-type relationships.
#[derive(Debug, serde::Serialize)]
pub struct TypeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub subgraphs: Vec<String>,
}

/// A single node in the schema containment hierarchy tree.
///
/// Recursive: each field may have children which are also `SchemaTreeField`s.
/// Mirrors the TypeScript `SchemaTreeField` interface in `schemaToSchemaTree.ts`.
#[derive(Debug, serde::Serialize)]
pub struct SchemaTreeField {
    /// The field name, or `"… on MemberType"` for union inline-fragment stubs.
    #[serde(rename = "fieldName")]
    pub field_name: String,
    /// The unwrapped named type (e.g. `"User"`, `"String"`).
    #[serde(rename = "typeName")]
    pub type_name: String,
    /// True if the return type is wrapped in a List at any nesting level.
    #[serde(rename = "isList")]
    pub is_list: bool,
    /// True if the outermost type wrapper is NonNull.
    #[serde(rename = "isNonNull")]
    pub is_non_null: bool,
    /// True if the return type is a scalar or enum (leaf — no children to expand).
    #[serde(rename = "isLeaf")]
    pub is_leaf: bool,
    /// True when this type is already an ancestor in the current traversal path.
    #[serde(rename = "isCycleRef")]
    pub is_cycle_ref: bool,
    /// Recursive child fields. Empty for leaves and cycle refs.
    pub children: Vec<SchemaTreeField>,
}

/// One root operation type node in the schema tree.
#[derive(Debug, serde::Serialize)]
pub struct SchemaTreeNode {
    /// One of `"Query"`, `"Mutation"`, `"Subscription"`.
    #[serde(rename = "rootTypeName")]
    pub root_type_name: String,
    /// Top-level fields on the root type.
    pub fields: Vec<SchemaTreeField>,
}

/// The full schema containment hierarchy tree rooted at operation types.
#[derive(Debug, serde::Serialize)]
pub struct SchemaTree {
    /// One entry per root type present in the schema.
    pub roots: Vec<SchemaTreeNode>,
}
