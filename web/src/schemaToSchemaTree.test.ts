import { beforeAll, describe, it, expect } from "vitest";
// @ts-expect-error -- Node.js built-ins; @types/node is not installed in this web project
import { readFileSync } from "node:fs";
// @ts-expect-error -- Node.js built-ins; @types/node is not installed in this web project
import { resolve, dirname } from "node:path";
// @ts-expect-error -- Node.js built-ins; @types/node is not installed in this web project
import { fileURLToPath } from "node:url";
import { loadCore } from "./core";
import type { GqlCore } from "./core/types";
import type { SchemaTree } from "./schemaToSchemaTree";

// ---------------------------------------------------------------------------
// Test helper: compose a plain GraphQL SDL via the WASM module and return the
// schema_tree field from the compose result.
//
// Each SDL is wrapped in minimal federation boilerplate so the composer can
// produce a valid supergraph. The Rust build_schema_tree function then
// extracts the tree from that supergraph SDL.
// ---------------------------------------------------------------------------

let core: GqlCore;

beforeAll(async () => {
  // In jsdom, `init()` (the default export of gql_core.js) tries to fetch the
  // .wasm binary from a URL which fails (no server running). Use initSync with
  // the binary read directly from disk so the module initialises synchronously,
  // then the wasm-is-already-loaded short-circuit in init() lets loadCore() proceed.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const wasmPath = resolve(__dirname, "./wasm/gql_core_bg.wasm");
  const wasmBuffer = readFileSync(wasmPath);
  const { initSync } = await import("./wasm/gql_core.js");
  initSync({ module: wasmBuffer });

  core = await loadCore();
});

function composeTree(sdl: string): SchemaTree {
  const result = core.compose([{ name: "test", sdl }]);
  if (!result.ok) return { roots: [] };
  return result.schema_tree ?? { roots: [] };
}

// ---------------------------------------------------------------------------
// SDL builder helpers (plain subgraph SDL — no federation boilerplate needed;
// the WASM compose() accepts minimal SDL and injects federation scaffolding).
// ---------------------------------------------------------------------------

/** Minimal SDL with a single scalar-returning Query field. */
function makeSimpleSdl(): string {
  return `
    type Query {
      hello: String
    }
  `;
}

/** SDL with object return type nesting. */
function makeNestedSdl(): string {
  return `
    type Query {
      user: User
    }

    type User {
      id: ID!
      name: String
      address: Address
    }

    type Address {
      city: String
    }
  `;
}

/** SDL with a list field and non-null variants. */
function makeListNonNullSdl(): string {
  return `
    type Query {
      users: [User!]!
      maybeUser: User
    }

    type User {
      id: ID!
    }
  `;
}

/** SDL with a direct cycle: User.friends returns [User]. */
function makeCycleSdl(): string {
  return `
    type Query {
      user: User
    }

    type User {
      id: ID!
      friends: [User]
    }
  `;
}

/** SDL where a type appears in sibling branches (not ancestor chain). */
function makeSiblingRepeatSdl(): string {
  return `
    type Query {
      a: A
      b: B
    }

    type A {
      shared: Shared
    }

    type B {
      shared: Shared
    }

    type Shared {
      value: String
    }
  `;
}

/** SDL with a union type. */
function makeUnionSdl(): string {
  return `
    type Query {
      search: SearchResult
    }

    union SearchResult = User | Post

    type User {
      id: ID!
      name: String
    }

    type Post {
      id: ID!
      title: String
    }
  `;
}

/** SDL with both Query and Mutation but no Subscription. */
function makeQueryAndMutationSdl(): string {
  return `
    type Query {
      user: User
    }

    type Mutation {
      createUser(name: String!): User
    }

    type User {
      id: ID!
    }
  `;
}

/** SDL with an interface type. */
function makeInterfaceSdl(): string {
  return `
    type Query {
      node: Node
    }

    interface Node {
      id: ID!
    }

    type User implements Node {
      id: ID!
      name: String
    }
  `;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schemaToSchemaTree (via Rust compose schema_tree)", () => {
  describe("invalid / empty input", () => {
    it("returns empty roots for invalid SDL (compose fails)", () => {
      const result = composeTree("not valid {{{");
      expect(result).toEqual({ roots: [] });
    });

    it("returns empty roots for empty string", () => {
      const result = composeTree("");
      expect(result).toEqual({ roots: [] });
    });

    it("returns empty roots for SDL with no root operation types", () => {
      // A subgraph without a Query type is invalid for compose, so schema_tree is absent.
      const sdl = `
        type User {
          id: ID!
        }
      `;
      const result = composeTree(sdl);
      expect(result).toEqual({ roots: [] });
    });
  });

  describe("root type nodes", () => {
    it("produces a SchemaTreeNode with rootTypeName Query", () => {
      const result = composeTree(makeSimpleSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query");
      expect(queryRoot).toBeDefined();
    });

    it("includes only Query and Mutation when Subscription is absent", () => {
      const result = composeTree(makeQueryAndMutationSdl());
      const names = result.roots.map((r) => r.rootTypeName);
      expect(names).toContain("Query");
      expect(names).toContain("Mutation");
      expect(names).not.toContain("Subscription");
    });

    it("orders roots as Query, Mutation, Subscription", () => {
      const sdl = `
        type Subscription { userCreated: User }
        type Mutation { createUser: User }
        type Query { user: User }
        type User { id: ID! }
      `;
      const result = composeTree(sdl);
      expect(result.roots.map((r) => r.rootTypeName)).toEqual([
        "Query",
        "Mutation",
        "Subscription",
      ]);
    });
  });

  describe("scalar and leaf fields", () => {
    it("marks built-in scalar return fields as isLeaf: true with no children", () => {
      const result = composeTree(makeSimpleSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const helloField = queryRoot.fields.find((f) => f.fieldName === "hello");
      expect(helloField).toBeDefined();
      expect(helloField!.isLeaf).toBe(true);
      expect(helloField!.children).toHaveLength(0);
    });

    it("marks custom scalar return fields as isLeaf: true", () => {
      const sdl = `
        scalar JSON
        type Query { config: JSON }
      `;
      const result = composeTree(sdl);
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const configField = queryRoot.fields.find((f) => f.fieldName === "config");
      expect(configField!.isLeaf).toBe(true);
    });

    it("marks enum return fields as isLeaf: true", () => {
      const sdl = `
        enum Status { ACTIVE INACTIVE }
        type Query { status: Status }
      `;
      const result = composeTree(sdl);
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const statusField = queryRoot.fields.find((f) => f.fieldName === "status");
      expect(statusField!.isLeaf).toBe(true);
    });
  });

  describe("nested object types", () => {
    it("produces children for object return type fields", () => {
      const result = composeTree(makeNestedSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const userField = queryRoot.fields.find((f) => f.fieldName === "user");
      expect(userField).toBeDefined();
      expect(userField!.isLeaf).toBe(false);
      expect(userField!.children.length).toBeGreaterThan(0);
    });

    it("includes scalar children on the nested object", () => {
      const result = composeTree(makeNestedSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const userField = queryRoot.fields.find((f) => f.fieldName === "user")!;
      const idField = userField.children.find((f) => f.fieldName === "id");
      expect(idField).toBeDefined();
      expect(idField!.isLeaf).toBe(true);
    });

    it("nests two levels deep (User → Address)", () => {
      const result = composeTree(makeNestedSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const userField = queryRoot.fields.find((f) => f.fieldName === "user")!;
      const addressField = userField.children.find((f) => f.fieldName === "address");
      expect(addressField).toBeDefined();
      expect(addressField!.isLeaf).toBe(false);
      expect(addressField!.children.find((f) => f.fieldName === "city")).toBeDefined();
    });
  });

  describe("list and non-null flags", () => {
    it("sets isList: true for [User!]! return type", () => {
      const result = composeTree(makeListNonNullSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const usersField = queryRoot.fields.find((f) => f.fieldName === "users");
      expect(usersField!.isList).toBe(true);
    });

    it("sets isNonNull: true for [User!]! return type", () => {
      const result = composeTree(makeListNonNullSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const usersField = queryRoot.fields.find((f) => f.fieldName === "users");
      expect(usersField!.isNonNull).toBe(true);
    });

    it("sets isList: false and isNonNull: false for nullable singular type", () => {
      const result = composeTree(makeListNonNullSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const maybeField = queryRoot.fields.find((f) => f.fieldName === "maybeUser");
      expect(maybeField!.isList).toBe(false);
      expect(maybeField!.isNonNull).toBe(false);
    });

    it("sets isNonNull: true for ID! field on nested object", () => {
      const result = composeTree(makeListNonNullSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const usersField = queryRoot.fields.find((f) => f.fieldName === "users")!;
      const idField = usersField.children.find((f) => f.fieldName === "id");
      expect(idField!.isNonNull).toBe(true);
    });
  });

  describe("cycle detection", () => {
    it("marks a field isCycleRef: true when the type is in the ancestor chain", () => {
      const result = composeTree(makeCycleSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const userField = queryRoot.fields.find((f) => f.fieldName === "user")!;
      const friendsField = userField.children.find((f) => f.fieldName === "friends");
      expect(friendsField).toBeDefined();
      expect(friendsField!.isCycleRef).toBe(true);
      expect(friendsField!.children).toHaveLength(0);
    });

    it("does NOT mark a sibling-branch repeat as isCycleRef", () => {
      const result = composeTree(makeSiblingRepeatSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const aField = queryRoot.fields.find((f) => f.fieldName === "a")!;
      const bField = queryRoot.fields.find((f) => f.fieldName === "b")!;
      const aShared = aField.children.find((f) => f.fieldName === "shared");
      const bShared = bField.children.find((f) => f.fieldName === "shared");
      expect(aShared!.isCycleRef).toBe(false);
      expect(bShared!.isCycleRef).toBe(false);
    });
  });

  describe("union types", () => {
    it("produces '… on MemberType' children for union return types", () => {
      const result = composeTree(makeUnionSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const searchField = queryRoot.fields.find((f) => f.fieldName === "search")!;
      const userMember = searchField.children.find((f) => f.fieldName === "… on User");
      const postMember = searchField.children.find((f) => f.fieldName === "… on Post");
      expect(userMember).toBeDefined();
      expect(postMember).toBeDefined();
    });

    it("expands union member type children", () => {
      const result = composeTree(makeUnionSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const searchField = queryRoot.fields.find((f) => f.fieldName === "search")!;
      const userMember = searchField.children.find((f) => f.fieldName === "… on User")!;
      expect(userMember.children.find((f) => f.fieldName === "id")).toBeDefined();
    });
  });

  describe("interface types", () => {
    it("expands interface return types as object fields", () => {
      const result = composeTree(makeInterfaceSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const nodeField = queryRoot.fields.find((f) => f.fieldName === "node");
      expect(nodeField).toBeDefined();
      expect(nodeField!.isLeaf).toBe(false);
      const idChild = nodeField!.children.find((f) => f.fieldName === "id");
      expect(idChild).toBeDefined();
    });
  });

  describe("federation internal types excluded", () => {
    it("excludes federation internal fields from composed supergraph", () => {
      // A subgraph with a domain type — compose produces a supergraph with
      // join__/link__ boilerplate, which must be filtered out of the tree.
      const sdl = `
        type Query {
          user: User
        }
        type User {
          id: ID!
        }
      `;
      const result = composeTree(sdl);
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query");
      expect(queryRoot).toBeDefined();
      const userField = queryRoot!.fields.find((f) => f.fieldName === "user");
      expect(userField).toBeDefined();

      // join__ and link__ type names must not appear anywhere in the tree.
      const json = JSON.stringify(result);
      expect(json).not.toMatch(/"typeName":"join__/);
      expect(json).not.toMatch(/"typeName":"link__/);
      expect(json).not.toMatch(/"fieldName":"join__/);
      expect(json).not.toMatch(/"fieldName":"link__/);
    });
  });

  describe("typeName on fields", () => {
    it("records the unwrapped named type on each field", () => {
      const result = composeTree(makeListNonNullSdl());
      const queryRoot = result.roots.find((r) => r.rootTypeName === "Query")!;
      const usersField = queryRoot.fields.find((f) => f.fieldName === "users");
      expect(usersField!.typeName).toBe("User");
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot coverage — locks the exact Rust output shape for regression detection.
  // The snapshots are generated from the Rust build_schema_tree implementation
  // (compose result schema_tree field) and serve as a baseline for future changes.
  // ---------------------------------------------------------------------------

  describe("snapshot coverage", () => {
    it("case 2: single object type with scalar fields", () => {
      expect(composeTree(makeSimpleSdl())).toMatchSnapshot();
    });

    it("case 3: nested object types (User → Address)", () => {
      expect(composeTree(makeNestedSdl())).toMatchSnapshot();
    });

    it("case 4: list and non-null wrappers", () => {
      expect(composeTree(makeListNonNullSdl())).toMatchSnapshot();
    });

    it("case 5: union type with member expansion", () => {
      expect(composeTree(makeUnionSdl())).toMatchSnapshot();
    });

    it("case 6: interface type expansion", () => {
      expect(composeTree(makeInterfaceSdl())).toMatchSnapshot();
    });

    it("case 7: cycle detection (self-referential type)", () => {
      expect(composeTree(makeCycleSdl())).toMatchSnapshot();
    });

    it("case 7b: sibling repeat is not a cycle", () => {
      expect(composeTree(makeSiblingRepeatSdl())).toMatchSnapshot();
    });

    it("case 8: federation supergraph SDL excludes join__ and link__ types from tree", () => {
      // Two subgraphs produce a supergraph with federation internals.
      // Verify join__/link__ prefixed types never appear in the tree.
      const sdlA = `
        type Query {
          me: User
        }
        type User {
          id: ID!
          name: String
        }
      `;
      const sdlB = `
        type Query {
          review: Review
        }
        type Review {
          id: ID!
          body: String
        }
      `;
      const composeResult = core.compose([
        { name: "users", sdl: sdlA },
        { name: "reviews", sdl: sdlB },
      ]);
      if (!composeResult.ok) throw new Error("Compose failed");
      const result = composeResult.schema_tree ?? { roots: [] };

      const json = JSON.stringify(result);
      expect(json).not.toMatch(/"typeName":"join__/);
      expect(json).not.toMatch(/"typeName":"link__/);
      expect(json).not.toMatch(/"fieldName":"join__/);
      expect(json).not.toMatch(/"fieldName":"link__/);

      expect(result).toMatchSnapshot();
    });

    it("case 9: multiple root types (Query and Mutation)", () => {
      expect(composeTree(makeQueryAndMutationSdl())).toMatchSnapshot();
    });

    it("case 9b: Query, Mutation, and Subscription all present", () => {
      const sdl = `
        type Query { user: User }
        type Mutation { createUser(name: String!): User }
        type Subscription { userCreated: User }
        type User { id: ID! name: String }
      `;
      expect(composeTree(sdl)).toMatchSnapshot();
    });

    it("case 10: enum and custom scalar fields are leaves", () => {
      const sdl = `
        enum Status { ACTIVE INACTIVE }
        scalar JSON
        type Query {
          status: Status
          config: JSON
          name: String
        }
      `;
      expect(composeTree(sdl)).toMatchSnapshot();
    });
  });
});
