import { parse, Kind } from "graphql";
import type {
  DocumentNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  DirectiveNode,
  NamedTypeNode,
  ListTypeNode,
  NonNullTypeNode,
} from "graphql";

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
// Internal helpers
// ---------------------------------------------------------------------------

type TypeNode = NamedTypeNode | ListTypeNode | NonNullTypeNode;

/** Unwrap NonNull/List wrappers to reach the named type. */
function namedType(t: TypeNode): string {
  if (t.kind === Kind.NAMED_TYPE) return t.name.value;
  return namedType(t.type);
}

/** Extract a string argument value from a directive node. */
function argString(dir: DirectiveNode, argName: string): string | null {
  const arg = dir.arguments?.find((a) => a.name.value === argName);
  if (!arg) return null;
  if (arg.value.kind === Kind.STRING) return arg.value.value;
  if (arg.value.kind === Kind.ENUM) return arg.value.value;
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a supergraph SDL string and extract the entity ownership graph.
 *
 * Works by scanning `@join__type(graph: G, key: "...")` directives on each
 * ObjectTypeDefinition / ObjectTypeExtension in the supergraph SDL.  Types
 * without any `key` argument in their `@join__type` directives are not
 * entities and are excluded.
 *
 * Cross-subgraph edges are derived from field return types: if field F on
 * entity E (owned by subgraph A) returns entity type T (owned by subgraph B
 * where B ≠ A), an edge A → B for type T is emitted.
 */
export function schemaToEntityGraph(supergraphSdl: string): EntityGraph {
  let doc: DocumentNode;
  try {
    doc = parse(supergraphSdl);
  } catch {
    return { nodes: [], edges: [], subgraphs: [] };
  }

  // --- Pass 1: collect entity ownership.
  // entityOwnership: typeName → { subgraph → keyFields[] }
  const entityOwnership = new Map<string, Map<string, string[]>>();

  for (const def of doc.definitions) {
    if (def.kind !== Kind.OBJECT_TYPE_DEFINITION && def.kind !== Kind.OBJECT_TYPE_EXTENSION) {
      continue;
    }
    const typeDef = def as ObjectTypeDefinitionNode | ObjectTypeExtensionNode;
    const typeName = typeDef.name.value;

    for (const dir of typeDef.directives ?? []) {
      if (dir.name.value !== "join__type") continue;
      const graph = argString(dir, "graph");
      const key = argString(dir, "key");
      if (!graph || !key) continue; // not an entity entry or graph arg missing

      if (!entityOwnership.has(typeName)) {
        entityOwnership.set(typeName, new Map());
      }
      const bySubgraph = entityOwnership.get(typeName)!;
      if (!bySubgraph.has(graph)) {
        bySubgraph.set(graph, []);
      }
      bySubgraph.get(graph)!.push(key);
    }
  }

  if (entityOwnership.size === 0) {
    return { nodes: [], edges: [], subgraphs: [] };
  }

  // --- Build nodes from the ownership map.
  const nodes: EntityNode[] = [];
  const subgraphSet = new Set<string>();

  for (const [typeName, bySubgraph] of entityOwnership) {
    for (const [subgraph, keyFields] of bySubgraph) {
      nodes.push({
        id: `${subgraph}:${typeName}`,
        typeName,
        subgraph,
        keyFields,
      });
      subgraphSet.add(subgraph);
    }
  }

  // --- Pass 2: build cross-subgraph edges.
  // For each object type definition that is an entity, look at its fields.
  // If the return type is itself an entity owned by a DIFFERENT subgraph,
  // emit an edge from each of the source type's owner subgraphs to the
  // target type's owner subgraphs.
  //
  // Edge key: "sourceSubgraph->targetSubgraph:TargetType"
  // We merge duplicates and keep the first key fields string encountered.
  const edgeMap = new Map<
    string,
    { sourceSubgraph: string; targetSubgraph: string; typeName: string; keyFields: string }
  >();

  for (const def of doc.definitions) {
    if (def.kind !== Kind.OBJECT_TYPE_DEFINITION && def.kind !== Kind.OBJECT_TYPE_EXTENSION) {
      continue;
    }
    const typeDef = def as ObjectTypeDefinitionNode | ObjectTypeExtensionNode;
    const sourceTypeName = typeDef.name.value;

    const sourceOwnership = entityOwnership.get(sourceTypeName);
    if (!sourceOwnership) continue; // not an entity type

    for (const field of typeDef.fields ?? []) {
      const returnTypeName = namedType(field.type);
      const targetOwnership = entityOwnership.get(returnTypeName);
      if (!targetOwnership) continue; // return type is not an entity

      // For each (sourceSubgraph, targetSubgraph) pair where they differ,
      // produce an edge.
      for (const [sourceSubgraph] of sourceOwnership) {
        for (const [targetSubgraph, targetKeyFields] of targetOwnership) {
          if (sourceSubgraph === targetSubgraph) continue; // same subgraph

          const edgeKey = `${sourceSubgraph}->${targetSubgraph}:${returnTypeName}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              sourceSubgraph,
              targetSubgraph,
              typeName: returnTypeName,
              keyFields: targetKeyFields[0] ?? "",
            });
          }
        }
      }
    }
  }

  const edges: EntityEdge[] = Array.from(edgeMap.entries()).map(([id, e]) => ({
    id,
    ...e,
  }));

  const subgraphs = Array.from(subgraphSet).sort();

  return { nodes, edges, subgraphs };
}
