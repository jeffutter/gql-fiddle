//! Query planning, exposed purely for visualization (decoupled from execution).

use apollo_compiler::Name;
use serde_json::{json, Value};

use crate::dto::{DeferredBranch, PlanNode, RequiresSelection, ResolvedField};

/// Produce a slim, stable query-plan DTO for an operation.
///
/// Returns `{ ok: true, query_plan: <tree> }` on success or
/// `{ ok: false, errors: [...] }` on failure.
pub fn plan(supergraph_sdl: &str, operation: &str, op_name: Option<&str>) -> Value {
    // 1. Parse supergraph
    let supergraph = match apollo_federation::Supergraph::new_with_router_specs(supergraph_sdl) {
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

    // 6. Map into our DTO and serialize
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
        None => PlanNode::Sequence { nodes: vec![] },
    };

    let query_plan_value = serde_json::to_value(node).unwrap_or(Value::Null);
    json!({ "ok": true, "query_plan": query_plan_value })
}

fn error_envelope(msg: String) -> Value {
    json!({
        "ok": false,
        "errors": [{ "code": "PLANNING_ERROR", "message": msg }],
    })
}

fn map_subscription_node(sub: apollo_federation::query_plan::SubscriptionNode) -> PlanNode {
    let primary = Box::new(map_fetch(*sub.primary));
    let rest = sub.rest.map(|n| Box::new(map_inner_node(*n)));
    PlanNode::Subscription { primary, rest }
}

/// Map an inner PlanNode (no Subscription variant). Used by Flatten, Defer, Condition.
fn map_inner_node(node: apollo_federation::query_plan::PlanNode) -> PlanNode {
    match node {
        apollo_federation::query_plan::PlanNode::Fetch(fetch) => map_fetch(*fetch),
        apollo_federation::query_plan::PlanNode::Sequence(seq) => map_sequence(seq),
        apollo_federation::query_plan::PlanNode::Parallel(par) => map_parallel(par),
        apollo_federation::query_plan::PlanNode::Flatten(flatt) => map_flatten(flatt),
        apollo_federation::query_plan::PlanNode::Defer(defer) => map_defer(defer),
        apollo_federation::query_plan::PlanNode::Condition(cond) => map_condition(*cond),
    }
}

fn map_fetch(fetch: apollo_federation::query_plan::FetchNode) -> PlanNode {
    let service = fetch.subgraph_name.to_string();
    let op_str = serde_json::to_string(&fetch.operation_document).unwrap_or_default();
    let op_kind = format!("{}", fetch.operation_kind);
    let requires = map_requires(fetch.requires);
    let resolved_fields = extract_resolved_fields(&fetch.operation_document);
    let entity_types = extract_entity_types(&fetch.operation_document);
    PlanNode::Fetch {
        service,
        operation_str: op_str,
        operation_kind: op_kind,
        requires,
        resolved_fields,
        entity_types,
    }
}

/// Walk the Fetch sub-operation AST and return a `ResolvedField` for every
/// field the Fetch resolves.  Entity fetches (those with a top-level
/// `_entities` field) record type conditions from the inline fragments;
/// root fetches record `type_condition: None`.
fn extract_resolved_fields(
    doc: &apollo_federation::query_plan::serializable_document::SerializableDocument,
) -> Vec<ResolvedField> {
    use apollo_compiler::executable::Selection;

    // as_parsed() is infallible here: the planner builds with from_parsed().
    let executable = match doc.as_parsed() {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let mut fields = Vec::new();
    for op in executable.operations.iter() {
        for sel in &op.selection_set.selections {
            match sel {
                Selection::Field(f) if f.name == "_entities" => {
                    // Entity fetch: fields are inside `... on TypeName { field1 field2 }`
                    for inner in &f.selection_set.selections {
                        if let Selection::InlineFragment(frag) = inner {
                            let type_condition =
                                frag.type_condition.as_ref().map(|t| t.to_string());
                            collect_leaf_fields(
                                &frag.selection_set.selections,
                                type_condition,
                                &mut fields,
                            );
                        }
                    }
                }
                Selection::Field(f) => {
                    fields.push(ResolvedField {
                        field_name: f.name.to_string(),
                        type_condition: None,
                    });
                    // Recurse into sub-selections to capture nested fields
                    collect_leaf_fields(&f.selection_set.selections, None, &mut fields);
                }
                Selection::InlineFragment(frag) => {
                    let type_condition = frag.type_condition.as_ref().map(|t| t.to_string());
                    collect_leaf_fields(
                        &frag.selection_set.selections,
                        type_condition,
                        &mut fields,
                    );
                }
                Selection::FragmentSpread(_) => {} // sub-operations don't use fragment spreads
            }
        }
    }
    fields
}

/// Collect distinct entity type names from a Fetch sub-operation that has
/// `_entities` as its top-level field. Returns an empty Vec for non-entity fetches.
fn extract_entity_types(
    doc: &apollo_federation::query_plan::serializable_document::SerializableDocument,
) -> Vec<String> {
    use apollo_compiler::executable::Selection;

    // as_parsed() is infallible here: the planner builds with from_parsed().
    let executable = match doc.as_parsed() {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let mut seen = std::collections::HashSet::new();
    let mut types = Vec::new();

    for op in executable.operations.iter() {
        for sel in &op.selection_set.selections {
            if let Selection::Field(f) = sel {
                if f.name == "_entities" {
                    for inner in &f.selection_set.selections {
                        if let Selection::InlineFragment(frag) = inner {
                            if let Some(tc) = &frag.type_condition {
                                let name = tc.to_string();
                                if seen.insert(name.clone()) {
                                    types.push(name);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    types
}

fn collect_leaf_fields(
    selections: &[apollo_compiler::executable::Selection],
    type_condition: Option<String>,
    out: &mut Vec<ResolvedField>,
) {
    use apollo_compiler::executable::Selection;
    for sel in selections {
        match sel {
            Selection::Field(f) => {
                out.push(ResolvedField {
                    field_name: f.name.to_string(),
                    type_condition: type_condition.clone(),
                });
            }
            Selection::InlineFragment(frag) => {
                let tc = frag
                    .type_condition
                    .as_ref()
                    .map(|t| t.to_string())
                    .or_else(|| type_condition.clone());
                collect_leaf_fields(&frag.selection_set.selections, tc, out);
            }
            Selection::FragmentSpread(_) => {}
        }
    }
}

fn map_requires(
    selections: Vec<apollo_federation::query_plan::requires_selection::Selection>,
) -> Vec<RequiresSelection> {
    selections.into_iter().map(map_requires_selection).collect()
}

fn map_requires_selection(
    sel: apollo_federation::query_plan::requires_selection::Selection,
) -> RequiresSelection {
    use apollo_federation::query_plan::requires_selection::Selection;
    match sel {
        Selection::Field(f) => RequiresSelection::Field {
            alias: f.alias.map(|a| a.to_string()),
            name: f.name.to_string(),
            selections: map_requires(f.selections),
        },
        Selection::InlineFragment(frag) => RequiresSelection::InlineFragment {
            type_condition: frag.type_condition.map(|t| t.to_string()),
            selections: map_requires(frag.selections),
        },
    }
}

fn map_sequence(seq: apollo_federation::query_plan::SequenceNode) -> PlanNode {
    PlanNode::Sequence {
        nodes: seq.nodes.into_iter().map(map_inner_node).collect(),
    }
}

fn map_parallel(par: apollo_federation::query_plan::ParallelNode) -> PlanNode {
    PlanNode::Parallel {
        nodes: par.nodes.into_iter().map(map_inner_node).collect(),
    }
}

fn map_flatten(flatt: apollo_federation::query_plan::FlattenNode) -> PlanNode {
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
    PlanNode::Flatten {
        path,
        node: Box::new(map_inner_node(*flatt.node)),
    }
}

fn map_defer(defer: apollo_federation::query_plan::DeferNode) -> PlanNode {
    let primary = defer.primary.node.map(|n| Box::new(map_inner_node(*n)));
    let deferred = defer
        .deferred
        .into_iter()
        .map(|d| DeferredBranch {
            label: d.label.map(|l| l.to_string()),
            node: d.node.map(|n| Box::new(map_inner_node(*n))),
        })
        .collect();
    PlanNode::Defer { primary, deferred }
}

fn map_condition(cond: apollo_federation::query_plan::ConditionNode) -> PlanNode {
    PlanNode::Condition {
        condition_variable: cond.condition_variable.to_string(),
        if_branch: cond.if_clause.map(|n| Box::new(map_inner_node(*n))),
        else_branch: cond.else_clause.map(|n| Box::new(map_inner_node(*n))),
    }
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

    #[test]
    #[ignore = "diagnostic helper: writes plan JSON to /tmp/mp_plan.json"]
    fn write_marketplace_plan() {
        let floorplan = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10",
        import: ["@key", "@inaccessible"])
type Query { page(path: String!, openSection: ID): Page }
type Page { id: ID! sections: [SectionStub!]! openSection: Section }
union SectionStub = BasicSectionStub | BadgeSectionStub
type BasicSectionStub @key(fields: "id") { id: ID! data: SectionStubData! @inaccessible }
type BadgeSectionStub @key(fields: "id") { id: ID! data: SectionStubData! @inaccessible badgeData: BadgeSectionStubData! @inaccessible }
type SectionStubData { label: String }
union BadgeSectionStubData = RewardCount | PromoCount
type RewardCount @key(fields: "id") { id: ID! }
type PromoCount @key(fields: "id") { id: ID! }
type Section { id: ID! children: [Container!]! }
interface Container { id: ID! children: [Component!]! }
type StaticContainer implements Container { id: ID! children: [Component!]! }
type MarketList implements Container @key(fields: "id") { id: ID! children: [Component!]! marketParameters: MarketParameters @inaccessible }
type MarketParameters { organization: String! sport: String! competition: String! limit: Int! }
union Component = EmptyComponent | MyRewardsUI | MyPromoListUI
type EmptyComponent { id: ID! }
type MyRewardsUI @key(fields: "id") { id: ID! data: MyRewardsList @inaccessible }
type MyRewardsList @key(fields: "id") { id: ID! }
type MyPromoListUI @key(fields: "id") { id: ID! data: MyPromosList @inaccessible }
type MyPromosList @key(fields: "id") { id: ID! }"#;

        let promos = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])
type PromoCount @key(fields: "id") { id: ID! count: Int! }
type MyPromosList @key(fields: "id") { id: ID! promos: [Promo!]! }
type Promo { id: ID! name: String! details: String! tags: [String!]! }"#;

        let loyalty = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key"])
type RewardCount @key(fields: "id") { id: ID! count: Int! }
type MyRewardsList @key(fields: "id") { id: ID! rewards: [Reward!]! }
type Reward { id: ID! name: String! amount: Int! tags: [String!]! }"#;

        let blueprint = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@external", "@requires"])
type BasicSectionStub @key(fields: "id") { id: ID! label: String! @requires(fields: "data { label }") data: SectionStubData! @external }
type BadgeSectionStub @key(fields: "id") { id: ID! label: String! @requires(fields: "data { label }") count: Int! @requires(fields: "badgeData { ...on RewardCount { count } ...on PromoCount { count } }") data: SectionStubData! @external badgeData: BadgeSectionStubData! @external }
type SectionStubData @external { label: String }
union BadgeSectionStubData = RewardCount | PromoCount
type RewardCount @external { count: Int! }
type PromoCount @external { count: Int! }
type MyRewardsUI @key(fields: "id") { id: ID! filters: [FilterPill!]! @requires(fields: "data { rewards { tags } }") rewards: [RewardUI!]! @requires(fields: "data { rewards { name amount tags } }") data: MyRewardsList @external }
type RewardUI { name: String! redeem: Interaction }
type MyRewardsList @external { rewards: [Reward!]! }
type Reward @external { name: String! amount: Int! tags: [String!]! }
type MyPromoListUI @key(fields: "id") { id: ID! filters: [FilterPill!]! @requires(fields: "data { promos { tags } }") promos: [PromoUI!]! @requires(fields: "data { promos { name details tags } }") data: MyPromosList @external }
type PromoUI { name: String! redeem: Interaction }
type MyPromosList @external { promos: [Promo!]! }
type Promo @external { name: String! details: String! tags: [String!]! }
type MarketCardUI @key(fields: "id") { id: ID! data: MarketData @external title: String! @requires(fields: "data { title }") cells: [MarketCell!]! @requires(fields: "data { selections { name odds { numerator denominator } } }") }
type MarketCell { label: String! interaction: Interaction! }
type MarketData @external { title: String! selections: [Selection!]! }
type Selection @external { name: String! odds: Odds! }
type Odds @external { numerator: Int! denominator: Int! }
type FilterPill { label: String! interaction: Interaction }
union Interaction = NavigateInteraction | ActivateMyRewardListFilterInteraction
type NavigateInteraction { path: String! }
type ActivateMyRewardListFilterInteraction { filter: String! }"#;

        let marketplace = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@external", "@requires", "@override"])
interface Container { id: ID! children: [Component!]! }
type MarketList implements Container @key(fields: "id") { id: ID! children: [Component!]! @requires(fields: "marketParameters { organization sport competition limit }") @override(from: "floorplan") marketParameters: MarketParameters @external }
union Component = MarketCardUI
type MarketParameters @external { organization: String! sport: String! competition: String! limit: Int! }
type MarketCardUI @key(fields: "id") { id: ID! data: MarketData }
type MarketData { id: ID! title: String! selections: [Selection!]! }
type Selection { id: ID! name: String! odds: Odds! }
type Odds { id: ID! numerator: Int! denominator: Int! }"#;

        let subgraphs = vec![
            crate::dto::SubgraphInput {
                name: "floorplan".into(),
                sdl: floorplan.into(),
            },
            crate::dto::SubgraphInput {
                name: "promos".into(),
                sdl: promos.into(),
            },
            crate::dto::SubgraphInput {
                name: "loyalty".into(),
                sdl: loyalty.into(),
            },
            crate::dto::SubgraphInput {
                name: "blueprint".into(),
                sdl: blueprint.into(),
            },
            crate::dto::SubgraphInput {
                name: "marketplace".into(),
                sdl: marketplace.into(),
            },
        ];
        let compose_result = compose_inner(&subgraphs);
        if !compose_result["ok"].as_bool().unwrap_or(false) {
            std::fs::write(
                "/tmp/mp_compose_err.json",
                serde_json::to_string_pretty(&compose_result).unwrap(),
            )
            .unwrap();
            panic!("composition failed — see /tmp/mp_compose_err.json");
        }
        let sdl = compose_result["supergraph_sdl"].as_str().unwrap();
        let query = r#"query {
  page(path: "/reward-hub") {
    id
    sections {
      __typename
      ... on BasicSectionStub { label }
      ... on BadgeSectionStub { label count }
    }
    openSection {
      id
      children {
        id
        __typename
        children {
          __typename
          ... on MyRewardsUI {
            id
            filters { label }
            rewards { name }
          }
          ... on MyPromoListUI {
            id
            filters { label }
            promos { name }
          }
          ... on MarketCardUI {
            id
            title
            cells { label }
          }
        }
      }
    }
  }
}"#;
        let result = plan(sdl, query, None);
        let json = serde_json::to_string_pretty(&result["query_plan"]).unwrap();
        std::fs::write("/tmp/mp_plan.json", &json).unwrap();
        assert!(
            result["ok"].as_bool().unwrap_or(false),
            "plan failed:\n{}",
            json
        );
    }

    /// Supergraphs that use `@context` (for: SECURITY) must be accepted by the
    /// query planner, not rejected with "feature … is for: SECURITY but is unsupported".
    #[test]
    fn plan_accepts_context_spec() {
        let layout = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@inaccessible"])
{
  query: Query
}
type Query { page(id: ID!): Page }
type Page { children: [Component!]! }
union Component = MarketCardUI
type MarketCardUI @key(fields: "id") { id: ID! data: Market @inaccessible }
type Market @key(fields: "id") { id: ID! }"#;

        let blueprint = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@external", "@requires", "@inaccessible", "@context"])
type Market @key(fields: "id") @context(name: "marketContext") {
  id: ID!
  name: String! @external
  ui: MarketCardUI @requires(fields: "name")
}
type MarketCardUI @key(fields: "id") {
  id: ID!
  title: String! @requires(fields: "data { name }")
  data: Market @external
}"#;

        let sportsbook = r#"extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@external", "@requires", "@inaccessible"])
{
  query: Query
}
type Query { oldPage(id: ID!): OldPage }
type OldPage { children: [OldPageChildren!]! }
union OldPageChildren = Market
type Market @key(fields: "id") { id: ID! name: String! }"#;

        let subgraphs = vec![
            crate::dto::SubgraphInput {
                name: "layout".into(),
                sdl: layout.into(),
            },
            crate::dto::SubgraphInput {
                name: "blueprint".into(),
                sdl: blueprint.into(),
            },
            crate::dto::SubgraphInput {
                name: "sportsbook".into(),
                sdl: sportsbook.into(),
            },
        ];

        let compose_result = compose_inner(&subgraphs);
        assert!(
            compose_result["ok"].as_bool().unwrap_or(false),
            "composition failed: {}",
            compose_result
        );
        let supergraph_sdl = compose_result["supergraph_sdl"]
            .as_str()
            .expect("no supergraph_sdl in compose result");

        let operation = r#"{ oldPage(id: "1") { children { ... on Market { ui { title } } } } }"#;
        let result = plan(supergraph_sdl, operation, None);

        assert!(
            result["ok"].as_bool().unwrap_or(false),
            "plan failed with @context supergraph — errors: {}",
            result["errors"]
        );
    }
}
