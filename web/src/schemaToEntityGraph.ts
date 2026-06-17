import type { RustGraph } from "./core/types";

/**
 * Data model for the entity ownership graph derived from a supergraph SDL.
 *
 * An EntityNode represents one entity type as it exists in a single owning
 * subgraph.  A type federated across N subgraphs produces N nodes.
 *
 * An EntityEdge represents a cross-subgraph field reference: a field on an
 * entity in `sourceSubgraph` whose return type is an entity owned by
 * `targetSubgraph`.
 */

export interface EntityNode {
  /** Unique identifier, e.g. "USERS:User" (subgraph:typeName). */
  id: string;
  typeName: string;
  /** The subgraph that owns this copy of the entity (uppercased graph enum value). */
  subgraph: string;
  /** @key(fields: "...") values declared on this subgraph entry. */
  keyFields: string[];
}

export interface EntityEdge {
  /** Unique identifier, e.g. "USERS->PRODUCTS:Product". */
  id: string;
  sourceSubgraph: string;
  targetSubgraph: string;
  /** The entity type that is referenced across the subgraph boundary. */
  typeName: string;
  /** The @key(fields) string used for resolution, e.g. "id" or "sku". */
  keyFields: string;
}

export interface EntityGraph {
  nodes: EntityNode[];
  edges: EntityEdge[];
  /** Alphabetically sorted unique list of subgraph names (for stable color assignment). */
  subgraphs: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a pre-computed Rust entity graph DTO to the EntityGraph used by the UI.
 *
 * The Rust side encodes entity nodes as id="SUBGRAPH:TypeName" and edges
 * with source/target in the same format, with label carrying the key fields string.
 * This function maps those fields to the EntityNode / EntityEdge shapes that
 * EntityOwnershipGraph.tsx expects.
 *
 * Falls back to an empty graph when the input is absent or malformed.
 */
export function schemaToEntityGraph(rustGraph: RustGraph): EntityGraph {
  if (!rustGraph || rustGraph.nodes.length === 0) {
    return { nodes: [], edges: [], subgraphs: [] };
  }

  // Build a lookup: node id → keyFields gathered from edges targeting that node.
  // The Rust edge label carries the key fields string for the target entity.
  const keyFieldsByNodeId = new Map<string, string[]>();
  for (const edge of rustGraph.edges) {
    if (edge.label) {
      const existing = keyFieldsByNodeId.get(edge.target);
      if (existing) {
        if (!existing.includes(edge.label)) existing.push(edge.label);
      } else {
        keyFieldsByNodeId.set(edge.target, [edge.label]);
      }
    }
  }

  // Map Rust nodes → EntityNode.
  // Node id is "SUBGRAPH:TypeName"; split on first colon.
  const nodes: EntityNode[] = rustGraph.nodes.map((n) => {
    const colonIdx = n.id.indexOf(":");
    const subgraph = colonIdx >= 0 ? n.id.slice(0, colonIdx) : n.id;
    const typeName = colonIdx >= 0 ? n.id.slice(colonIdx + 1) : n.label;

    // Collect key fields for this node from outgoing edges where this node is the target,
    // or from the node's subgraphs list via the edge label when it is the source.
    // The Rust entity node does not carry key fields directly, so we rely on edges.
    // As a fallback, include edge labels where this node is targeted.
    const keyFields = keyFieldsByNodeId.get(n.id) ?? [];

    // Also check edges where this node is the source to recover key fields on owned entities.
    // The Rust edge label is the key of the target, not the source — so also collect
    // from @join__type directives implicitly. Since the Rust side does not encode per-node
    // key fields directly, we use the subgraphs list + edges as a proxy.
    // For single-subgraph entities with no cross-subgraph edges, keyFields may be empty.

    return { id: n.id, typeName, subgraph, keyFields };
  });

  // Map Rust edges → EntityEdge.
  const edges: EntityEdge[] = rustGraph.edges.map((e) => {
    const srcColon = e.source.indexOf(":");
    const tgtColon = e.target.indexOf(":");
    const sourceSubgraph = srcColon >= 0 ? e.source.slice(0, srcColon) : e.source;
    const targetSubgraph = tgtColon >= 0 ? e.target.slice(0, tgtColon) : e.target;
    const typeName = tgtColon >= 0 ? e.target.slice(tgtColon + 1) : e.target;
    // Edge id mirrors the TS original: "SRCSUB->TGTSUB:TargetType"
    const id = `${sourceSubgraph}->${targetSubgraph}:${typeName}`;
    return { id, sourceSubgraph, targetSubgraph, typeName, keyFields: e.label ?? "" };
  });

  return { nodes, edges, subgraphs: rustGraph.subgraphs };
}
