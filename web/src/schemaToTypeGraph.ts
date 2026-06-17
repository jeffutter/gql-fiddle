import type { RustGraph } from "./core/types";

/**
 * Data model for the schema type graph derived from a supergraph SDL.
 *
 * Unlike the entity ownership graph (which focuses on cross-subgraph boundaries),
 * this shows ALL named types and their field-return-type relationships, giving
 * schema designers a bird's-eye view of their type topology.
 */

export type TypeKind = "object" | "interface" | "union" | "input" | "scalar" | "enum";

export interface TypeGraphNode {
  /** Unique id — the type name (e.g. "User"). */
  id: string;
  typeName: string;
  kind: TypeKind;
  /** Primary owning subgraph name (first @join__type(graph:) directive value). */
  subgraph: string | null;
  /** All subgraphs that declare this type (for types shared across subgraphs). */
  subgraphs: string[];
}

export interface TypeGraphEdge {
  /** Unique id, e.g. "User->Review". */
  id: string;
  sourceType: string;
  targetType: string;
}

export interface TypeGraph {
  nodes: TypeGraphNode[];
  edges: TypeGraphEdge[];
  /** Sorted unique subgraph names present in the schema. */
  subgraphs: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a pre-computed Rust type graph DTO to the TypeGraph used by the UI.
 *
 * The Rust side emits one node per domain type with id = typeName, subgraphs,
 * and kind ("object" | "interface" | "union" | "input" | "scalar" | "enum").
 * Edges carry source and target type names with no label.
 *
 * Falls back to an empty graph when the input is absent or malformed.
 */
export function schemaToTypeGraph(rustGraph: RustGraph): TypeGraph {
  if (!rustGraph || rustGraph.nodes.length === 0) {
    return { nodes: [], edges: [], subgraphs: [] };
  }

  const nodes: TypeGraphNode[] = rustGraph.nodes.map((n) => ({
    id: n.id,
    typeName: n.label,
    kind: (n.kind ?? "object") as TypeKind,
    subgraph: n.subgraphs[0] ?? null,
    subgraphs: n.subgraphs,
  }));

  const edges: TypeGraphEdge[] = rustGraph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    sourceType: e.source,
    targetType: e.target,
  }));

  return { nodes, edges, subgraphs: rustGraph.subgraphs };
}
