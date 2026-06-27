// @ts-expect-error -- Node.js built-ins; @types/node is not installed in this web project
import { readFileSync } from "node:fs";
// @ts-expect-error -- Node.js built-ins; @types/node is not installed in this web project
import { resolve, dirname } from "node:path";
// @ts-expect-error -- Node.js built-ins; @types/node is not installed in this web project
import { fileURLToPath } from "node:url";
import { beforeAll, describe, it, expect } from "vitest";
import { queryToQueryShape } from "./queryToQueryShape";
import type { GqlCore } from "./core/types";
import { loadCore } from "./core";

let core: GqlCore;

beforeAll(async () => {
  // In jsdom, `init()` tries to fetch the .wasm binary from a URL which fails
  // (no server running). Use initSync with the binary read directly from disk so
  // the module initialises synchronously, then the wasm-is-already-loaded
  // short-circuit in init() lets loadCore() proceed.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const wasmPath = resolve(__dirname, "./wasm/gql_core_bg.wasm");
  const wasmBuffer = readFileSync(wasmPath);
  const { initSync } = await import("./wasm/gql_core.js");
  initSync({ module: wasmBuffer });

  core = await loadCore();
});

// ---------------------------------------------------------------------------
// SDL builder helpers
// ---------------------------------------------------------------------------

/** Minimal API schema SDL with a single scalar-returning Query field. */
function makeSimpleSdl(): string {
  return `
    type Query {
      hello: String
    }
  `;
}

/** SDL with a nested object return type. */
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

/** SDL with list and non-null variants. */
function makeListNonNullSdl(): string {
  return `
    type Query {
      products: [Product!]!
      maybeProduct: Product
    }

    type Product {
      id: ID!
      name: String
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

/** SDL with both Query and Mutation. */
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
      name: String
    }
  `;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("queryToQueryShape", () => {
  // ---- AC#10 coverage: invalid/empty inputs ----

  describe("invalid / empty inputs", () => {
    it("returns empty operations for empty query string", () => {
      const result = queryToQueryShape(core, makeSimpleSdl(), "");
      expect(result).toEqual({ operations: [] });
    });

    it("returns empty operations for whitespace-only query string", () => {
      const result = queryToQueryShape(core, makeSimpleSdl(), "   \n  ");
      expect(result).toEqual({ operations: [] });
    });

    it("returns empty operations for invalid query document", () => {
      const result = queryToQueryShape(core, makeSimpleSdl(), "{ not valid {{{");
      expect(result).toEqual({ operations: [] });
    });

    it("returns empty operations for invalid SDL", () => {
      const result = queryToQueryShape(core, "not valid SDL {{{", "{ hello }");
      expect(result).toEqual({ operations: [] });
    });

    it("returns empty operations for empty SDL", () => {
      const result = queryToQueryShape(core, "", "{ hello }");
      expect(result).toEqual({ operations: [] });
    });
  });

  // ---- AC#10 coverage: basic field selection ----

  describe("basic field selection", () => {
    it("returns one operation with the selected scalar field", () => {
      const result = queryToQueryShape(core, makeSimpleSdl(), "{ hello }");
      expect(result.operations).toHaveLength(1);
      const op = result.operations[0];
      expect(op.fields).toHaveLength(1);
      expect(op.fields[0].fieldName).toBe("hello");
      expect(op.fields[0].isLeaf).toBe(true);
      expect(op.fields[0].typeName).toBe("String");
    });

    it("only includes fields that the query selects, not all schema fields", () => {
      // Schema has hello but we don't query it
      const sdl = `type Query { hello: String world: String }`;
      const result = queryToQueryShape(core, sdl, "{ hello }");
      expect(result.operations[0].fields).toHaveLength(1);
      expect(result.operations[0].fields[0].fieldName).toBe("hello");
    });

    it("handles __typename as a leaf node", () => {
      const result = queryToQueryShape(core, makeSimpleSdl(), "{ __typename }");
      expect(result.operations[0].fields[0].fieldName).toBe("__typename");
      expect(result.operations[0].fields[0].isLeaf).toBe(true);
      expect(result).toMatchSnapshot();
    });
  });

  // ---- AC#10 coverage: nested selection sets ----

  describe("nested selection sets", () => {
    it("includes children for nested object types", () => {
      const result = queryToQueryShape(core, makeNestedSdl(), "{ user { id name } }");
      const op = result.operations[0];
      const userField = op.fields.find((f) => f.fieldName === "user");
      expect(userField).toBeDefined();
      expect(userField!.isLeaf).toBe(false);
      expect(userField!.children).toHaveLength(2);
      expect(userField!.children.map((c) => c.fieldName)).toContain("id");
      expect(userField!.children.map((c) => c.fieldName)).toContain("name");
      expect(result).toMatchSnapshot();
    });

    it("nests two levels deep", () => {
      const result = queryToQueryShape(core, makeNestedSdl(), "{ user { address { city } } }");
      const op = result.operations[0];
      const userField = op.fields.find((f) => f.fieldName === "user")!;
      const addressField = userField.children.find((f) => f.fieldName === "address")!;
      expect(addressField).toBeDefined();
      expect(addressField.isLeaf).toBe(false);
      expect(addressField.children).toHaveLength(1);
      expect(addressField.children[0].fieldName).toBe("city");
      expect(result).toMatchSnapshot();
    });
  });

  // ---- AC#10 coverage: named fragment inlining ----

  describe("named fragment inlining", () => {
    it("inlines named fragment fields at the use site (no wrapper node)", () => {
      const sdl = `
        type Query { user: User }
        type User { id: ID! name: String email: String }
      `;
      const query = `
        fragment UserFields on User { id name }
        query GetUser { user { ...UserFields email } }
      `;
      const result = queryToQueryShape(core, sdl, query);
      const op = result.operations[0];
      const userField = op.fields.find((f) => f.fieldName === "user")!;
      // Fragment fields are inlined alongside email — no "UserFields" wrapper node
      const fieldNames = userField.children.map((c) => c.fieldName);
      expect(fieldNames).toContain("id");
      expect(fieldNames).toContain("name");
      expect(fieldNames).toContain("email");
      // Must NOT have a wrapper node named "UserFields"
      expect(fieldNames).not.toContain("UserFields");
      expect(result).toMatchSnapshot();
    });
  });

  // ---- AC#10 coverage: inline fragments ----

  describe("inline fragments", () => {
    it("renders inline fragments as '… on TypeName' nodes", () => {
      const query = `
        query Search {
          search {
            ... on User { id name }
            ... on Post { id title }
          }
        }
      `;
      const result = queryToQueryShape(core, makeUnionSdl(), query);
      const op = result.operations[0];
      const searchField = op.fields.find((f) => f.fieldName === "search")!;
      const userFrag = searchField.children.find((f) => f.fieldName === "… on User");
      const postFrag = searchField.children.find((f) => f.fieldName === "… on Post");
      expect(userFrag).toBeDefined();
      expect(postFrag).toBeDefined();
      expect(result).toMatchSnapshot();
    });

    it("includes children inside inline fragments", () => {
      const query = `
        query Search {
          search {
            ... on User { id name }
          }
        }
      `;
      const result = queryToQueryShape(core, makeUnionSdl(), query);
      const op = result.operations[0];
      const searchField = op.fields.find((f) => f.fieldName === "search")!;
      const userFrag = searchField.children.find((f) => f.fieldName === "… on User")!;
      expect(userFrag.children.map((c) => c.fieldName)).toContain("id");
      expect(userFrag.children.map((c) => c.fieldName)).toContain("name");
      expect(result).toMatchSnapshot();
    });
  });

  // ---- AC#10 coverage: lists and non-null types ----

  describe("lists and non-null types", () => {
    it("sets isList: true for [Product!]! return type", () => {
      const result = queryToQueryShape(core, makeListNonNullSdl(), "{ products { id } }");
      const productsField = result.operations[0].fields.find((f) => f.fieldName === "products")!;
      expect(productsField.isList).toBe(true);
      expect(result).toMatchSnapshot();
    });

    it("sets isNonNull: true for [Product!]! return type", () => {
      const result = queryToQueryShape(core, makeListNonNullSdl(), "{ products { id } }");
      const productsField = result.operations[0].fields.find((f) => f.fieldName === "products")!;
      expect(productsField.isNonNull).toBe(true);
    });

    it("sets isList: false and isNonNull: false for nullable singular type", () => {
      const result = queryToQueryShape(core, makeListNonNullSdl(), "{ maybeProduct { id } }");
      const maybeField = result.operations[0].fields.find((f) => f.fieldName === "maybeProduct")!;
      expect(maybeField.isList).toBe(false);
      expect(maybeField.isNonNull).toBe(false);
    });

    it("sets isNonNull: true for ID! field inside nested object", () => {
      const result = queryToQueryShape(core, makeListNonNullSdl(), "{ products { id } }");
      const productsField = result.operations[0].fields.find((f) => f.fieldName === "products")!;
      const idField = productsField.children.find((f) => f.fieldName === "id")!;
      expect(idField.isNonNull).toBe(true);
    });
  });

  // ---- AC#5 coverage: operation header ----

  describe("operation header", () => {
    it("uses 'query OperationName' for a named query", () => {
      const result = queryToQueryShape(core, makeSimpleSdl(), "query GetHello { hello }");
      expect(result.operations[0].header).toBe("query GetHello");
    });

    it("uses just 'query' for an unnamed query", () => {
      const result = queryToQueryShape(core, makeSimpleSdl(), "{ hello }");
      expect(result.operations[0].header).toBe("query");
    });

    it("uses 'mutation OperationName' for a named mutation", () => {
      const query = "mutation CreateUser { createUser { id } }";
      const result = queryToQueryShape(core, makeQueryAndMutationSdl(), query);
      const mutOp = result.operations.find((op) => op.header === "mutation CreateUser");
      expect(mutOp).toBeDefined();
    });
  });

  // ---- Multiple operations ----

  describe("multiple operations", () => {
    it("returns one QueryShapeOperation per operation definition", () => {
      const query = `
        query GetUser { user { id } }
        mutation CreateUser { createUser { id } }
      `;
      const result = queryToQueryShape(core, makeQueryAndMutationSdl(), query);
      expect(result.operations).toHaveLength(2);
      const headers = result.operations.map((op) => op.header);
      expect(headers).toContain("query GetUser");
      expect(headers).toContain("mutation CreateUser");
      expect(result).toMatchSnapshot();
    });
  });

  // ---- typeName on fields ----

  describe("typeName on fields", () => {
    it("records the unwrapped named type on list fields", () => {
      const result = queryToQueryShape(core, makeListNonNullSdl(), "{ products { id } }");
      const productsField = result.operations[0].fields.find((f) => f.fieldName === "products")!;
      expect(productsField.typeName).toBe("Product");
    });
  });

  // ---- Alias handling (case 12) ----

  describe("alias handling", () => {
    it("uses field name (not alias) in the output", () => {
      const sdl = `type Query { user: User }\ntype User { id: ID! name: String }`;
      // "me" is the alias; "user" is the field name. The output should use the field name.
      const result = queryToQueryShape(core, sdl, "{ me: user { id } }");
      expect(result.operations[0].fields[0].fieldName).toBe("user");
      expect(result).toMatchSnapshot();
    });
  });
});
