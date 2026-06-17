import { describe, it, expect } from "vitest";
import { schemaToTypeGraph } from "./schemaToTypeGraph";
import type { RustGraph } from "./core/types";

// ---------------------------------------------------------------------------
// Helpers to build RustGraph inputs matching what the Rust compose() emits
// ---------------------------------------------------------------------------

function makeEmptyGraph(): RustGraph {
  return { nodes: [], edges: [], subgraphs: [] };
}

/** Single object type in USERS subgraph. */
function makeSingleObjectTypeGraph(): RustGraph {
  return {
    nodes: [{ id: "User", label: "User", subgraphs: ["USERS"], kind: "object" }],
    edges: [],
    subgraphs: ["USERS"],
  };
}

/** Two object types with a field edge from User to Order. */
function makeFieldEdgeGraph(): RustGraph {
  return {
    nodes: [
      { id: "User", label: "User", subgraphs: ["USERS"], kind: "object" },
      { id: "Order", label: "Order", subgraphs: ["ORDERS"], kind: "object" },
    ],
    edges: [{ source: "User", target: "Order" }],
    subgraphs: ["ORDERS", "USERS"],
  };
}

/** Custom scalars and enum. */
function makeScalarEnumGraph(): RustGraph {
  return {
    nodes: [
      { id: "JSON", label: "JSON", subgraphs: [], kind: "scalar" },
      { id: "DateTime", label: "DateTime", subgraphs: [], kind: "scalar" },
      { id: "Status", label: "Status", subgraphs: ["SVC"], kind: "enum" },
      { id: "Product", label: "Product", subgraphs: ["SVC"], kind: "object" },
    ],
    edges: [{ source: "Product", target: "Status" }],
    subgraphs: ["SVC"],
  };
}

/** Interface type. */
function makeInterfaceGraph(): RustGraph {
  return {
    nodes: [
      { id: "NodeInterface", label: "NodeInterface", subgraphs: ["SVC"], kind: "interface" },
      { id: "User", label: "User", subgraphs: ["SVC"], kind: "object" },
    ],
    edges: [],
    subgraphs: ["SVC"],
  };
}

/** Input object type. */
function makeInputGraph(): RustGraph {
  return {
    nodes: [
      { id: "CreateUserInput", label: "CreateUserInput", subgraphs: [], kind: "input" },
      { id: "User", label: "User", subgraphs: ["SVC"], kind: "object" },
    ],
    edges: [],
    subgraphs: ["SVC"],
  };
}

/** Union type. */
function makeUnionGraph(): RustGraph {
  return {
    nodes: [
      { id: "Cat", label: "Cat", subgraphs: ["SVC"], kind: "object" },
      { id: "Dog", label: "Dog", subgraphs: ["SVC"], kind: "object" },
      { id: "Animal", label: "Animal", subgraphs: ["SVC"], kind: "union" },
    ],
    edges: [
      { source: "Animal", target: "Cat" },
      { source: "Animal", target: "Dog" },
    ],
    subgraphs: ["SVC"],
  };
}

/** Type shared across multiple subgraphs. */
function makeSharedTypeGraph(): RustGraph {
  return {
    nodes: [{ id: "User", label: "User", subgraphs: ["USERS", "ORDERS"], kind: "object" }],
    edges: [],
    subgraphs: ["ORDERS", "USERS"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schemaToTypeGraph", () => {
  it("returns empty graph for empty input", () => {
    const result = schemaToTypeGraph(makeEmptyGraph());
    expect(result).toEqual({ nodes: [], edges: [], subgraphs: [] });
  });

  describe("single object type", () => {
    it("creates one node with correct typeName and kind", () => {
      const result = schemaToTypeGraph(makeSingleObjectTypeGraph());
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user).toBeDefined();
      expect(user!.kind).toBe("object");
    });

    it("sets the subgraph from the subgraphs list", () => {
      const result = schemaToTypeGraph(makeSingleObjectTypeGraph());
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user!.subgraph).toBe("USERS");
      expect(user!.subgraphs).toContain("USERS");
    });

    it("uses typeName as the node id", () => {
      const result = schemaToTypeGraph(makeSingleObjectTypeGraph());
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user!.id).toBe("User");
    });
  });

  describe("field edge between two object types", () => {
    it("emits one edge from User to Order", () => {
      const result = schemaToTypeGraph(makeFieldEdgeGraph());
      const edge = result.edges.find((e) => e.sourceType === "User" && e.targetType === "Order");
      expect(edge).toBeDefined();
    });

    it("uses 'source->target' as edge id", () => {
      const result = schemaToTypeGraph(makeFieldEdgeGraph());
      const edge = result.edges.find((e) => e.sourceType === "User");
      expect(edge!.id).toBe("User->Order");
    });
  });

  describe("scalar and enum nodes", () => {
    it("includes custom Scalar nodes with kind 'scalar'", () => {
      const result = schemaToTypeGraph(makeScalarEnumGraph());
      const json = result.nodes.find((n) => n.typeName === "JSON");
      expect(json).toBeDefined();
      expect(json!.kind).toBe("scalar");
    });

    it("includes Enum nodes with kind 'enum'", () => {
      const result = schemaToTypeGraph(makeScalarEnumGraph());
      const status = result.nodes.find((n) => n.typeName === "Status");
      expect(status).toBeDefined();
      expect(status!.kind).toBe("enum");
    });

    it("includes edge from Product to Status enum", () => {
      const result = schemaToTypeGraph(makeScalarEnumGraph());
      const edge = result.edges.find(
        (e) => e.sourceType === "Product" && e.targetType === "Status",
      );
      expect(edge).toBeDefined();
    });
  });

  describe("interface types", () => {
    it("includes interface types with kind 'interface'", () => {
      const result = schemaToTypeGraph(makeInterfaceGraph());
      const iface = result.nodes.find((n) => n.typeName === "NodeInterface");
      expect(iface).toBeDefined();
      expect(iface!.kind).toBe("interface");
    });
  });

  describe("input types", () => {
    it("includes input object types with kind 'input'", () => {
      const result = schemaToTypeGraph(makeInputGraph());
      const input = result.nodes.find((n) => n.typeName === "CreateUserInput");
      expect(input).toBeDefined();
      expect(input!.kind).toBe("input");
    });
  });

  describe("union types", () => {
    it("includes union types with kind 'union'", () => {
      const result = schemaToTypeGraph(makeUnionGraph());
      const union = result.nodes.find((n) => n.typeName === "Animal");
      expect(union).toBeDefined();
      expect(union!.kind).toBe("union");
    });

    it("emits edges from union to each member type", () => {
      const result = schemaToTypeGraph(makeUnionGraph());
      const catEdge = result.edges.find((e) => e.sourceType === "Animal" && e.targetType === "Cat");
      const dogEdge = result.edges.find((e) => e.sourceType === "Animal" && e.targetType === "Dog");
      expect(catEdge).toBeDefined();
      expect(dogEdge).toBeDefined();
    });

    it("uses 'union->member' as edge id for union member edges", () => {
      const result = schemaToTypeGraph(makeUnionGraph());
      const edge = result.edges.find((e) => e.sourceType === "Animal" && e.targetType === "Cat");
      expect(edge!.id).toBe("Animal->Cat");
    });
  });

  describe("types shared across multiple subgraphs", () => {
    it("collects all subgraphs for a shared type", () => {
      const result = schemaToTypeGraph(makeSharedTypeGraph());
      const user = result.nodes.find((n) => n.typeName === "User");
      expect(user).toBeDefined();
      expect(user!.subgraphs).toContain("USERS");
      expect(user!.subgraphs).toContain("ORDERS");
      // primary subgraph is the first one in the list
      expect(user!.subgraph).toBe("USERS");
    });
  });

  describe("subgraphs list", () => {
    it("returns subgraph names from the rust graph", () => {
      const result = schemaToTypeGraph(makeFieldEdgeGraph());
      expect(result.subgraphs).toEqual(["ORDERS", "USERS"]);
    });
  });
});
