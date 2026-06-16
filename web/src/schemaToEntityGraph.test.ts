import { describe, it, expect } from "vitest";
import { schemaToEntityGraph } from "./schemaToEntityGraph";

// ---------------------------------------------------------------------------
// Helpers to build minimal supergraph SDL snippets
// ---------------------------------------------------------------------------

/**
 * Builds a supergraph SDL fragment that represents a single-subgraph federated
 * schema with one entity type.
 *
 * The Apollo composition tooling produces `@join__type(graph: PRODUCTS, key: "id")`
 * on entity types in the supergraph SDL.
 */
function makeSingleSubgraphSdl(): string {
  return `
    schema @link(url: "https://specs.apollo.dev/federation/v2.0") {
      query: Query
    }

    directive @join__type(graph: join__Graph!, key: String) repeatable on OBJECT | INTERFACE
    directive @join__field(graph: join__Graph) repeatable on FIELD_DEFINITION
    directive @link(url: String!) repeatable on SCHEMA

    enum join__Graph {
      PRODUCTS @join__graph(name: "products", url: "")
    }

    type Query {
      product(id: ID!): Product
    }

    type Product @join__type(graph: PRODUCTS, key: "id") {
      id: ID!
      name: String
    }
  `;
}

function makeTwoSubgraphEntityReferenceSdl(): string {
  return `
    directive @join__type(graph: join__Graph!, key: String) repeatable on OBJECT | INTERFACE
    directive @join__field(graph: join__Graph) repeatable on FIELD_DEFINITION
    directive @link(url: String!) repeatable on SCHEMA

    enum join__Graph {
      USERS @join__graph(name: "users", url: "")
      ORDERS @join__graph(name: "orders", url: "")
    }

    type User @join__type(graph: USERS, key: "id") {
      id: ID!
      name: String
    }

    type Order @join__type(graph: ORDERS, key: "id") {
      id: ID!
      user: User
    }
  `;
}

function makeBidirectionalSdl(): string {
  return `
    directive @join__type(graph: join__Graph!, key: String) repeatable on OBJECT | INTERFACE

    enum join__Graph {
      CATALOG @join__graph(name: "catalog", url: "")
      INVENTORY @join__graph(name: "inventory", url: "")
    }

    type Product @join__type(graph: CATALOG, key: "sku") {
      sku: String!
      stock: StockInfo
    }

    type StockInfo @join__type(graph: INVENTORY, key: "sku") {
      sku: String!
      product: Product
    }
  `;
}

function makeNoEntitySdl(): string {
  return `
    directive @join__type(graph: join__Graph!) repeatable on OBJECT | INTERFACE

    enum join__Graph {
      PRODUCTS @join__graph(name: "products", url: "")
    }

    type Query {
      hello: String
    }

    type Product @join__type(graph: PRODUCTS) {
      id: ID!
      name: String
    }
  `;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schemaToEntityGraph", () => {
  it("returns empty graph for invalid SDL", () => {
    const result = schemaToEntityGraph("not valid graphql {{{{");
    expect(result).toEqual({ nodes: [], edges: [], subgraphs: [] });
  });

  it("returns empty graph when no entity types found", () => {
    const result = schemaToEntityGraph(makeNoEntitySdl());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.subgraphs).toHaveLength(0);
  });

  describe("single-subgraph schema", () => {
    it("creates one node for the entity type", () => {
      const result = schemaToEntityGraph(makeSingleSubgraphSdl());
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].typeName).toBe("Product");
      expect(result.nodes[0].subgraph).toBe("PRODUCTS");
      expect(result.nodes[0].keyFields).toEqual(["id"]);
    });

    it("produces no cross-subgraph edges for a single subgraph", () => {
      const result = schemaToEntityGraph(makeSingleSubgraphSdl());
      expect(result.edges).toHaveLength(0);
    });

    it("includes the subgraph in the sorted subgraphs list", () => {
      const result = schemaToEntityGraph(makeSingleSubgraphSdl());
      expect(result.subgraphs).toEqual(["PRODUCTS"]);
    });
  });

  describe("two-subgraph entity reference", () => {
    it("creates one node per entity type", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceSdl());
      expect(result.nodes).toHaveLength(2);

      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user).toBeDefined();
      expect(user!.subgraph).toBe("USERS");
      expect(user!.keyFields).toEqual(["id"]);

      const order = result.nodes.find((n) => n.typeName === "Order");
      expect(order).toBeDefined();
      expect(order!.subgraph).toBe("ORDERS");
    });

    it("creates a directed edge from ORDERS to USERS for the User field", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceSdl());
      expect(result.edges).toHaveLength(1);
      const edge = result.edges[0];
      expect(edge.sourceSubgraph).toBe("ORDERS");
      expect(edge.targetSubgraph).toBe("USERS");
      expect(edge.typeName).toBe("User");
      expect(edge.keyFields).toBe("id");
    });

    it("lists both subgraphs sorted alphabetically", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceSdl());
      expect(result.subgraphs).toEqual(["ORDERS", "USERS"]);
    });
  });

  describe("bidirectional / circular references", () => {
    it("creates two nodes for the two entity types", () => {
      const result = schemaToEntityGraph(makeBidirectionalSdl());
      expect(result.nodes).toHaveLength(2);
    });

    it("creates two directed edges for bidirectional references", () => {
      const result = schemaToEntityGraph(makeBidirectionalSdl());
      expect(result.edges).toHaveLength(2);

      const catalogToInventory = result.edges.find(
        (e) => e.sourceSubgraph === "CATALOG" && e.targetSubgraph === "INVENTORY",
      );
      expect(catalogToInventory).toBeDefined();
      expect(catalogToInventory!.typeName).toBe("StockInfo");

      const inventoryToCatalog = result.edges.find(
        (e) => e.sourceSubgraph === "INVENTORY" && e.targetSubgraph === "CATALOG",
      );
      expect(inventoryToCatalog).toBeDefined();
      expect(inventoryToCatalog!.typeName).toBe("Product");
    });
  });

  describe("non-entity types excluded", () => {
    it("does not include types without @key in @join__type", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!, key: String) repeatable on OBJECT | INTERFACE

        enum join__Graph {
          ALPHA @join__graph(name: "alpha", url: "")
        }

        type UserProfile @join__type(graph: ALPHA) {
          name: String
        }

        type Entity @join__type(graph: ALPHA, key: "id") {
          id: ID!
          profile: UserProfile
        }
      `;

      const result = schemaToEntityGraph(sdl);
      expect(result.nodes.map((n) => n.typeName)).toEqual(["Entity"]);
      // UserProfile is not an entity so the field reference creates no edge
      expect(result.edges).toHaveLength(0);
    });
  });

  describe("node IDs", () => {
    it("formats node IDs as 'SUBGRAPH:TypeName'", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceSdl());
      const ids = result.nodes.map((n) => n.id).sort();
      expect(ids).toEqual(["ORDERS:Order", "USERS:User"]);
    });
  });

  describe("edge IDs", () => {
    it("formats edge IDs as 'SOURCE->TARGET:TypeName'", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceSdl());
      expect(result.edges[0].id).toBe("ORDERS->USERS:User");
    });
  });

  describe("multiple @key per subgraph", () => {
    it("collects all key fields for the same entity/subgraph combination", () => {
      const sdl = `
        directive @join__type(graph: join__Graph!, key: String) repeatable on OBJECT | INTERFACE

        enum join__Graph {
          SVC @join__graph(name: "svc", url: "")
        }

        type Product
          @join__type(graph: SVC, key: "id")
          @join__type(graph: SVC, key: "sku") {
          id: ID!
          sku: String!
        }
      `;

      const result = schemaToEntityGraph(sdl);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].keyFields).toEqual(["id", "sku"]);
    });
  });
});
