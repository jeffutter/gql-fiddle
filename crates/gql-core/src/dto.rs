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
