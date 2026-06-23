import { parse, Kind } from "graphql";
import type {
  DocumentNode,
  NamedTypeNode,
  ListTypeNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  InterfaceTypeDefinitionNode,
  UnionTypeDefinitionNode,
  SelectionSetNode,
  FragmentDefinitionNode,
} from "graphql";
import type { SchemaTreeField } from "./schemaToSchemaTree";

/**
 * Data model for the query shape tree derived from a query document + API schema SDL.
 *
 * Unlike SchemaTree (which shows the full schema), this view shows only the fields
 * selected by the active query — reflecting the shape of the response the server
 * will return.
 */

export interface QueryShapeOperation {
  /** e.g. "query GetProducts" or "query" */
  header: string;
  /** Top-level selected fields. */
  fields: SchemaTreeField[];
}

export interface QueryShapeTree {
  /** One entry per operation definition in the document. Normally just one. */
  operations: QueryShapeOperation[];
}

// ---------------------------------------------------------------------------
// Internal types (mirror schemaToSchemaTree.ts)
// ---------------------------------------------------------------------------

type TypeNode = NamedTypeNode | ListTypeNode | NonNullTypeNode;

type TypeKind = "object" | "interface" | "union" | "scalar" | "enum";

interface FieldInfo {
  name: string;
  type: TypeNode;
  isList: boolean;
  isNonNull: boolean;
}

interface TypeInfo {
  kind: TypeKind;
  fields: FieldInfo[];
  members: string[];
}

// ---------------------------------------------------------------------------
// Helpers (same logic as schemaToSchemaTree.ts)
// ---------------------------------------------------------------------------

/** Unwrap NonNull/List wrappers to reach the named type name. */
function namedTypeName(t: TypeNode): string {
  if (t.kind === Kind.NAMED_TYPE) return t.name.value;
  return namedTypeName(t.type);
}

/** Determine isList (any List wrapper) and isNonNull (outermost wrapper is NonNull). */
function typeFlags(t: TypeNode): { isList: boolean; isNonNull: boolean } {
  let isNonNull = false;
  let isList = false;
  let cur: TypeNode = t;
  if (cur.kind === Kind.NON_NULL_TYPE) {
    isNonNull = true;
    cur = cur.type;
  }
  function walkForList(n: TypeNode): void {
    if (n.kind === Kind.LIST_TYPE) {
      isList = true;
    } else if (n.kind === Kind.NON_NULL_TYPE) {
      walkForList(n.type);
    }
  }
  walkForList(cur);
  return { isList, isNonNull };
}

/** Built-in GraphQL scalar names — always leaf. */
const BUILTIN_SCALARS = new Set(["String", "Boolean", "Int", "Float", "ID"]);

// ---------------------------------------------------------------------------
// Schema SDL → typeMap builder
// ---------------------------------------------------------------------------

/**
 * Parse the API schema SDL and build a typeMap.
 * No Federation filtering needed — the API schema SDL is already clean.
 */
function buildTypeMap(schemaSdl: string): Map<string, TypeInfo> | null {
  let doc: DocumentNode;
  try {
    doc = parse(schemaSdl);
  } catch {
    return null;
  }

  const typeMap = new Map<string, TypeInfo>();

  for (const def of doc.definitions) {
    switch (def.kind) {
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_EXTENSION: {
        const d = def as ObjectTypeDefinitionNode;
        const name = d.name.value;
        const newFields: FieldInfo[] = (d.fields ?? []).map((f) => {
          const { isList, isNonNull } = typeFlags(f.type as TypeNode);
          return { name: f.name.value, type: f.type as TypeNode, isList, isNonNull };
        });
        const existing = typeMap.get(name);
        if (!existing) {
          typeMap.set(name, { kind: "object", fields: newFields, members: [] });
        } else {
          existing.fields.push(...newFields);
        }
        break;
      }

      case Kind.INTERFACE_TYPE_DEFINITION: {
        const d = def as InterfaceTypeDefinitionNode;
        const name = d.name.value;
        if (!typeMap.has(name)) {
          const fields: FieldInfo[] = (d.fields ?? []).map((f) => {
            const { isList, isNonNull } = typeFlags(f.type as TypeNode);
            return { name: f.name.value, type: f.type as TypeNode, isList, isNonNull };
          });
          typeMap.set(name, { kind: "interface", fields, members: [] });
        }
        break;
      }

      case Kind.UNION_TYPE_DEFINITION: {
        const d = def as UnionTypeDefinitionNode;
        const name = d.name.value;
        if (!typeMap.has(name)) {
          const members = (d.types ?? []).map((t) => t.name.value);
          typeMap.set(name, { kind: "union", fields: [], members });
        }
        break;
      }

      case Kind.SCALAR_TYPE_DEFINITION: {
        const name = def.name.value;
        if (!BUILTIN_SCALARS.has(name) && !typeMap.has(name)) {
          typeMap.set(name, { kind: "scalar", fields: [], members: [] });
        }
        break;
      }

      case Kind.ENUM_TYPE_DEFINITION: {
        const name = def.name.value;
        if (!typeMap.has(name)) {
          typeMap.set(name, { kind: "enum", fields: [], members: [] });
        }
        break;
      }

      default:
        break;
    }
  }

  return typeMap;
}

// ---------------------------------------------------------------------------
// Query selection walker
// ---------------------------------------------------------------------------

/**
 * Recursively build SchemaTreeField[] from a selection set, resolving fragments
 * and looking up type information from the typeMap.
 */
function buildShapeFields(
  selectionSet: SelectionSetNode,
  parentTypeName: string,
  typeMap: Map<string, TypeInfo>,
  fragmentMap: Map<string, FragmentDefinitionNode>,
): SchemaTreeField[] {
  const result: SchemaTreeField[] = [];

  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        const fieldName = selection.name.value;
        const parentInfo = typeMap.get(parentTypeName);
        const fieldDef = parentInfo?.fields.find((f) => f.name === fieldName);

        if (fieldDef) {
          const typeName = namedTypeName(fieldDef.type);
          const { isList, isNonNull } = typeFlags(fieldDef.type);
          const typeInfo = typeMap.get(typeName);
          const isBuiltinScalar = BUILTIN_SCALARS.has(typeName);
          const isLeaf =
            isBuiltinScalar || !typeInfo || typeInfo.kind === "scalar" || typeInfo.kind === "enum";

          let children: SchemaTreeField[] = [];
          if (!isLeaf && selection.selectionSet) {
            children = buildShapeFields(selection.selectionSet, typeName, typeMap, fragmentMap);
          }

          result.push({
            fieldName,
            typeName,
            isList,
            isNonNull,
            isLeaf,
            isCycleRef: false,
            children,
          });
        } else {
          // Field not found in typeMap (e.g. __typename introspection field).
          result.push({
            fieldName,
            typeName: fieldName === "__typename" ? "__typename" : fieldName,
            isList: false,
            isNonNull: false,
            isLeaf: true,
            isCycleRef: false,
            children: [],
          });
        }
        break;
      }

      case Kind.FRAGMENT_SPREAD: {
        // Inline the named fragment's fields at this position (no wrapper node).
        const fragmentName = selection.name.value;
        const fragment = fragmentMap.get(fragmentName);
        if (fragment) {
          const fragmentTypeName = fragment.typeCondition.name.value;
          const inlined = buildShapeFields(
            fragment.selectionSet,
            fragmentTypeName,
            typeMap,
            fragmentMap,
          );
          result.push(...inlined);
        }
        break;
      }

      case Kind.INLINE_FRAGMENT: {
        // Emit a "… on TypeName" wrapper node with children.
        const typeCondition = selection.typeCondition?.name.value ?? parentTypeName;
        const children = buildShapeFields(
          selection.selectionSet,
          typeCondition,
          typeMap,
          fragmentMap,
        );
        result.push({
          fieldName: `… on ${typeCondition}`,
          typeName: typeCondition,
          isList: false,
          isNonNull: false,
          isLeaf: false,
          isCycleRef: false,
          children,
        });
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a query document and API schema SDL, returning the shape of the response.
 *
 * Algorithm:
 * 1. Parse apiSchemaSdl → build typeMap.
 * 2. Parse query document.
 * 3. Collect all FragmentDefinitions into fragmentMap.
 * 4. For each OperationDefinition, walk the selection set recursively.
 *
 * Returns `{ operations: [] }` for invalid/empty inputs.
 */
export function queryToQueryShape(apiSchemaSdl: string, query: string): QueryShapeTree {
  if (!apiSchemaSdl || !query.trim()) {
    return { operations: [] };
  }

  const typeMap = buildTypeMap(apiSchemaSdl);
  if (!typeMap) {
    return { operations: [] };
  }

  let queryDoc: DocumentNode;
  try {
    queryDoc = parse(query);
  } catch {
    return { operations: [] };
  }

  // Collect fragments into a map for O(1) lookup at use sites.
  const fragmentMap = new Map<string, FragmentDefinitionNode>();
  for (const def of queryDoc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragmentMap.set(def.name.value, def);
    }
  }

  const operations: QueryShapeOperation[] = [];

  for (const def of queryDoc.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;

    const opKind = def.operation; // "query" | "mutation" | "subscription"
    const opName = def.name?.value;
    const header = opName ? `${opKind} ${opName}` : opKind;

    // Determine the root type name for this operation.
    const rootTypeName =
      opKind === "query" ? "Query" : opKind === "mutation" ? "Mutation" : "Subscription";

    const fields = buildShapeFields(def.selectionSet, rootTypeName, typeMap, fragmentMap);

    operations.push({ header, fields });
  }

  return { operations };
}
