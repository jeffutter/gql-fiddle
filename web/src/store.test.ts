import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspace } from "./store";

describe("workspace store", () => {
  beforeEach(() => {
    useWorkspace.setState({ subgraphs: [{ name: "products", sdl: "" }], activeSubgraph: 0 });
  });

  it("adds a subgraph and makes it active", () => {
    useWorkspace.getState().addSubgraph("reviews");
    const state = useWorkspace.getState();
    expect(state.subgraphs).toHaveLength(2);
    expect(state.subgraphs[1].name).toBe("reviews");
    expect(state.activeSubgraph).toBe(1);
  });

  it("updates only the targeted subgraph's sdl", () => {
    useWorkspace.getState().addSubgraph("reviews");
    useWorkspace.getState().setSubgraphSdl(0, "type Query { a: Int }");
    const state = useWorkspace.getState();
    expect(state.subgraphs[0].sdl).toBe("type Query { a: Int }");
    expect(state.subgraphs[1].sdl).toBe("");
  });

  describe("removeSubgraph (AC #2)", () => {
    it("removes the subgraph at the given index", () => {
      useWorkspace.getState().addSubgraph("reviews");
      useWorkspace.getState().addSubgraph("orders");
      const before = useWorkspace.getState();
      expect(before.subgraphs).toHaveLength(3);

      useWorkspace.getState().removeSubgraph(1); // remove "reviews"
      const after = useWorkspace.getState();
      expect(after.subgraphs).toHaveLength(2);
      expect(after.subgraphs.map((s) => s.name)).toEqual(["products", "orders"]);
    });

    it("selects the nearest neighbor when removing the active tab", () => {
      useWorkspace.getState().addSubgraph("reviews");
      useWorkspace.getState().addSubgraph("orders");
      // Activate index 1 ("reviews")
      useWorkspace.getState().setActiveSubgraph(1);

      useWorkspace.getState().removeSubgraph(1);
      const after = useWorkspace.getState();
      // Nearest neighbor is the one at index 1 now ("orders", which shifted down)
      expect(after.activeSubgraph).toBe(1);
    });

    it("selects the previous tab when removing the last tab", () => {
      useWorkspace.getState().addSubgraph("reviews");
      // Active is already 1 (the only extra subgraph, i.e. last)
      expect(useWorkspace.getState().activeSubgraph).toBe(1);

      useWorkspace.getState().removeSubgraph(1);
      const after = useWorkspace.getState();
      expect(after.activeSubgraph).toBe(0);
    });

    it("prevents removing the last remaining subgraph", () => {
      useWorkspace.getState().removeSubgraph(0);
      const after = useWorkspace.getState();
      expect(after.subgraphs).toHaveLength(1);
      expect(after.subgraphs[0].name).toBe("products");
    });
  });

  describe("compose result persistence (AC #4)", () => {
    it("stores supergraphSdl on successful compose", () => {
      const state = useWorkspace.getState();
      expect(state.supergraphSdl).toBeNull();
      state.setComposeResult("schema { query: Query }\ntype Query { hello: String }", null, 0);
      const updated = useWorkspace.getState();
      expect(updated.supergraphSdl).toBe("schema { query: Query }\ntype Query { hello: String }");
      expect(updated.composeErrors).toBeNull();
      expect(updated.composeHints).toBe(0);
    });

    it("preserves supergraphSdl when compose fails", () => {
      const state = useWorkspace.getState();
      // First, succeed so we have a stored SDL.
      state.setComposeResult("schema { query: Query }\ntype Query { hello: String }", null, 0);
      expect(state.supergraphSdl).toBe("schema { query: Query }\ntype Query { hello: String }");

      // Now compose fails.
      state.setComposeResult(null, [{ code: "ERR001", message: "bad stuff" }], 0);
      const afterFail = useWorkspace.getState();
      // SDL should be preserved (stale supergraph).
      expect(afterFail.supergraphSdl).toBe("schema { query: Query }\ntype Query { hello: String }");
      expect(afterFail.composeErrors).toEqual([{ code: "ERR001", message: "bad stuff" }]);
      expect(afterFail.composeHints).toBe(0);
    });

    it("updates composeHints from successful compose", () => {
      const state = useWorkspace.getState();
      state.setComposeResult("type Query { a: Int }", null, 3);
      const updated = useWorkspace.getState();
      expect(updated.composeHints).toBe(3);
      expect(updated.supergraphSdl).toBe("type Query { a: Int }");
    });

    it("resets composeErrors to null on success", () => {
      const state = useWorkspace.getState();
      // Start with errors.
      state.setComposeResult(null, [{ code: "ERR001", message: "oops" }], 0);
      expect(useWorkspace.getState().composeErrors).toEqual([{ code: "ERR001", message: "oops" }]);

      // Then succeed.
      state.setComposeResult("type Query { a: Int }", null, 0);
      expect(useWorkspace.getState().composeErrors).toBeNull();
    });
  });
});
