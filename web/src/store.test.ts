import { describe, expect, it, beforeEach } from "vitest";
import { parse } from "graphql";
import { useWorkspace, activeWorkspace, DEFAULT_NEW_SUBGRAPH_SDL } from "./store";
import type { WorkspaceEntry } from "./share";

/** Update only workspace-level fields on the active workspace. */
function setWs(patch: Partial<WorkspaceEntry>) {
  useWorkspace.setState((s) => ({
    workspaces: s.workspaces.map((ws, i) =>
      i === s.activeWorkspaceIndex ? { ...ws, ...patch } : ws,
    ),
  }));
}

/** Shortcut to get the active workspace from the current store state. */
const aw = () => activeWorkspace(useWorkspace.getState());

describe("workspace store", () => {
  beforeEach(() => {
    useWorkspace.setState({
      workspaces: [
        {
          name: "Workspace 1",
          subgraphs: [{ name: "products", sdl: "" }],
          activeSubgraph: 0,
          queryTabs: [{ name: "Query 1", query: "" }],
          activeQueryTab: 0,
          seed: 42,
          mockConfig: "",
        },
      ],
      activeWorkspaceIndex: 0,
    });
  });

  it("adds a subgraph and makes it active", () => {
    useWorkspace.getState().addSubgraph("reviews");
    const ws = aw();
    expect(ws.subgraphs).toHaveLength(2);
    expect(ws.subgraphs[1].name).toBe("reviews");
    expect(ws.activeSubgraph).toBe(1);
  });

  it("updates only the targeted subgraph's sdl", () => {
    useWorkspace.getState().addSubgraph("reviews");
    useWorkspace.getState().setSubgraphSdl(0, "type Query { a: Int }");
    const ws = aw();
    expect(ws.subgraphs[0].sdl).toBe("type Query { a: Int }");
    // Untouched subgraph keeps its seeded default rather than being blank.
    expect(ws.subgraphs[1].sdl).toBe(DEFAULT_NEW_SUBGRAPH_SDL);
  });

  describe("addSubgraph default sdl (TASK-127)", () => {
    it("seeds a non-empty, valid default schema instead of an empty string", () => {
      useWorkspace.getState().addSubgraph("reviews");
      const sdl = aw().subgraphs[1].sdl;
      expect(sdl).not.toBe("");
      expect(sdl).toContain("extend schema");
      expect(sdl).toContain("type Query");
      // Lightweight syntax check — full composition validation is covered
      // by the WASM core / integration tests, not this unit test file.
      expect(() => parse(sdl)).not.toThrow();
    });
  });

  describe("removeSubgraph (AC #2)", () => {
    it("removes the subgraph at the given index", () => {
      useWorkspace.getState().addSubgraph("reviews");
      useWorkspace.getState().addSubgraph("orders");
      expect(aw().subgraphs).toHaveLength(3);

      useWorkspace.getState().removeSubgraph(1); // remove "reviews"
      const ws = aw();
      expect(ws.subgraphs).toHaveLength(2);
      expect(ws.subgraphs.map((s) => s.name)).toEqual(["products", "orders"]);
    });

    it("selects the nearest neighbor when removing the active tab", () => {
      useWorkspace.getState().addSubgraph("reviews");
      useWorkspace.getState().addSubgraph("orders");
      // Activate index 1 ("reviews")
      useWorkspace.getState().setActiveSubgraph(1);

      useWorkspace.getState().removeSubgraph(1);
      // Nearest neighbor is the one at index 1 now ("orders", which shifted down)
      expect(aw().activeSubgraph).toBe(1);
    });

    it("selects the previous tab when removing the last tab", () => {
      useWorkspace.getState().addSubgraph("reviews");
      // Active is already 1 (the only extra subgraph, i.e. last)
      expect(aw().activeSubgraph).toBe(1);

      useWorkspace.getState().removeSubgraph(1);
      expect(aw().activeSubgraph).toBe(0);
    });

    it("prevents removing the last remaining subgraph", () => {
      useWorkspace.getState().removeSubgraph(0);
      const ws = aw();
      expect(ws.subgraphs).toHaveLength(1);
      expect(ws.subgraphs[0].name).toBe("products");
    });
  });

  describe("setWorkspaceSaved (TASK-126.3)", () => {
    it("sets saved on only the targeted workspace", () => {
      useWorkspace.getState().addWorkspace(); // "Workspace 2", now active at index 1
      useWorkspace.getState().setWorkspaceSaved(0, true);
      const workspaces = useWorkspace.getState().workspaces;
      expect(workspaces[0].saved).toBe(true);
      expect(workspaces[1].saved).toBeUndefined();
    });

    it("clears saved on an already-saved workspace", () => {
      useWorkspace.getState().setWorkspaceSaved(0, true);
      expect(aw().saved).toBe(true);

      useWorkspace.getState().setWorkspaceSaved(0, false);
      expect(aw().saved).toBe(false);
    });
  });

  describe("query tab management", () => {
    it("addQueryTab creates a new tab and makes it active", () => {
      useWorkspace.getState().addQueryTab();
      const ws = aw();
      expect(ws.queryTabs).toHaveLength(2);
      expect(ws.queryTabs[1].name).toBe("Query 2");
      expect(ws.queryTabs[1].query).toBe("");
      expect(ws.activeQueryTab).toBe(1);
    });

    it("addQueryTab picks a name that avoids duplicates", () => {
      useWorkspace.getState().addQueryTab(); // Query 2
      useWorkspace.getState().addQueryTab(); // Query 3
      useWorkspace.getState().removeQueryTab(1); // remove Query 2
      useWorkspace.getState().addQueryTab(); // should be Query 2 again (gap)
      const names = aw().queryTabs.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
      expect(names).toContain("Query 2");
    });

    it("removeQueryTab removes the tab at the given index and adjusts active", () => {
      useWorkspace.getState().addQueryTab(); // Query 2
      useWorkspace.getState().addQueryTab(); // Query 3
      useWorkspace.getState().setActiveQueryTab(1);
      useWorkspace.getState().removeQueryTab(1); // remove Query 2
      const ws = aw();
      expect(ws.queryTabs).toHaveLength(2);
      expect(ws.queryTabs.map((t) => t.name)).toEqual(["Query 1", "Query 3"]);
      expect(ws.activeQueryTab).toBe(1);
    });

    it("removeQueryTab on a tab BEFORE the active tab shifts activeQueryTab left", () => {
      useWorkspace.getState().addQueryTab(); // Query 2
      useWorkspace.getState().addQueryTab(); // Query 3
      useWorkspace.getState().setActiveQueryTab(2); // active = Query 3
      useWorkspace.getState().removeQueryTab(0); // remove Query 1
      const ws = aw();
      expect(ws.queryTabs.map((t) => t.name)).toEqual(["Query 2", "Query 3"]);
      expect(ws.activeQueryTab).toBe(1); // still on Query 3, now at index 1
    });

    it("removeQueryTab on a tab AFTER the active tab leaves activeQueryTab unchanged", () => {
      useWorkspace.getState().addQueryTab(); // Query 2
      useWorkspace.getState().addQueryTab(); // Query 3
      useWorkspace.getState().setActiveQueryTab(0); // active = Query 1
      useWorkspace.getState().removeQueryTab(2); // remove Query 3
      const ws = aw();
      expect(ws.queryTabs.map((t) => t.name)).toEqual(["Query 1", "Query 2"]);
      expect(ws.activeQueryTab).toBe(0); // still on Query 1
    });

    it("removeQueryTab on the only remaining tab replaces it with a default empty tab", () => {
      useWorkspace.getState().removeQueryTab(0);
      const ws = aw();
      expect(ws.queryTabs).toHaveLength(1);
      expect(ws.queryTabs[0].name).toBe("Query 1");
      expect(ws.queryTabs[0].query).toBe("");
      expect(ws.activeQueryTab).toBe(0);
    });

    it("renameQueryTab updates only the targeted tab's name", () => {
      useWorkspace.getState().addQueryTab();
      useWorkspace.getState().renameQueryTab(0, "My Query");
      const ws = aw();
      expect(ws.queryTabs[0].name).toBe("My Query");
      expect(ws.queryTabs[1].name).toBe("Query 2");
    });

    it("setQueryTabQuery updates only the targeted tab's query text", () => {
      useWorkspace.getState().addQueryTab();
      useWorkspace.getState().setQueryTabQuery(0, "query { a }");
      const ws = aw();
      expect(ws.queryTabs[0].query).toBe("query { a }");
      expect(ws.queryTabs[1].query).toBe("");
    });

    it("setActiveQueryTab changes the active tab index", () => {
      useWorkspace.getState().addQueryTab();
      useWorkspace.getState().setActiveQueryTab(1);
      expect(aw().activeQueryTab).toBe(1);
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

  describe("mockConfig (TASK-78)", () => {
    it("setMockConfig updates the mockConfig field", () => {
      setWs({ mockConfig: "" });
      useWorkspace.getState().setMockConfig("User.name:\n  enum: [Alice]");
      expect(aw().mockConfig).toBe("User.name:\n  enum: [Alice]");
    });

    it("setMockConfig can clear the config to empty string", () => {
      setWs({ mockConfig: "User.name:\n  enum: [Alice]" });
      useWorkspace.getState().setMockConfig("");
      expect(aw().mockConfig).toBe("");
    });
  });
});
