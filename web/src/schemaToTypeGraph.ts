import { parse, Kind } from "graphql";
import type {
  DocumentNode,
  DefinitionNode,
  DirectiveNode,
  NamedTypeNode,
  ListTypeNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  InterfaceTypeDefinitionNode,
  InputObjectTypeDefinitionNode,
} from "graphql";

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
// Internal helpers
// ---------------------------------------------------------------------------

type TypeNode = NamedTypeNode | ListTypeNode | NonNullTypeNode;

/** Unwrap NonNull/List wrappers to reach the named type. */
function namedType(t: TypeNode): string {
  if (t.kind === Kind.NAMED_TYPE) return t.name.value;
  return namedType(t.type);
}

/** Extract a string/enum argument value from a directive node. */
function argValue(dir: DirectiveNode, argName: string): string | null {
  const arg = dir.arguments?.find((a) => a.name.value === argName);
  if (!arg) return null;
  if (arg.value.kind === Kind.STRING) return arg.value.value;
  if (arg.value.kind === Kind.ENUM) return arg.value.value;
  return null;
}

/** Built-in GraphQL scalar names — excluded from the type graph. */
const BUILTIN_SCALARS = new Set(["String", "Boolean", "Int", "Float", "ID"]);

/** Federation-internal type name prefixes to exclude from the type graph. */
function isFederationInternal(name: string): boolean {
  return (
    name.startsWith("join__") ||
    name.startsWith("link__") ||
    name.startsWith("federation__") ||
    name === "_Service" ||
    name === "_Any" ||
    name === "_FieldSet" ||
    name === "_Entity"
  );
}

/** Root operation type names to exclude from domain-type nodes. */
const ROOT_OPERATION_TYPES = new Set(["Query", "Mutation", "Subscription"]);

/** Federation-internal enum names to skip. */
function isFederationEnum(name: string): boolean {
  return (
    name === "join__Graph" ||
    name === "link__Import" ||
    name.startsWith("join__") ||
    name.startsWith("link__")
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a supergraph SDL string and extract the full type graph.
 *
 * Pass 1: collect all named types (Object, Interface, Union, Input, Scalar, Enum),
 *         skipping built-ins, federation internals, and root operation types.
 *         Collect @join__type(graph:) directives to determine subgraph ownership.
 *
 * Pass 2: collect field-return-type edges from Object, Interface, and Input types.
 *         An edge is emitted when both the source and target types exist as nodes
 *         (after filtering) and source ≠ target.
 *
 * The returned graph is the full unfiltered set. The TypeGraph component applies
 * scalar/enum visibility and subgraph filtering before rendering.
 */
export function schemaToTypeGraph(supergraphSdl: string): TypeGraph {
  let doc: DocumentNode;
  try {
    doc = parse(supergraphSdl);
  } catch {
    return { nodes: [], edges: [], subgraphs: [] };
  }

  // --- Pass 1: collect all named types ---

  // typeMap: typeName → { kind, subgraph (first seen), subgraphs (all seen) }
  const typeMap = new Map<
    string,
    { kind: TypeKind; subgraph: string | null; subgraphs: string[] }
  >();

  for (const def of doc.definitions) {
    switch (def.kind) {
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_EXTENSION: {
        const name = (def as ObjectTypeDefinitionNode | ObjectTypeExtensionNode).name.value;
        if (ROOT_OPERATION_TYPES.has(name) || isFederationInternal(name)) break;

        const existing = typeMap.get(name);
        const joinSubgraphs = extractJoinSubgraphs(def);

        if (!existing) {
          typeMap.set(name, {
            kind: "object",
            subgraph: joinSubgraphs[0] ?? null,
            subgraphs: joinSubgraphs,
          });
        } else {
          // Merge additional subgraphs from extensions.
          for (const sg of joinSubgraphs) {
            if (!existing.subgraphs.includes(sg)) {
              existing.subgraphs.push(sg);
              if (!existing.subgraph) existing.subgraph = sg;
            }
          }
        }
        break;
      }

      case Kind.INTERFACE_TYPE_DEFINITION: {
        const name = (def as InterfaceTypeDefinitionNode).name.value;
        if (isFederationInternal(name)) break;

        const joinSubgraphs = extractJoinSubgraphs(def);
        if (!typeMap.has(name)) {
          typeMap.set(name, {
            kind: "interface",
            subgraph: joinSubgraphs[0] ?? null,
            subgraphs: joinSubgraphs,
          });
        }
        break;
      }

      case Kind.UNION_TYPE_DEFINITION: {
        const name = def.name.value;
        if (isFederationInternal(name)) break;

        const joinSubgraphs = extractJoinSubgraphs(def);
        if (!typeMap.has(name)) {
          typeMap.set(name, {
            kind: "union",
            subgraph: joinSubgraphs[0] ?? null,
            subgraphs: joinSubgraphs,
          });
        }
        break;
      }

      case Kind.INPUT_OBJECT_TYPE_DEFINITION: {
        const name = (def as InputObjectTypeDefinitionNode).name.value;
        if (isFederationInternal(name)) break;

        const joinSubgraphs = extractJoinSubgraphs(def);
        if (!typeMap.has(name)) {
          typeMap.set(name, {
            kind: "input",
            subgraph: joinSubgraphs[0] ?? null,
            subgraphs: joinSubgraphs,
          });
        }
        break;
      }

      case Kind.SCALAR_TYPE_DEFINITION: {
        const name = def.name.value;
        if (BUILTIN_SCALARS.has(name) || isFederationInternal(name)) break;

        if (!typeMap.has(name)) {
          typeMap.set(name, { kind: "scalar", subgraph: null, subgraphs: [] });
        }
        break;
      }

      case Kind.ENUM_TYPE_DEFINITION: {
        const name = def.name.value;
        if (isFederationEnum(name) || isFederationInternal(name)) break;

        const joinSubgraphs = extractJoinSubgraphs(def);
        if (!typeMap.has(name)) {
          typeMap.set(name, {
            kind: "enum",
            subgraph: joinSubgraphs[0] ?? null,
            subgraphs: joinSubgraphs,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  if (typeMap.size === 0) {
    return { nodes: [], edges: [], subgraphs: [] };
  }

  // Build node list.
  const nodes: TypeGraphNode[] = Array.from(typeMap.entries()).map(([typeName, info]) => ({
    id: typeName,
    typeName,
    kind: info.kind,
    subgraph: info.subgraph,
    subgraphs: info.subgraphs,
  }));

  // Collect all subgraph names for the palette.
  const subgraphSet = new Set<string>();
  for (const node of nodes) {
    for (const sg of node.subgraphs) subgraphSet.add(sg);
  }

  // --- Pass 2: collect field-return-type edges ---

  // Use a Set of "source->target" to deduplicate parallel edges.
  const edgeSet = new Set<string>();
  const edges: TypeGraphEdge[] = [];

  for (const def of doc.definitions) {
    let sourceTypeName: string | null = null;
    let fields: readonly { type: TypeNode }[] = [];

    if (def.kind === Kind.OBJECT_TYPE_DEFINITION || def.kind === Kind.OBJECT_TYPE_EXTENSION) {
      const d = def as ObjectTypeDefinitionNode | ObjectTypeExtensionNode;
      if (ROOT_OPERATION_TYPES.has(d.name.value) || isFederationInternal(d.name.value)) {
        continue;
      }
      sourceTypeName = d.name.value;
      fields = d.fields ?? [];
    } else if (def.kind === Kind.INTERFACE_TYPE_DEFINITION) {
      const d = def as InterfaceTypeDefinitionNode;
      if (isFederationInternal(d.name.value)) continue;
      sourceTypeName = d.name.value;
      fields = d.fields ?? [];
    } else if (def.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
      const d = def as InputObjectTypeDefinitionNode;
      if (isFederationInternal(d.name.value)) continue;
      sourceTypeName = d.name.value;
      fields = d.fields ?? [];
    } else {
      continue;
    }

    if (!sourceTypeName || !typeMap.has(sourceTypeName)) continue;

    for (const field of fields) {
      const targetTypeName = namedType(field.type as TypeNode);
      if (!typeMap.has(targetTypeName)) continue; // target not in our type set
      if (targetTypeName === sourceTypeName) continue; // self-loop

      const edgeKey = `${sourceTypeName}->${targetTypeName}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({ id: edgeKey, sourceType: sourceTypeName, targetType: targetTypeName });
      }
    }
  }

  const subgraphs = Array.from(subgraphSet).sort();

  return { nodes, edges, subgraphs };
}

/**
 * Extract the @join__type(graph: ...) directive values from a definition node.
 * Returns the list of subgraph enum values (e.g. ["USERS", "ORDERS"]).
 */
function extractJoinSubgraphs(def: DefinitionNode): string[] {
  const directives = ("directives" in def ? def.directives : undefined) ?? [];
  const result: string[] = [];
  for (const dir of directives) {
    if (dir.name.value !== "join__type") continue;
    const graph = argValue(dir as DirectiveNode, "graph");
    if (graph && !result.includes(graph)) {
      result.push(graph);
    }
  }
  return result;
}
