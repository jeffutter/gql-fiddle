import { describe, it, expect } from "vitest";
import { schemaToEntityGraph } from "./schemaToEntityGraph";
import type { RustGraph } from "./core/types";

// ---------------------------------------------------------------------------
// Helpers to build RustGraph inputs matching what the Rust compose() emits
// ---------------------------------------------------------------------------

/**
 * Single-subgraph entity: one entity "Product" in "PRODUCTS".
 */
function makeSingleSubgraphGraph(): RustGraph {
  return {
    nodes: [{ id: "PRODUCTS:Product", label: "Product", subgraphs: ["PRODUCTS"] }],
    edges: [],
    subgraphs: ["PRODUCTS"],
  };
}

/**
 * Two subgraphs: "User" in USERS, "Order" in ORDERS, with Order.user → User cross-subgraph edge.
 */
function makeTwoSubgraphEntityReferenceGraph(): RustGraph {
  return {
    nodes: [
      { id: "ORDERS:Order", label: "Order", subgraphs: ["ORDERS"] },
      { id: "USERS:User", label: "User", subgraphs: ["USERS"] },
    ],
    edges: [{ source: "ORDERS:Order", target: "USERS:User", label: "id" }],
    subgraphs: ["ORDERS", "USERS"],
  };
}

/**
 * Bidirectional: Product in CATALOG ↔ StockInfo in INVENTORY.
 */
function makeBidirectionalGraph(): RustGraph {
  return {
    nodes: [
      { id: "CATALOG:Product", label: "Product", subgraphs: ["CATALOG"] },
      { id: "INVENTORY:StockInfo", label: "StockInfo", subgraphs: ["INVENTORY"] },
    ],
    edges: [
      { source: "CATALOG:Product", target: "INVENTORY:StockInfo", label: "sku" },
      { source: "INVENTORY:StockInfo", target: "CATALOG:Product", label: "sku" },
    ],
    subgraphs: ["CATALOG", "INVENTORY"],
  };
}

function makeEmptyGraph(): RustGraph {
  return { nodes: [], edges: [], subgraphs: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schemaToEntityGraph", () => {
  it("returns empty graph for empty input", () => {
    const result = schemaToEntityGraph(makeEmptyGraph());
    expect(result).toEqual({ nodes: [], edges: [], subgraphs: [] });
  });

  it("returns empty graph when no entity types found", () => {
    const result = schemaToEntityGraph(makeEmptyGraph());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.subgraphs).toHaveLength(0);
  });

  describe("single-subgraph schema", () => {
    it("creates one node for the entity type", () => {
      const result = schemaToEntityGraph(makeSingleSubgraphGraph());
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].typeName).toBe("Product");
      expect(result.nodes[0].subgraph).toBe("PRODUCTS");
    });

    it("produces no cross-subgraph edges for a single subgraph", () => {
      const result = schemaToEntityGraph(makeSingleSubgraphGraph());
      expect(result.edges).toHaveLength(0);
    });

    it("includes the subgraph in the subgraphs list", () => {
      const result = schemaToEntityGraph(makeSingleSubgraphGraph());
      expect(result.subgraphs).toEqual(["PRODUCTS"]);
    });
  });

  describe("two-subgraph entity reference", () => {
    it("creates one node per entity type", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceGraph());
      expect(result.nodes).toHaveLength(2);

      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user).toBeDefined();
      expect(user!.subgraph).toBe("USERS");

      const order = result.nodes.find((n) => n.typeName === "Order");
      expect(order).toBeDefined();
      expect(order!.subgraph).toBe("ORDERS");
    });

    it("creates a directed edge from ORDERS to USERS for the User field", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceGraph());
      expect(result.edges).toHaveLength(1);
      const edge = result.edges[0];
      expect(edge.sourceSubgraph).toBe("ORDERS");
      expect(edge.targetSubgraph).toBe("USERS");
      expect(edge.typeName).toBe("User");
      expect(edge.keyFields).toBe("id");
    });

    it("lists both subgraphs", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceGraph());
      expect(result.subgraphs).toEqual(["ORDERS", "USERS"]);
    });
  });

  describe("bidirectional / circular references", () => {
    it("creates two nodes for the two entity types", () => {
      const result = schemaToEntityGraph(makeBidirectionalGraph());
      expect(result.nodes).toHaveLength(2);
    });

    it("creates two directed edges for bidirectional references", () => {
      const result = schemaToEntityGraph(makeBidirectionalGraph());
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

  describe("node IDs", () => {
    it("formats node IDs as 'SUBGRAPH:TypeName'", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceGraph());
      const ids = result.nodes.map((n) => n.id).sort();
      expect(ids).toEqual(["ORDERS:Order", "USERS:User"]);
    });
  });

  describe("edge IDs", () => {
    it("formats edge IDs as 'SOURCE->TARGET:TypeName'", () => {
      const result = schemaToEntityGraph(makeTwoSubgraphEntityReferenceGraph());
      expect(result.edges[0].id).toBe("ORDERS->USERS:User");
    });
  });
});
