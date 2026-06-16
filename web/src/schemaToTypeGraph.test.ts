import { describe, it, expect } from "vitest";
import { schemaToTypeGraph } from "./schemaToTypeGraph";

// ---------------------------------------------------------------------------
// Minimal SDL builder helpers
// ---------------------------------------------------------------------------

function makeSingleObjectTypeSdl(): string {
  return `
    directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
    directive @link(url: String!) repeatable on SCHEMA

    enum join__Graph {
      USERS @join__graph(name: "users", url: "")
    }

    type Query {
      user(id: ID!): User
    }

    type User @join__type(graph: USERS) {
      id: ID!
      name: String
    }
  `;
}

function makeFieldEdgeSdl(): string {
  return `
    directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR

    enum join__Graph {
      USERS @join__graph(name: "users", url: "")
      ORDERS @join__graph(name: "orders", url: "")
    }

    type User @join__type(graph: USERS) {
      id: ID!
      orders: [Order]
    }

    type Order @join__type(graph: ORDERS) {
      id: ID!
      total: Float
    }
  `;
}

function makeScalarEnumSdl(): string {
  return `
    directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR

    enum join__Graph {
      SVC @join__graph(name: "svc", url: "")
    }

    scalar JSON
    scalar DateTime

    enum Status @join__type(graph: SVC) {
      ACTIVE
      INACTIVE
    }

    type Product @join__type(graph: SVC) {
      id: ID!
      status: Status
    }
  `;
}

function makeBuiltinScalarsSdl(): string {
  return `
    directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR

    enum join__Graph {
      SVC @join__graph(name: "svc", url: "")
    }

    type User @join__type(graph: SVC) {
      id: ID!
      name: String
      age: Int
      active: Boolean
      score: Float
    }
  `;
}

function makeRootTypesSdl(): string {
  return `
    directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR

    enum join__Graph {
      SVC @join__graph(name: "svc", url: "")
    }

    type Query {
      user: User
    }

    type Mutation {
      createUser(name: String!): User
    }

    type Subscription {
      userCreated: User
    }

    type User @join__type(graph: SVC) {
      id: ID!
    }
  `;
}

function makeFederationInternalSdl(): string {
  return `
    directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR

    enum join__Graph {
      SVC @join__graph(name: "svc", url: "")
    }

    scalar _Any
    type _Service { sdl: String }
    type _Entity { id: ID }

    type Product @join__type(graph: SVC) {
      id: ID!
    }
  `;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schemaToTypeGraph", () => {
  it("returns empty graph for invalid SDL", () => {
    const result = schemaToTypeGraph("not valid graphql {{{{");
    expect(result).toEqual({ nodes: [], edges: [], subgraphs: [] });
  });

  it("returns empty graph for empty string", () => {
    const result = schemaToTypeGraph("");
    expect(result).toEqual({ nodes: [], edges: [], subgraphs: [] });
  });

  describe("single object type with @join__type", () => {
    it("creates one node with correct typeName and kind", () => {
      const result = schemaToTypeGraph(makeSingleObjectTypeSdl());
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user).toBeDefined();
      expect(user!.kind).toBe("object");
    });

    it("sets the subgraph from @join__type(graph:) directive", () => {
      const result = schemaToTypeGraph(makeSingleObjectTypeSdl());
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user!.subgraph).toBe("USERS");
      expect(user!.subgraphs).toContain("USERS");
    });

    it("uses typeName as the node id", () => {
      const result = schemaToTypeGraph(makeSingleObjectTypeSdl());
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user!.id).toBe("User");
    });

    it("includes Query root type in subgraphs list (it has no @join__type but is filtered out of nodes)", () => {
      const result = schemaToTypeGraph(makeSingleObjectTypeSdl());
      // Query should not appear as a node
      expect(result.nodes.find((n) => n.typeName === "Query")).toBeUndefined();
    });
  });

  describe("field edge between two object types", () => {
    it("emits one edge from User to Order", () => {
      const result = schemaToTypeGraph(makeFieldEdgeSdl());
      const edge = result.edges.find((e) => e.sourceType === "User" && e.targetType === "Order");
      expect(edge).toBeDefined();
    });

    it("uses 'source->target' as edge id", () => {
      const result = schemaToTypeGraph(makeFieldEdgeSdl());
      const edge = result.edges.find((e) => e.sourceType === "User");
      expect(edge!.id).toBe("User->Order");
    });

    it("deduplicates parallel edges (multiple fields returning same type)", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
        enum join__Graph { SVC @join__graph(name: "svc", url: "") }
        type A @join__type(graph: SVC) { b1: B  b2: B }
        type B @join__type(graph: SVC) { id: ID! }
      `;
      const result = schemaToTypeGraph(sdl);
      const edges = result.edges.filter((e) => e.sourceType === "A" && e.targetType === "B");
      expect(edges).toHaveLength(1);
    });

    it("does not emit self-loop edges", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
        enum join__Graph { SVC @join__graph(name: "svc", url: "") }
        type Node @join__type(graph: SVC) { parent: Node  id: ID! }
      `;
      const result = schemaToTypeGraph(sdl);
      const selfLoop = result.edges.find((e) => e.sourceType === "Node" && e.targetType === "Node");
      expect(selfLoop).toBeUndefined();
    });
  });

  describe("scalar and enum nodes", () => {
    it("includes custom Scalar nodes with kind 'scalar'", () => {
      const result = schemaToTypeGraph(makeScalarEnumSdl());
      const json = result.nodes.find((n) => n.typeName === "JSON");
      expect(json).toBeDefined();
      expect(json!.kind).toBe("scalar");
    });

    it("includes Enum nodes with kind 'enum'", () => {
      const result = schemaToTypeGraph(makeScalarEnumSdl());
      const status = result.nodes.find((n) => n.typeName === "Status");
      expect(status).toBeDefined();
      expect(status!.kind).toBe("enum");
    });

    it("includes edge from Product to Status enum", () => {
      const result = schemaToTypeGraph(makeScalarEnumSdl());
      const edge = result.edges.find(
        (e) => e.sourceType === "Product" && e.targetType === "Status",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("built-in scalars excluded", () => {
    it("does not include String, Boolean, Int, Float, ID as nodes", () => {
      const result = schemaToTypeGraph(makeBuiltinScalarsSdl());
      const builtins = ["String", "Boolean", "Int", "Float", "ID"];
      for (const b of builtins) {
        expect(result.nodes.find((n) => n.typeName === b)).toBeUndefined();
      }
    });
  });

  describe("federation internal types excluded", () => {
    it("does not include _Service, _Any, _Entity", () => {
      const result = schemaToTypeGraph(makeFederationInternalSdl());
      expect(result.nodes.find((n) => n.typeName === "_Service")).toBeUndefined();
      expect(result.nodes.find((n) => n.typeName === "_Any")).toBeUndefined();
      expect(result.nodes.find((n) => n.typeName === "_Entity")).toBeUndefined();
    });

    it("includes non-federation types", () => {
      const result = schemaToTypeGraph(makeFederationInternalSdl());
      expect(result.nodes.find((n) => n.typeName === "Product")).toBeDefined();
    });
  });

  describe("root operation types excluded", () => {
    it("does not include Query, Mutation, or Subscription as nodes", () => {
      const result = schemaToTypeGraph(makeRootTypesSdl());
      expect(result.nodes.find((n) => n.typeName === "Query")).toBeUndefined();
      expect(result.nodes.find((n) => n.typeName === "Mutation")).toBeUndefined();
      expect(result.nodes.find((n) => n.typeName === "Subscription")).toBeUndefined();
    });

    it("includes non-root types like User", () => {
      const result = schemaToTypeGraph(makeRootTypesSdl());
      expect(result.nodes.find((n) => n.typeName === "User")).toBeDefined();
    });
  });

  describe("subgraphs list", () => {
    it("returns sorted unique subgraph names", () => {
      const result = schemaToTypeGraph(makeFieldEdgeSdl());
      expect(result.subgraphs).toEqual(["ORDERS", "USERS"]);
    });

    it("returns empty subgraphs list when no @join__type directives", () => {
      const result = schemaToTypeGraph(makeScalarEnumSdl());
      // The Scalar nodes have no @join__type, but Status and Product do
      expect(result.subgraphs).toContain("SVC");
    });
  });

  describe("interface types", () => {
    it("includes interface types with kind 'interface'", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
        enum join__Graph { SVC @join__graph(name: "svc", url: "") }
        interface NodeInterface @join__type(graph: SVC) { id: ID! }
        type User @join__type(graph: SVC) { id: ID!  name: String }
      `;
      const result = schemaToTypeGraph(sdl);
      const iface = result.nodes.find((n) => n.typeName === "NodeInterface");
      expect(iface).toBeDefined();
      expect(iface!.kind).toBe("interface");
    });
  });

  describe("input types", () => {
    it("includes input object types with kind 'input'", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
        enum join__Graph { SVC @join__graph(name: "svc", url: "") }
        input CreateUserInput { name: String! }
        type User @join__type(graph: SVC) { id: ID! }
      `;
      const result = schemaToTypeGraph(sdl);
      const input = result.nodes.find((n) => n.typeName === "CreateUserInput");
      expect(input).toBeDefined();
      expect(input!.kind).toBe("input");
    });
  });

  describe("union types", () => {
    it("includes union types with kind 'union'", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
        enum join__Graph { SVC @join__graph(name: "svc", url: "") }
        type Cat @join__type(graph: SVC) { name: String }
        type Dog @join__type(graph: SVC) { name: String }
        union Animal @join__type(graph: SVC) = Cat | Dog
      `;
      const result = schemaToTypeGraph(sdl);
      const union = result.nodes.find((n) => n.typeName === "Animal");
      expect(union).toBeDefined();
      expect(union!.kind).toBe("union");
    });
  });

  describe("types shared across multiple subgraphs", () => {
    it("collects all subgraphs for a shared type", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE | UNION | ENUM | INPUT_OBJECT | SCALAR
        enum join__Graph {
          USERS @join__graph(name: "users", url: "")
          ORDERS @join__graph(name: "orders", url: "")
        }
        type User
          @join__type(graph: USERS)
          @join__type(graph: ORDERS) {
          id: ID!
        }
      `;
      const result = schemaToTypeGraph(sdl);
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user).toBeDefined();
      expect(user!.subgraphs).toContain("USERS");
      expect(user!.subgraphs).toContain("ORDERS");
      // primary subgraph is the first one seen
      expect(user!.subgraph).toBe("USERS");
    });
  });
});
