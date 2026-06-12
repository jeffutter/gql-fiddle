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

/// A single node in a query plan tree.  Serializes with a `kind` discriminant
/// so the visualizer can render each variant differently.
#[expect(dead_code)]
#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind")]
pub enum PlanNode {
    Fetch {
        service: String,
        #[serde(rename = "operation")]
        operation_str: String,
        operation_kind: String,
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
}
