---
id: TASK-20
title: Implement plan() returning a slim QueryPlan DTO
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 12:55'
labels: []
milestone: m-3
dependencies:
  - TASK-14
documentation:
  - backlog/docs/doc-1 - GraphQL-Playground-Design.md
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the plan.rs stub. Produce the federation query plan for an operation and map it into OUR OWN small, stable JSON shape (do not expose apollo-federation internal types). Visualization only; not used to execute anything.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 plan() returns ok:true with a query_plan tree using only our node kinds (Fetch/Sequence/Parallel/Flatten)
- [x] #2 A multi-subgraph query yields a plan with at least one Fetch per involved subgraph, each labeled with the subgraph name
- [x] #3 No apollo-federation internal types appear in the JSON
- [x] #4 nix develop -c cargo build passes
<!-- AC:END -->







## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Keep the signature in plan.rs: `pub fn plan(supergraph_sdl: &str, operation: &str, op_name: Option<&str>) -> serde_json::Value` — do not change it.

2. Parse the supergraph SDL into a `Supergraph` instance:
   - Import `use apollo_federation::Supergraph;`
   - Call `let supergraph = Supergraph::new(supergraph_sdl)?;` (map error to `{ ok: false, errors }` envelope as described in step 4).

3. Create a query planner from the supergraph:
   - Import `use apollo_federation::query_plan::QueryPlanner;`
   - Call `let planner = QueryPlanner::new(&supergraph, Default::default())?;` — `Default::default()` produces a `QueryPlannerConfig` with safe defaults (no fragment generation, no defer support). Do not construct the config manually.

4. Parse the operation against the planner's API schema:
   - Import `use apollo_compiler::ExecutableDocument;`
   - Call `let document = ExecutableDocument::parse_and_validate(planner.api_schema().schema(), operation, "operation.graphql")?;`
   - Note: use `planner.api_schema().schema()` (returns `&Valid<Schema>`) — NOT the supergraph SDL or a separately derived API schema string. This avoids double-parsing.
   - If there are multiple named operations and `op_name` is `None`, `parse_and_validate` accepts any operation; the planner will pick the first one at step 5.

5. Convert `op_name: Option<&str>` to `Option<apollo_compiler::Name>`:
   - Import `use apollo_compiler::Name;`
   - Call `let plan_op_name = op_name.map(|n| Name::new(n).unwrap());`
   - If the name string is empty/invalid, `Name::new()` returns `None`. In that case, return an error envelope (see step 6).

6. Build the query plan:
   - Call `let plan = planner.build_query_plan(&document, plan_op_name, Default::default())?;`
   - This returns a `QueryPlan` with fields: `{ node: Option<TopLevelPlanNode>, statistics: QueryPlanningStatistics }`. You need only `node`; discard `statistics`.

7. Define our DTO in dto.rs (add alongside existing `SubgraphInput`):
   ```rust
   use serde::Serialize;

   #[derive(Debug, Serialize)]
   #[serde(tag = "kind")]
   pub enum PlanNode {
       Fetch { service: String, operation: String, operation_kind: String },
       Sequence { nodes: Vec<PlanNode> },
       Parallel { nodes: Vec<PlanNode> },
       Flatten { path: Vec<String>, node: Box<PlanNode> },
   }

   #[derive(Debug, Serialize)]
   pub struct PlanEnvelope {
       pub ok: bool,
       #[serde(skip_serializing_if = "Option::is_none")]
       pub query_plan: Option<PlanNode>,
       #[serde(default, skip_serializing_if = "Vec::is_empty")]
       pub errors: Vec<PlanError>,
   }

   #[derive(Debug, Serialize)]
   pub struct PlanError {
       pub code: String,
       pub message: String,
   }
   ```
   The `#[serde(tag = "kind")]` makes each variant serialize as `{ "kind": "Fetch", "service": ..., ... }` — exactly what the visualizer needs.

8. Write a recursive mapping function in plan.rs to convert Apollo's node tree into our DTO:
   ```rust
   fn map_node(plan_node: apollo_federation::query_plan::PlanNode) -> dto::PlanNode
   ```
   - `Fetch(Box<FetchNode>)` → `PlanNode::Fetch { service: fetch.subgraph_name.to_string(), operation: serde_json::to_value(&fetch.operation_document).unwrap().as_str().unwrap_or(""), operation_kind: format!("{}", fetch.operation_kind) }`
     - Note: `operation_document` is a `SerializableDocument` that serializes to a plain GraphQL string. Use `serde_json::to_string(&fetch.operation_document)` to get it.
   - `Sequence(SequenceNode { nodes })` → `PlanNode::Sequence { nodes: nodes.into_iter().map(map_node).collect() }`
   - `Parallel(ParallelNode { nodes })` → `PlanNode::Parallel { nodes: nodes.into_iter().map(map_node).collect() }`
   - `Flatten(FlattenNode { path, node })` → map each `FetchDataPathElement` to a String (e.g., `Key(s)` => `s.to_string()`, `AnyIndex` => `"[?]".to_string()`) and recurse on `node`. Produce `PlanNode::Flatten { path: Vec<String>, node: Box<PlanNode> }`.
   - For `Defer` and `Condition` variants, map them to the corresponding DTO variant if present (treat as passthrough; they will appear in the plan tree).

9. Handle errors uniformly:
   - Every `?` operator propagates `FederationError`. At the top of `plan()`, collect all errors into `{ ok: false, "errors": [{ code: "PLANNING_ERROR", message }] }`.
   - Use `.to_string()` on `FederationError` for the message. Do not match variants individually; a single generic code is sufficient since this is visualization-only.
   - If parsing fails (malformed supergraph SDL or invalid operation), return the error envelope immediately.

10. Return the result:
    - Success: `serde_json::json!({ "ok": true, "query_plan": mapped_node })` where `mapped_node` is a `dto::PlanNode`.
    - Error: `serde_json::json!({ "ok": false, "errors": [{ "code": "PLANNING_ERROR", "message": error_string }] })`.

11. Build and verify: run `nix develop -c cargo build -p gql-core`. Confirm zero warnings (`cargo clippy --all-targets -- -D warnings`).

Tests are a separate task (TASK-21).
<!-- SECTION:PLAN:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-20 — Implement plan() returning a slim QueryPlan DTO

## Summary
Use `apollo-federation` 2.15.0's public `QueryPlanner::build_query_plan()` to generate the query plan, then map its serializable AST into our own lightweight DTO structs. The key steps are: parse the operation against the API schema (derived from the supergraph), run the planner, and serialize only the node tree (`Fetch`/`Sequence`/`Parallel`/`Flatten`) — discarding `statistics`, `Defer`, `Condition`, `Subscription`, and rewrite metadata that the visualizer doesn't need.

## Findings

### 1. The apollo-federation crate is already wired up; no new dependency needed
The existing `compose.rs` already imports from `apollo_federation::composition::*` and `apollo_federation::error::*`. The same crate provides `Supergraph`, `query_plan::QueryPlanner`, and `query_plan::QueryPlan`. No new crates or feature flags are required.

**Source:** [router/apollo-federation/src/lib.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/lib.rs) — public module list confirms `pub mod query_plan;` is exposed.

### 2. API schema derivation already exists in api_schema.rs
`api_schema::derive_api_schema(supergraph_sdl)` calls `Supergraph::new()` → `.to_api_schema(ApiSchemaOptions::default())`. This produces the clean client-facing schema (federation directives stripped). We reuse this exact function to get the schema for operation parsing.

**Source:** [crates/gql-core/src/api_schema.rs](../crates/gql-core/src/api_schema.rs) — production-tested, already in the crate.

### 3. QueryPlanner API signature (exact, from source)
```rust
pub struct QueryPlanner { ... }

impl QueryPlanner {
    pub fn new(
        supergraph: &Supergraph,
        config: QueryPlannerConfig,
    ) -> Result<Self, FederationError>;

    pub fn build_query_plan(
        &self,
        document: &Valid<ExecutableDocument>,  // parsed operation
        operation_name: Option<Name>,           // None = first op
        options: QueryPlanOptions,
    ) -> Result<QueryPlan, FederationError>;

    pub fn api_schema(&self) -> &ValidFederationSchema;
}

pub struct QueryPlannerConfig {
    pub generate_query_fragments: bool,     // default: false
    pub subgraph_graphql_validation: bool,  // default: false (always enabled internally)
    pub incremental_delivery: QueryPlanIncrementalDeliveryConfig,
    pub debug: QueryPlannerDebugConfig,
    pub type_conditioned_fetching: bool,
}

pub struct QueryPlanOptions {
    pub override_conditions: Vec<String>,
    pub check_for_cooperative_cancellation: Option<&dyn Fn() -> ControlFlow<()>>,
    pub non_local_selections_limit_enabled: bool,  // default: true
    pub disabled_subgraph_names: IndexSet<String>,
}
```

**Source:** [router/apollo-federation/src/query_plan/query_planner.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/query_plan/query_planner.rs) — lines ~200-350.

### 4. QueryPlan and node types are already serializable (serde derive)
The entire `QueryPlan` AST has `#[derive(Serialize, Deserialize)]`. The hierarchy is:

```
QueryPlan {
    node: Option<TopLevelPlanNode>,   // our DTO target
    statistics: QueryPlanningStatistics  // discard for visualization
}

TopLevelPlanNode → PlanNode (same variants):
  - Fetch(Box<FetchNode>)
  - Sequence(SequenceNode)
  - Parallel(ParallelNode)
  - Flatten(FlattenNode)
  - Defer(DeferNode)           // skip in DTO unless @defer support needed
  - Condition(Box<ConditionNode>)  // skip unless @skip/@include needed
  - Subscription(SubscriptionNode) // skip for now

FetchNode {
    subgraph_name: Arc<str>,            // → "service" in JSON
    id: Option<u64>,                    // skip
    variable_usages: Vec<Name>,         // skip
    requires: Vec<Selection>,           // skip (internal)
    operation_document: SerializableDocument,  // → "operation" string
    operation_name: Option<Name>,       // skip
    operation_kind: OperationType,      // "query"/"mutation"/"subscription"
    input_rewrites: Arc<Vec<FetchDataRewrite>>,  // skip
    output_rewrites: Vec<Arc<FetchDataRewrite>>, // skip
    context_rewrites: Vec<Arc<FetchDataRewrite>>,// skip
}

SequenceNode { nodes: Vec<PlanNode> }
ParallelNode   { nodes: Vec<PlanNode> }
FlattenNode    { path: Vec<FetchDataPathElement>, node: Box<PlanNode> }
```

**Source:** [router/apollo-federation/src/query_plan/mod.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/query_plan/mod.rs) — full struct definitions.

### 5. SerializableDocument serializes to a plain GraphQL string
`FetchNode.operation_document` is a `SerializableDocument` that serializes as a raw GraphQL operation string (e.g., `{ userById(id: 1) { name email } }`). This is exactly the "selection text" the task asks for — no extra parsing needed.

**Source:** [router/apollo-federation/src/query_plan/serializable_document.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/query_plan/serializable_document.rs) — `Serialize` impl calls `.as_serialized().serialize(serializer)`.

### 6. Operation parsing requires apollo-compiler (already a dependency)
```rust
use apollo_compiler::ExecutableDocument;

let document = ExecutableDocument::parse_and_validate(
    api_schema.schema(),   // Valid<Schema> from derive_api_schema()
    operation_str,         // user's query string
    "operation.graphql",   // arbitrary filename for diagnostics
)?;
```

**Source:** [router/apollo-federation/src/query_plan/query_planner.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/query_plan/query_planner.rs) — test at line ~1300 shows this exact pattern.

### 7. DTO design: map only the node tree, discard Apollo internals
The task says "do not expose apollo-federation internal types" in the JSON. The cleanest approach is to define our own serde-serializable structs that mirror only what the visualizer needs:

```rust
#[derive(Debug, Serialize)]
struct PlanEnvelope { ok: bool, query_plan: Option<PlanNode>, errors: Vec<Error> }

#[derive(Debug, Serialize)]
#[serde(tag = "kind")]
enum PlanNode {
    Fetch { service: String, operation: String, operation_kind: String },
    Sequence { nodes: Vec<PlanNode> },
    Parallel   { nodes: Vec<PlanNode> },
    Flatten    { path: Vec<String>, node: Box<PlanNode> },
}

#[derive(Debug, Serialize)]
struct Error { code: String, message: String }
```

This is a **manual mapping** from `apollo_federation::query_plan` types — we visit the tree recursively and construct our DTO. This guarantees no Apollo internal fields leak into the JSON output (satisfies AC #3).

### 8. Error handling paths
- `Supergraph::new()` fails → malformed supergraph SDL → return `{ ok: false, errors }`
- `QueryPlanner::new()` fails → internal error → map to generic error envelope
- `build_query_plan()` fails → `FederationError` (e.g., "no plan found") → map to error envelope
- Operation parse fails against API schema → `apollo_compiler::Errors` → return as `{ ok: false, errors }`

**Source:** [router/apollo-federation/src/error.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/error.rs) — `FederationError` enum with variants like `NoPlanFound`, `UnknownOperation`, etc.

## Tradeoffs Between Approaches

### Option A: Manual DTO mapping (recommended)
**Pros:** Complete control over JSON shape; no Apollo internals leak; stable across apollo-federation upgrades; matches the design doc's principle of "slim QueryPlan DTO owned by us."

**Cons:** ~100 lines of recursive visitor code; must keep in sync with node variants if new ones are added.

### Option B: Serialize QueryPlan directly, then strip unwanted fields
**Pros:** Minimal code — just `serde_json::to_value(&plan)` and remove top-level keys like `statistics`.

**Cons:** Still exposes Apollo internal fields (`id`, `variable_usages`, `requires`, `operation_name`, `operation_kind`, `input_rewrites`, etc.) in the JSON envelope. Violates AC #3 ("No apollo-federation internal types appear in the JSON") because `SerializableDocument` is an Apollo type and its serialized form contains Apollo-specific GraphQL (e.g., `__typename`, spread fragments for entity resolution). The visualizer would see internals like `_entities` references and fragment names it doesn't understand.

### Option C: Use `QueryPlan::to_string()` formatting
**Pros:** Human-readable output.

**Cons:** Returns a GraphQL-syntax string, not structured JSON — defeats the purpose of a serializable DTO for the JS tree visualizer.

## Gotchas

1. **`apollo-federation` has NO semver guarantees.** The crate is labeled "internal to Apollo Router, not intended for direct use." Any version bump may break our imports. Pin `=2.15.0` and treat upgrades as deliberate events (as the design doc says).

2. **Operation must be parsed against the API schema, NOT the supergraph SDL.** The supergraph contains federation directives (`@join__*`, `_entities`) that are invisible to the query planner's internal logic. Parse against `api_schema.schema()` which is a clean `Valid<Schema>`.

3. **`operation_name` must be `Option<apollo_compiler::Name>`, not `&str`.** Convert from `Option<String>` via `op_name.map(|n| Name::new(n).unwrap())`. If the name is invalid, fall through to error handling.

4. **`QueryPlannerConfig::default()` is safe.** All defaults are production-safe: no fragment generation, no defer support, no type-conditioned fetching. These can be enabled later if needed.

5. **`FederationError` is not `std::error::Error` — it's a custom enum.** Map it to our error envelope by calling `.to_string()` for the message and using a generic code like "PLANNING_ERROR". Don't expose internal variant names.

6. **WASM compilation:** The existing Cargo.toml already has the `getrandom` wasm_js feature flag for apollo-federation's transitive dependency. No changes needed here — proven by Spike 0.

7. **Flatten path element serialization:** `FetchDataPathElement` is an enum (`Key`, `AnyIndex`, `TypenameEquals`, `Parent`). When mapping to our DTO, flatten it to a simple `Vec<String>` (e.g., `["hotels", "@"]`) — the visualizer just needs readable paths.

8. **The `requires` field in FetchNode:** When present, it means the fetch includes extra fields needed for downstream operations (the `=>` syntax in query plan display). In our DTO, these are already embedded in the serialized `operation` string, so no special handling is needed.

## Exact API Signatures the Developer Will Call

### From `apollo-federation` 2.15.0
```rust
use apollo_federation::Supergraph;
use apollo_federation::query_plan::QueryPlanner;
use apollo_federation::query_plan::QueryPlanConfig;  // ← note: actually QueryPlannerConfig

let supergraph = Supergraph::new(supergraph_sdl)?;
let planner = QueryPlanner::new(&supergraph, Default::default())?;
let plan = planner.build_query_plan(&document, op_name, Default::default())?;
```

### From `apollo-compiler` (already a dep)
```rust
use apollo_compiler::ExecutableDocument;

let document = ExecutableDocument::parse_and_validate(
    api_schema.schema(),  // Valid<Schema>
    operation_str,
    "operation.graphql",
)?;
```

### From our existing `api_schema.rs`
```rust
pub(crate) fn derive_api_schema(supergraph_sdl: &str) -> Result<String, FederationError>;
// Returns SDL string — parse it into Valid<Schema> for apollo-compiler.
```

## Sources

**Kept:**
- [Apollo Router apollo-federation/src/lib.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/lib.rs) — confirms public module exports including `query_plan` and `Supergraph`. Primary source for crate API surface.
- [router/apollo-federation/src/query_plan/mod.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/query_plan/mod.rs) — complete struct definitions for QueryPlan, FetchNode, SequenceNode, ParallelNode, FlattenNode, DeferNode. Primary source for node tree structure.
- [router/apollo-federation/src/query_plan/query_planner.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/query_plan/query_planner.rs) — QueryPlanner constructor, build_query_plan(), config types, and test examples showing usage patterns. Primary source for planner API.
- [router/apollo-federation/src/query_plan/serializable_document.rs](https://github.com/apollographql/router/blob/main/apollo-federation/src/query_plan/serializable_document.rs) — confirms SerializableDocument serializes as a plain GraphQL string.
- [Apollo Federation Query Plans docs](https://www.apollographql.com/docs/graphos/schema-design/federated-schemas/reference/query-plans) — official documentation of query plan node types, semantics, and JSON format.
- [Apollo Federation design doc (doc-1)](../backlog/docs/doc-1%20-%20GraphQL-Playground-Design.md) — project context, WASM boundary contract, DTO ownership principle.

**Dropped:**
- [graphql-composition crate docs](https://docs.rs/graphql-composition/) — Grafbase's composition-only crate; doesn't provide query planning. Not relevant since apollo-federation already handles both.
- [hive-router-query-planner crate](https://crates.io/crates/hive-router-query-planner) — standalone Rust query planner wrapper; would add an unnecessary dependency when we already have apollo-federation 2.15.0 pinned and working in WASM.
- [Apollo Gateway JS docs](https://www.apollographql.com/docs/apollo-server/) — JavaScript implementation details irrelevant to our Rust/WASM approach.

## Gaps & Suggested Next Steps

1. **`QueryPlanStatistics` serialization:** The `statistics` field contains `Cell<usize>` and `f64` which serialize oddly (NaN → null). Since we discard this entirely in our DTO, it's a non-issue — but worth noting if the visualizer ever wants plan cost metrics.

2. **`@defer` support in DTO:** Not required for MVP. If the visualizer later needs to show `@defer` plans, add a `Defer` variant to our `PlanNode` enum. The source struct is well-documented with `PrimaryDeferBlock` and `DeferredDeferBlock`.

3. **Flatten path element stringification:** The exact format (`["hotels", "@"]`) isn't specified by the task — just "a path string." Suggest serializing as a simple JSON array of strings for maximum compatibility with the visualizer.

4. **`operation_kind` in DTO:** The task mentions `Fetch/Sequence/Parallel/Flatten` node kinds but doesn't specify whether `operation_kind` should appear on Fetch nodes. Recommend including it (`"query"` / `"mutation"`) since it's cheap and useful for the visualizer.

5. **Test fixtures:** The existing compose tests use two-subgraph schemas (products + reviews). Reuse these as query plan test inputs — they exercise multi-subgraph fetching with entity resolution (Flatten nodes).

<!-- SECTION:NOTES:END -->
