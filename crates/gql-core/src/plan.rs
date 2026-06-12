//! Query planning, exposed purely for visualization (decoupled from execution).

use apollo_compiler::Name;
use serde_json::{json, Value};

/// Produce a slim, stable query-plan DTO for an operation.
///
/// Returns `{ ok: true, query_plan: <tree> }` on success or
/// `{ ok: false, errors: [...] }` on failure.
pub fn plan(supergraph_sdl: &str, operation: &str, op_name: Option<&str>) -> Value {
    // 1. Parse supergraph
    let supergraph = match apollo_federation::Supergraph::new(supergraph_sdl) {
        Ok(sg) => sg,
        Err(err) => return error_envelope(err.to_string()),
    };

    // 2. Build query planner with safe defaults
    let planner = match apollo_federation::query_plan::query_planner::QueryPlanner::new(
        &supergraph,
        Default::default(),
    ) {
        Ok(pl) => pl,
        Err(err) => return error_envelope(err.to_string()),
    };

    // 3. Parse operation against the planner's API schema
    let document = match apollo_compiler::ExecutableDocument::parse_and_validate(
        planner.api_schema().schema(),
        operation,
        "operation.graphql",
    ) {
        Ok(doc) => doc,
        Err(we) => {
            let msgs: Vec<String> = we.errors.iter().map(|d| d.to_string()).collect();
            return error_envelope(msgs.join("\n"));
        }
    };

    // 4. Resolve operation name (Name::new returns Result; convert to Option)
    let plan_op_name = op_name.and_then(|n| Name::new(n).ok());

    // 5. Build the query plan
    let query_plan = match planner.build_query_plan(&document, plan_op_name, Default::default()) {
        Ok(qp) => qp,
        Err(err) => return error_envelope(err.to_string()),
    };

    // 6. Map into our DTO
    let node = match query_plan.node {
        Some(n) => match n {
            apollo_federation::query_plan::TopLevelPlanNode::Subscription(sub) => {
                map_subscription_node(sub)
            }
            apollo_federation::query_plan::TopLevelPlanNode::Fetch(fetch) => map_fetch(*fetch),
            apollo_federation::query_plan::TopLevelPlanNode::Sequence(seq) => map_sequence(seq),
            apollo_federation::query_plan::TopLevelPlanNode::Parallel(par) => map_parallel(par),
            apollo_federation::query_plan::TopLevelPlanNode::Flatten(flatt) => map_flatten(flatt),
            apollo_federation::query_plan::TopLevelPlanNode::Defer(defer) => map_defer(defer),
            apollo_federation::query_plan::TopLevelPlanNode::Condition(cond) => {
                map_condition(*cond)
            }
        },
        None => serde_json::from_value(json!({ "kind": "Sequence", "nodes": [] })).unwrap(),
    };

    json!({ "ok": true, "query_plan": node })
}

fn error_envelope(msg: String) -> Value {
    json!({
        "ok": false,
        "errors": [{ "code": "PLANNING_ERROR", "message": msg }],
    })
}

/// Map a SubscriptionNode (the only TopLevelPlanNode variant with unique shape).
fn map_subscription_node(sub: apollo_federation::query_plan::SubscriptionNode) -> Value {
    let fetch = *sub.primary;
    let primary = map_fetch(fetch);
    let rest = match sub.rest {
        Some(n) => json!({ "rest": map_inner_node(*n) }),
        None => json!({}),
    };
    json!({ "kind": "Subscription", "primary": primary, "rest": rest })
}

/// Map an inner PlanNode (no Subscription variant). Used by Flatten, Defer, Condition.
fn map_inner_node(node: apollo_federation::query_plan::PlanNode) -> Value {
    match node {
        apollo_federation::query_plan::PlanNode::Fetch(fetch) => map_fetch(*fetch),
        apollo_federation::query_plan::PlanNode::Sequence(seq) => map_sequence(seq),
        apollo_federation::query_plan::PlanNode::Parallel(par) => map_parallel(par),
        apollo_federation::query_plan::PlanNode::Flatten(flatt) => map_flatten(flatt),
        apollo_federation::query_plan::PlanNode::Defer(defer) => map_defer(defer),
        apollo_federation::query_plan::PlanNode::Condition(cond) => map_condition(*cond),
    }
}

fn map_fetch(fetch: apollo_federation::query_plan::FetchNode) -> Value {
    let service = fetch.subgraph_name.to_string();
    let op_str = serde_json::to_string(&fetch.operation_document).unwrap_or_default();
    let op_kind = format!("{}", fetch.operation_kind);
    json!({
        "kind": "Fetch",
        "service": service,
        "operation": op_str,
        "operation_kind": op_kind,
    })
}

fn map_sequence(seq: apollo_federation::query_plan::SequenceNode) -> Value {
    let children: Vec<Value> = seq.nodes.into_iter().map(map_inner_node).collect();
    json!({ "kind": "Sequence", "nodes": children })
}

fn map_parallel(par: apollo_federation::query_plan::ParallelNode) -> Value {
    let children: Vec<Value> = par.nodes.into_iter().map(map_inner_node).collect();
    json!({ "kind": "Parallel", "nodes": children })
}

fn map_flatten(flatt: apollo_federation::query_plan::FlattenNode) -> Value {
    let path: Vec<String> = flatt
        .path
        .into_iter()
        .map(|elem| match elem {
            apollo_federation::query_plan::FetchDataPathElement::Key(k, _) => k.to_string(),
            apollo_federation::query_plan::FetchDataPathElement::AnyIndex(_) => "[?]".to_string(),
            apollo_federation::query_plan::FetchDataPathElement::TypenameEquals(name) => {
                format!("=={}", name)
            }
            apollo_federation::query_plan::FetchDataPathElement::Parent => "..".to_string(),
        })
        .collect();
    let child = map_inner_node(*flatt.node);
    json!({ "kind": "Flatten", "path": path, "node": child })
}

fn map_defer(defer: apollo_federation::query_plan::DeferNode) -> Value {
    let primary = match defer.primary.node {
        Some(n) => map_inner_node(*n),
        None => json!({}),
    };
    let deferred_nodes: Vec<Value> = defer
        .deferred
        .into_iter()
        .map(|d| {
            let child = match d.node {
                Some(n) => map_inner_node(*n),
                None => json!({}),
            };
            json!({
                "kind": "DeferNode",
                "label": d.label,
                "node": child,
            })
        })
        .collect();
    json!({
        "kind": "Defer",
        "primary": primary,
        "deferred": deferred_nodes,
    })
}

fn map_condition(cond: apollo_federation::query_plan::ConditionNode) -> Value {
    let if_branch = match cond.if_clause {
        Some(n) => map_inner_node(*n),
        None => json!({}),
    };
    let else_branch = match cond.else_clause {
        Some(n) => map_inner_node(*n),
        None => json!({}),
    };
    json!({
        "kind": "Condition",
        "conditionVariable": cond.condition_variable.to_string(),
        "ifBranch": if_branch,
        "elseBranch": else_branch,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compose::compose as compose_inner;

    #[test]
    fn plan_returns_ok_with_query_plan_tree() {
        // Minimal two-subgraph federation: user (id, name) + profile (id, bio)
        let subgraphs = r#"[
            {"name":"user","sdl":"type Query { user(id: ID!): User } type User @key(fields: \"id\") { id: ID!, name: String }"},
            {"name":"profile","sdl":"extend type User @key(fields: \"id\") { id: ID!, bio: String }"}
        ]"#;

        // First compose to get a supergraph SDL
        let subgraphs_vec: Vec<crate::dto::SubgraphInput> =
            serde_json::from_str(subgraphs).unwrap();
        let compose_result = compose_inner(&subgraphs_vec[..]);
        assert!(
            compose_result["ok"].as_bool().unwrap_or(false),
            "composition failed"
        );
        let supergraph_sdl = compose_result["supergraph_sdl"]
            .as_str()
            .expect("no supergraph_sdl in result");

        // Query the extended User
        let operation = "{ user(id: \"1\") { id name bio } }";
        let result = plan(supergraph_sdl, operation, None);

        // #1: ok:true present
        assert!(result["ok"].as_bool().unwrap_or(false), "expected ok:true");

        // query_plan must be present and have a "kind" discriminant
        let qp = result["query_plan"]
            .as_object()
            .expect("query_plan missing");
        let kind = qp["kind"]
            .as_str()
            .expect("query_plan must have a 'kind' field");

        // The kind must be one of our known node kinds
        match kind {
            "Fetch" | "Sequence" | "Parallel" | "Flatten" | "Defer" | "Condition" => {}
            other => panic!("unexpected plan node kind: {other}"),
        }

        // If it's a Fetch, verify service and operation_kind fields exist
        if kind == "Fetch" {
            assert!(
                qp["service"].is_string(),
                "Fetch must have a 'service' string field"
            );
            assert!(
                qp["operation_kind"].is_string(),
                "Fetch must have an 'operation_kind' string field"
            );
        }

        // If it's Sequence/Parallel, verify nested nodes array
        if kind == "Sequence" || kind == "Parallel" {
            let nodes = qp["nodes"]
                .as_array()
                .expect("Sequence/Parallel must have a 'nodes' array");
            assert!(
                !nodes.is_empty(),
                "{kind} should not be empty for this query"
            );
        }
    }

    #[test]
    fn plan_returns_error_envelope_for_bad_sdl() {
        let result = plan("not a valid sdl", "{ __typename }", None);
        assert!(!result["ok"].as_bool().unwrap_or(true), "expected ok:false");
        let errors = result["errors"].as_array().expect("errors array missing");
        assert!(!errors.is_empty(), "expected at least one error");
    }

    /// AC #2: multi-subgraph query yields at least one Fetch per involved subgraph,
    /// each labeled with the subgraph name.
    #[test]
    fn plan_multi_subgraph_yields_fetch_per_subgraph() {
        // Three-subgraph federation:
        //   user  – User(id, name)
        //   product – Product(id, title) + extends User
        //   inventory – Inventory(product: ID!) → quantity
        let subgraphs = r#"[
            {"name":"user","sdl":"type Query { user(id: ID!): User } type User @key(fields: \"id\") { id: ID!, name: String }"},
            {"name":"product","sdl":"extend type User @key(fields: \"id\") { id: ID!, title: String } type Query { product(id: ID!): Product } type Product @key(fields: \"id\") { id: ID!, title: String }"},
            {"name":"inventory","sdl":"type Query { inventory(productId: ID!): Inventory } type Inventory @key(fields: \"productId\") { productId: ID!, quantity: Int }"}
        ]"#;

        let subgraphs_vec: Vec<crate::dto::SubgraphInput> =
            serde_json::from_str(subgraphs).unwrap();
        let compose_result = compose_inner(&subgraphs_vec[..]);
        assert!(
            compose_result["ok"].as_bool().unwrap_or(false),
            "composition failed"
        );
        let supergraph_sdl = compose_result["supergraph_sdl"]
            .as_str()
            .expect("no supergraph_sdl in result");

        // Query fields that touch all three subgraphs
        let operation = r#"{
            user(id: "1") { id name }
            product(id: "2") { id title }
            inventory(productId: "2") { quantity }
        }"#;
        let result = plan(supergraph_sdl, operation, None);

        assert!(result["ok"].as_bool().unwrap_or(false), "expected ok:true");

        // Collect all Fetch service names from the plan tree
        let fetch_services = collect_fetch_services(&result["query_plan"]);
        assert!(
            !fetch_services.is_empty(),
            "plan should contain at least one Fetch"
        );

        // Every involved subgraph must have at least one Fetch
        for subgraph in ["user", "product", "inventory"] {
            assert!(
                fetch_services.contains(&subgraph.to_string()),
                "expected a Fetch for subgraph '{subgraph}', found: {fetch_services:?}"
            );
        }
    }

    /// Recursively collect all `service` strings from Fetch nodes in the plan tree.
    fn collect_fetch_services(node: &Value) -> Vec<String> {
        let mut services = Vec::new();
        if let Some(obj) = node.as_object() {
            if obj.get("kind").and_then(|v| v.as_str()) == Some("Fetch") {
                if let Some(service) = obj.get("service").and_then(|v| v.as_str()) {
                    services.push(service.to_string());
                }
            }
            // Recurse into child nodes
            for value in obj.values() {
                if let Some(child_obj) = value.as_object() {
                    // Nodes with a "nodes" array (Sequence, Parallel)
                    if let Some(nodes_arr) = child_obj.get("nodes").and_then(|v| v.as_array()) {
                        for child in nodes_arr {
                            services.extend(collect_fetch_services(child));
                        }
                    } else if let Some(nested) = value.as_object() {
                        // Single nested node (e.g., Flatten.node, Defer.primary)
                        services.extend(collect_fetch_services(&Value::Object(nested.clone())));
                    }
                } else if let Some(arr) = value.as_array() {
                    for item in arr {
                        services.extend(collect_fetch_services(item));
                    }
                }
            }
        }
        services
    }
}
