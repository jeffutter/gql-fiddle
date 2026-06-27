// The TypeScript view of the Rust/WASM core. These shapes mirror the JSON
// envelopes returned by crates/gql-core (see its dto.rs). The UI depends on
// these types, never on apollo-federation internals.

// Tour types are defined in share.ts (alongside WorkspacePayload which they
// reference) and re-exported here for consumer convenience.
export type { Tour, TourStep } from "../share";

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line: number;
  col: number;
  len: number;
}

export interface SubgraphInput {
  name: string;
  sdl: string;
}

export interface QueryTab {
  name: string;
  query: string;
}

/** A node in a Rust-computed graph (EntityGraph or TypeGraph). */
export interface RustGraphNode {
  /** For entity graph: "SUBGRAPH:TypeName". For type graph: the type name. */
  id: string;
  /** The type name. */
  label: string;
  /** Subgraph enum values that declare this type. */
  subgraphs: string[];
  /** Type kind — only present for type graph nodes: "object" | "interface" | "union" | "input" | "scalar" | "enum". */
  kind?: string;
}

/** A directed edge in a Rust-computed graph. */
export interface RustGraphEdge {
  source: string;
  target: string;
  /** For entity edges: the @key(fields) string of the target entity. */
  label?: string;
}

/** A pre-computed graph from the Rust compose result. */
export interface RustGraph {
  nodes: RustGraphNode[];
  edges: RustGraphEdge[];
  subgraphs: string[];
}

/**
 * A single field node in the schema containment hierarchy tree.
 *
 * Mirrors `SchemaTreeField` in crates/gql-core/src/dto.rs.
 * Recursive: each non-leaf field carries its children inline.
 */
export interface SchemaTreeField {
  /** Field name, or "… on MemberType" for union inline-fragment stubs. */
  fieldName: string;
  /** The unwrapped named type (e.g. "User", "String"). */
  typeName: string;
  /** True if the return type is wrapped in a List at any nesting level. */
  isList: boolean;
  /** True if the outermost type wrapper is NonNull. */
  isNonNull: boolean;
  /** True if the return type is a scalar or enum (no children to expand). */
  isLeaf: boolean;
  /** True when this type is already an ancestor in the current traversal path (cycle guard). */
  isCycleRef: boolean;
  /** Child fields — populated for non-cycle, non-leaf object/interface/union nodes. */
  children: SchemaTreeField[];
}

/** One root operation type node in the schema containment hierarchy tree. */
export interface SchemaTreeNode {
  /** One of "Query", "Mutation", "Subscription". */
  rootTypeName: "Query" | "Mutation" | "Subscription";
  /** Top-level fields on the root type. */
  fields: SchemaTreeField[];
}

/** Full schema containment hierarchy tree, pre-computed by the Rust compose() call. */
export interface SchemaTree {
  /** One entry per root type that exists in the schema. */
  roots: SchemaTreeNode[];
}

export type ComposeResult =
  | {
      ok: true;
      supergraph_sdl: string;
      api_schema_sdl: string;
      hints: CompositionHint[];
      entity_graph?: RustGraph;
      type_graph?: RustGraph;
      schema_tree?: SchemaTree;
    }
  | { ok: false; errors: CompositionError[] };

export interface CompositionHint {
  code: string;
  message: string;
}

export interface CompositionError {
  code: string;
  message: string;
  locations?: { line: number; col: number }[];
}

export interface MockResult {
  data: unknown;
  errors?: { message: string }[];
}

export type RequiresSelection =
  | { kind: "Field"; name: string; alias?: string; selections?: RequiresSelection[] }
  | { kind: "InlineFragment"; typeCondition?: string; selections: RequiresSelection[] };

export type PlanNode =
  | {
      kind: "Fetch";
      service: string;
      operation: string;
      operation_kind: string;
      requires?: RequiresSelection[];
      resolved_fields?: Array<{ field_name: string; type_condition: string | null }>;
      entity_types?: string[];
    }
  | { kind: "Sequence"; nodes: PlanNode[] }
  | { kind: "Parallel"; nodes: PlanNode[] }
  | { kind: "Flatten"; path: string[]; node: PlanNode }
  | { kind: "Subscription"; primary: PlanNode; rest?: PlanNode }
  | { kind: "Defer"; primary?: PlanNode; deferred: DeferredBranch[] }
  | { kind: "Condition"; conditionVariable: string; ifBranch?: PlanNode; elseBranch?: PlanNode };

export interface DeferredBranch {
  label?: string;
  node?: PlanNode;
}

export type PlanResult =
  | { ok: true; query_plan: PlanNode }
  | { ok: false; errors: { code: string; message: string }[] };

/** Functions exported by the WASM module, wrapped with typed I/O. */
export interface GqlCore {
  validateSubgraph(sdl: string): { diagnostics: Diagnostic[] };
  compose(subgraphs: SubgraphInput[]): ComposeResult;
  validateQuery(supergraphSdl: string, operation: string): { diagnostics: Diagnostic[] };
  plan(supergraphSdl: string, operation: string, opName?: string): PlanResult;
  /**
   * Mock-execute an operation. `mockConfig` is a JSON string (not YAML) mapping
   * "TypeName.fieldName" keys to override rules. Pass `"{}"` for default behaviour.
   */
  executeMock(
    supergraphSdl: string,
    operation: string,
    seed: number,
    mockConfig: string,
  ): MockResult;
  nodeAtPosition(
    sdl: string,
    line: number,
    col: number,
  ): { typeName: string; fieldName?: string } | null;
}
