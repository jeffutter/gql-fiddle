import { parse, Kind } from "graphql";
import type {
  DocumentNode,
  NamedTypeNode,
  ListTypeNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  InterfaceTypeDefinitionNode,
  UnionTypeDefinitionNode,
} from "graphql";

/**
 * Data model for the schema containment hierarchy tree derived from a supergraph SDL.
 *
 * Unlike the type graph (which shows connectivity), this view emphasizes depth and
 * traversal paths — how types nest when you traverse the schema from root operation
 * types (Query, Mutation, Subscription).
 */

export interface SchemaTreeField {
  /** The field name, or "… on MemberType" for union/interface inline fragments. */
  fieldName: string;
  /** The unwrapped named type (e.g. "User", "String"). */
  typeName: string;
  /** True if the return type is wrapped in a List at any nesting level. */
  isList: boolean;
  /** True if the outermost wrapper is NonNull. */
  isNonNull: boolean;
  /** True if the return type is scalar or enum (no children to expand). */
  isLeaf: boolean;
  /** True when this type is already an ancestor in the current path (cycle guard). */
  isCycleRef: boolean;
  /** Child fields — populated for non-cycle, non-leaf object/interface/union nodes. */
  children: SchemaTreeField[];
}

export interface SchemaTreeNode {
  rootTypeName: "Query" | "Mutation" | "Subscription";
  /** Top-level fields on the root type. */
  fields: SchemaTreeField[];
}

export interface SchemaTree {
  /** One entry per root type that exists in the schema. */
  roots: SchemaTreeNode[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type TypeNode = NamedTypeNode | ListTypeNode | NonNullTypeNode;

type TypeKind = "object" | "interface" | "union" | "scalar" | "enum";

interface TypeInfo {
  kind: TypeKind;
  /** Field names + type AST (for object/interface). */
  fields: { name: string; type: TypeNode; isNonNull: boolean; isList: boolean }[];
  /** Member type names (for union). */
  members: string[];
}

// ---------------------------------------------------------------------------
// Helpers
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
  // Walk remaining wrappers for List.
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

/** Federation-internal type name prefixes/names to exclude. */
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

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

/**
 * Recursively build child fields for the given type name.
 *
 * ancestorPath tracks the chain of type names currently being expanded to detect
 * cycles. When a type is found in the ancestor chain it becomes a cycle-ref leaf.
 */
function buildChildren(
  typeName: string,
  typeMap: Map<string, TypeInfo>,
  ancestorPath: Set<string>,
): SchemaTreeField[] {
  const info = typeMap.get(typeName);
  if (!info) return [];

  if (info.kind === "union") {
    // Union members become "… on MemberType" children.
    return info.members
      .filter((m) => !isFederationInternal(m))
      .map((member) => {
        const memberInfo = typeMap.get(member);
        const isLeaf = !memberInfo || memberInfo.kind === "scalar" || memberInfo.kind === "enum";
        const isCycleRef = ancestorPath.has(member);
        let children: SchemaTreeField[] = [];
        if (!isLeaf && !isCycleRef && memberInfo) {
          ancestorPath.add(member);
          children = buildChildren(member, typeMap, ancestorPath);
          ancestorPath.delete(member);
        }
        return {
          fieldName: `… on ${member}`,
          typeName: member,
          isList: false,
          isNonNull: false,
          isLeaf,
          isCycleRef,
          children,
        } satisfies SchemaTreeField;
      });
  }

  // Object or interface: expand fields.
  return info.fields
    .filter((f) => !isFederationInternal(f.name))
    .map((f) => {
      const fieldTypeName = namedTypeName(f.type);
      const fieldTypeInfo = typeMap.get(fieldTypeName);
      const isBuiltinScalar = BUILTIN_SCALARS.has(fieldTypeName);
      const isLeaf =
        isBuiltinScalar ||
        !fieldTypeInfo ||
        fieldTypeInfo.kind === "scalar" ||
        fieldTypeInfo.kind === "enum";
      const isCycleRef = !isLeaf && ancestorPath.has(fieldTypeName);
      const { isList, isNonNull } = typeFlags(f.type);

      let children: SchemaTreeField[] = [];
      if (!isLeaf && !isCycleRef) {
        ancestorPath.add(fieldTypeName);
        children = buildChildren(fieldTypeName, typeMap, ancestorPath);
        ancestorPath.delete(fieldTypeName);
      }

      return {
        fieldName: f.name,
        typeName: fieldTypeName,
        isList,
        isNonNull,
        isLeaf,
        isCycleRef,
        children,
      } satisfies SchemaTreeField;
    });
}

/**
 * Build SchemaTreeField list for a root operation type (Query/Mutation/Subscription).
 */
function buildRootFields(
  rootTypeName: string,
  typeMap: Map<string, TypeInfo>,
  rootTypeFields: { name: string; type: TypeNode }[],
): SchemaTreeField[] {
  return rootTypeFields.map((f) => {
    const fieldTypeName = namedTypeName(f.type);
    const fieldTypeInfo = typeMap.get(fieldTypeName);
    const isBuiltinScalar = BUILTIN_SCALARS.has(fieldTypeName);
    const isLeaf =
      isBuiltinScalar ||
      !fieldTypeInfo ||
      fieldTypeInfo.kind === "scalar" ||
      fieldTypeInfo.kind === "enum";
    const { isList, isNonNull } = typeFlags(f.type);
    const isCycleRef = false; // root fields cannot be cycle refs

    const ancestorPath = new Set<string>([rootTypeName, fieldTypeName]);
    const children = isLeaf ? [] : buildChildren(fieldTypeName, typeMap, ancestorPath);

    return {
      fieldName: f.name,
      typeName: fieldTypeName,
      isList,
      isNonNull,
      isLeaf,
      isCycleRef,
      children,
    } satisfies SchemaTreeField;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a supergraph SDL string and build the schema containment hierarchy tree.
 *
 * Pass 1: Collect all named types into a typeMap (kind + fields/members).
 *         Collect root operation type fields (Query/Mutation/Subscription).
 *
 * Pass 2: For each root type that exists, walk its fields recursively with an
 *         ancestor path set to detect cycles.
 *
 * Returns `{ roots: [] }` for invalid or empty SDL.
 */
export function schemaToSchemaTree(supergraphSdl: string): SchemaTree {
  let doc: DocumentNode;
  try {
    doc = parse(supergraphSdl);
  } catch {
    return { roots: [] };
  }

  // --- Pass 1: collect type map and root type fields ---

  const typeMap = new Map<string, TypeInfo>();

  // Root operation type fields collected during pass 1.
  const rootFields: Map<"Query" | "Mutation" | "Subscription", { name: string; type: TypeNode }[]> =
    new Map();

  for (const def of doc.definitions) {
    switch (def.kind) {
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_EXTENSION: {
        const d = def as ObjectTypeDefinitionNode;
        const name = d.name.value;

        if (name === "Query" || name === "Mutation" || name === "Subscription") {
          // Collect root type fields (extensions may add more fields).
          const existing = rootFields.get(name as "Query" | "Mutation" | "Subscription") ?? [];
          const newFields = (d.fields ?? []).map((f) => ({
            name: f.name.value,
            type: f.type as TypeNode,
          }));
          rootFields.set(name as "Query" | "Mutation" | "Subscription", [
            ...existing,
            ...newFields,
          ]);
          break;
        }

        if (isFederationInternal(name)) break;

        const existing = typeMap.get(name);
        const newFields = (d.fields ?? []).map((f) => {
          const { isList, isNonNull } = typeFlags(f.type as TypeNode);
          return { name: f.name.value, type: f.type as TypeNode, isList, isNonNull };
        });

        if (!existing) {
          typeMap.set(name, { kind: "object", fields: newFields, members: [] });
        } else {
          // Merge fields from extensions.
          existing.fields.push(...newFields);
        }
        break;
      }

      case Kind.INTERFACE_TYPE_DEFINITION: {
        const d = def as InterfaceTypeDefinitionNode;
        const name = d.name.value;
        if (isFederationInternal(name)) break;

        if (!typeMap.has(name)) {
          const fields = (d.fields ?? []).map((f) => {
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
        if (isFederationInternal(name)) break;

        if (!typeMap.has(name)) {
          const members = (d.types ?? []).map((t) => t.name.value);
          typeMap.set(name, { kind: "union", fields: [], members });
        }
        break;
      }

      case Kind.SCALAR_TYPE_DEFINITION: {
        const name = def.name.value;
        if (BUILTIN_SCALARS.has(name) || isFederationInternal(name)) break;
        if (!typeMap.has(name)) {
          typeMap.set(name, { kind: "scalar", fields: [], members: [] });
        }
        break;
      }

      case Kind.ENUM_TYPE_DEFINITION: {
        const name = def.name.value;
        if (isFederationInternal(name)) break;
        if (!typeMap.has(name)) {
          typeMap.set(name, { kind: "enum", fields: [], members: [] });
        }
        break;
      }

      default:
        break;
    }
  }

  if (rootFields.size === 0) {
    return { roots: [] };
  }

  // --- Pass 2: build tree roots ---

  const roots: SchemaTreeNode[] = [];

  for (const rootTypeName of ["Query", "Mutation", "Subscription"] as const) {
    const fields = rootFields.get(rootTypeName);
    if (!fields || fields.length === 0) continue;

    const treeFields = buildRootFields(rootTypeName, typeMap, fields);
    roots.push({ rootTypeName, fields: treeFields });
  }

  return { roots };
}
