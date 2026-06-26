import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspace, computeOverrides, activeWorkspace } from "./store";
import type { WorkspaceEntry, WorkspacePayload } from "./share";

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
          tourDraft: null,
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
    expect(ws.subgraphs[1].sdl).toBe("");
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

    it("mockConfig is included in computeOverrides diff when changed", () => {
      const base: WorkspacePayload = {
        subgraphs: [{ name: "a", sdl: "" }],
        queryTabs: [{ name: "Q", query: "" }],
        activeQueryTab: 0,
        seed: 1,
        mockConfig: "",
      };
      const current: WorkspacePayload = { ...base, mockConfig: "User.role:\n  enum: [ADMIN]" };
      const result = computeOverrides(base, current);
      expect(result).toEqual({ mockConfig: "User.role:\n  enum: [ADMIN]" });
    });

    it("mockConfig unchanged produces no override in computeOverrides", () => {
      const base: WorkspacePayload = {
        subgraphs: [{ name: "a", sdl: "" }],
        queryTabs: [{ name: "Q", query: "" }],
        activeQueryTab: 0,
        seed: 1,
        mockConfig: "User.name:\n  enum: [Alice]",
      };
      const current: WorkspacePayload = { ...base };
      const result = computeOverrides(base, current);
      expect(result).toBeUndefined();
    });
  });

  describe("computeOverrides (TASK-66)", () => {
    const base: WorkspacePayload = {
      subgraphs: [{ name: "a", sdl: "type Query { x: Int }" }],
      queryTabs: [{ name: "Q1", query: "{ x }" }],
      activeQueryTab: 0,
      seed: 42,
      mockConfig: "",
    };

    it("returns undefined when current equals base", () => {
      const result = computeOverrides(base, { ...base });
      expect(result).toBeUndefined();
    });

    it("returns only the changed key when one field differs", () => {
      const current: WorkspacePayload = { ...base, seed: 99 };
      const result = computeOverrides(base, current);
      expect(result).toEqual({ seed: 99 });
      // Other keys must NOT be present.
      expect(result).not.toHaveProperty("subgraphs");
      expect(result).not.toHaveProperty("queryTabs");
      expect(result).not.toHaveProperty("activeQueryTab");
    });

    it("returns all keys when all fields differ", () => {
      const current: WorkspacePayload = {
        subgraphs: [{ name: "b", sdl: "type Query { y: String }" }],
        queryTabs: [{ name: "Q2", query: "{ y }" }],
        activeQueryTab: 1,
        seed: 7,
        mockConfig: "User.name:\n  enum: [Alice]",
      };
      const result = computeOverrides(base, current);
      expect(result).toHaveProperty("subgraphs");
      expect(result).toHaveProperty("queryTabs");
      expect(result).toHaveProperty("activeQueryTab", 1);
      expect(result).toHaveProperty("seed", 7);
      expect(result).toHaveProperty("mockConfig", "User.name:\n  enum: [Alice]");
    });
  });

  describe("tour authoring store actions (TASK-66)", () => {
    const baseTourPayload: WorkspacePayload = {
      subgraphs: [{ name: "base", sdl: "type Query { a: Int }" }],
      queryTabs: [{ name: "Q", query: "{ a }" }],
      activeQueryTab: 0,
      seed: 1,
      mockConfig: "",
    };

    beforeEach(() => {
      useWorkspace.setState({
        workspaces: [
          {
            name: "Workspace 1",
            subgraphs: baseTourPayload.subgraphs,
            activeSubgraph: 0,
            queryTabs: baseTourPayload.queryTabs,
            activeQueryTab: baseTourPayload.activeQueryTab,
            seed: baseTourPayload.seed,
            mockConfig: baseTourPayload.mockConfig ?? "",
            tourDraft: {
              title: "My Tour",
              base: baseTourPayload,
              steps: [],
            },
          },
        ],
        activeWorkspaceIndex: 0,
        tourActiveStep: null,
      });
    });

    it("snapshotCurrentToStep('new') appends a new step with correct overrides", () => {
      // Change the seed so there's a diff.
      setWs({ seed: 99 });
      useWorkspace.getState().snapshotCurrentToStep("new");
      const ws = aw();
      expect(ws.tourDraft!.steps).toHaveLength(1);
      expect(ws.tourDraft!.steps[0].overrides).toEqual({ seed: 99 });
    });

    it("snapshotCurrentToStep('new') stores undefined overrides when nothing changed", () => {
      useWorkspace.getState().snapshotCurrentToStep("new");
      const ws = aw();
      expect(ws.tourDraft!.steps).toHaveLength(1);
      expect(ws.tourDraft!.steps[0].overrides).toBeUndefined();
    });

    it("snapshotCurrentToStep(i) updates the existing step's overrides", () => {
      // Add a step with no changes first.
      useWorkspace.getState().snapshotCurrentToStep("new");
      // Now change the workspace and save into step 0.
      setWs({ seed: 55 });
      useWorkspace.getState().snapshotCurrentToStep(0);
      const ws = aw();
      expect(ws.tourDraft!.steps[0].overrides).toEqual({ seed: 55 });
    });

    it("loadTourStep writes the resolved workspace into the store", () => {
      // Add a step with seed override.
      setWs({ seed: 99 });
      useWorkspace.getState().snapshotCurrentToStep("new");
      // Reset to base seed.
      setWs({ seed: baseTourPayload.seed });
      // Load the step — should restore seed 99.
      useWorkspace.getState().loadTourStep(0);
      expect(aw().seed).toBe(99);
    });

    it("setStepAnchor sets anchor on a step", () => {
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 0
      useWorkspace.getState().setStepAnchor(0, { subgraphIndex: 0, typeName: "Product" });
      const ws = aw();
      expect(ws.tourDraft!.steps[0].anchor).toEqual({
        subgraphIndex: 0,
        typeName: "Product",
      });
    });

    it("setStepAnchor sets anchor with fieldName on a step", () => {
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 0
      useWorkspace.getState().setStepAnchor(0, {
        subgraphIndex: 0,
        typeName: "Product",
        fieldName: "price",
      });
      const ws = aw();
      expect(ws.tourDraft!.steps[0].anchor).toEqual({
        subgraphIndex: 0,
        typeName: "Product",
        fieldName: "price",
      });
    });

    it("setStepAnchor(i, undefined) clears the anchor", () => {
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 0
      useWorkspace.getState().setStepAnchor(0, { subgraphIndex: 0, typeName: "Product" });
      expect(aw().tourDraft!.steps[0].anchor).toBeDefined();

      useWorkspace.getState().setStepAnchor(0, undefined);
      expect(aw().tourDraft!.steps[0].anchor).toBeUndefined();
    });

    it("snapshotCurrentToStep preserves anchor when updating overrides", () => {
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 0
      useWorkspace.getState().setStepAnchor(0, { subgraphIndex: 0, typeName: "Product" });

      // Change workspace and save — anchor must survive.
      setWs({ seed: 77 });
      useWorkspace.getState().snapshotCurrentToStep(0);

      const ws = aw();
      expect(ws.tourDraft!.steps[0].overrides).toEqual({ seed: 77 });
      expect(ws.tourDraft!.steps[0].anchor).toEqual({
        subgraphIndex: 0,
        typeName: "Product",
      });
    });

    it("setStepPaneVisibility sets a pane visibility flag on the target step", () => {
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 0
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 1
      useWorkspace.getState().setStepPaneVisibility(0, "plan", false);
      const ws = aw();
      expect(ws.tourDraft!.steps[0].paneVisibility?.plan).toBe(false);
    });

    it("setStepPaneVisibility does not affect adjacent steps", () => {
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 0
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 1
      useWorkspace.getState().setStepPaneVisibility(0, "schema", false);
      const ws = aw();
      // Step 1 should remain untouched (no paneVisibility set).
      expect(ws.tourDraft!.steps[1].paneVisibility).toBeUndefined();
    });

    it("setStepPaneVisibility can set multiple panes independently", () => {
      useWorkspace.getState().snapshotCurrentToStep("new"); // add step 0
      useWorkspace.getState().setStepPaneVisibility(0, "schema", false);
      useWorkspace.getState().setStepPaneVisibility(0, "plan", true);
      const ws = aw();
      expect(ws.tourDraft!.steps[0].paneVisibility?.schema).toBe(false);
      expect(ws.tourDraft!.steps[0].paneVisibility?.plan).toBe(true);
    });

    it("step reorder: swapping step 0 and step 1 updates the steps array", () => {
      // Add two steps with different seeds.
      setWs({ seed: 10 });
      useWorkspace.getState().snapshotCurrentToStep("new"); // step 0
      setWs({ seed: 20 });
      useWorkspace.getState().snapshotCurrentToStep("new"); // step 1

      const before = aw().tourDraft!.steps;
      expect(before[0].overrides?.seed).toBe(10);
      expect(before[1].overrides?.seed).toBe(20);

      // Simulate move-up on step 1: swap steps[0] and steps[1].
      const steps = [...before];
      [steps[0], steps[1]] = [steps[1], steps[0]];
      useWorkspace.getState().setTourDraft({ ...aw().tourDraft!, steps });

      const after = aw().tourDraft!.steps;
      expect(after[0].overrides?.seed).toBe(20);
      expect(after[1].overrides?.seed).toBe(10);
    });
  });
});
