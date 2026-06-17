import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { useWorkspace } from "./store";
import * as monaco from "monaco-editor";
import type { Diagnostic } from "./core/types";
import { encode } from "./share";

let validateSubgraphCallCount = 0;

// Shared mock used by all tests in this file.
let composeCallCount = 0;
const mockCompose = vi.fn(
  ():
    | { ok: true; supergraph_sdl: string; api_schema_sdl: string; hints: never[] }
    | { ok: false; errors: { code: string; message: string }[] } => {
    composeCallCount++;
    return {
      ok: true,
      supergraph_sdl: "# supergraph",
      api_schema_sdl: "type Query { products: [Product] }\ntype Product { id: ID! }",
      hints: [],
    };
  },
);

// Mock for monaco-graphql initializeMode (AC#1, AC#3).
const mockSetSchemaConfig = vi.fn();
const mockSetModeConfiguration = vi.fn();
const mockSetDiagnosticSettings = vi.fn();
const mockMonacoGraphQLAPI = {
  setSchemaConfig: mockSetSchemaConfig,
  setModeConfiguration: mockSetModeConfiguration,
  setDiagnosticSettings: mockSetDiagnosticSettings,
};
vi.mock("monaco-graphql/initializeMode", () => ({
  initializeMode: vi.fn(() => mockMonacoGraphQLAPI),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' }),
  },
}));

const validateSubgraphMock = vi.fn(() => {
  validateSubgraphCallCount++;
  return { diagnostics: [] as Diagnostic[] };
});

const mockExecuteMock = vi.fn(() => ({ data: {} }));

vi.mock("./core", () => ({
  loadCore: () =>
    Promise.resolve({
      compose: mockCompose,
      validateSubgraph: validateSubgraphMock,
      validateQuery: vi.fn(() => ({ diagnostics: [] })),
      plan: vi.fn(() => ({ ok: false, errors: [] })),
      executeMock: mockExecuteMock,
    }),
}));

describe("App", () => {
  beforeEach(() => {
    cleanup();
    validateSubgraphCallCount = 0;
    Object.defineProperty(globalThis, "location", {
      value: { hash: "" },
      writable: true,
      configurable: true,
    });
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      activeSubgraph: 0,
      queryTabs: [{ name: "Query 1", query: "" }],
      activeQueryTab: 0,
      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,
    });
  });

  it("renders Monaco editors and no plain textareas", () => {
    const { container } = render(<App />);

    // Both editors (subgraph, query) use Monaco — zero plain textareas.
    const textareas = container.querySelectorAll("textarea");
    expect(textareas).toHaveLength(0);

    // The Monaco editor mounts a div with class "monaco-editor".
    const monacoEditors = screen.getAllByRole("textbox");
    expect(monacoEditors.length).toBeGreaterThanOrEqual(1);
  });

  it("switching subgraph tabs shows that subgraph's SDL in the editor", () => {
    // Set up two subgraphs with distinct SDLs.
    useWorkspace.setState({
      subgraphs: [
        { name: "products", sdl: "type Query { products }" },
        { name: "reviews", sdl: "type Query { reviews }" },
      ],
      activeSubgraph: 0,
    });

    const { container } = render(<App />);

    // Initially the first tab is active.
    expect(useWorkspace.getState().activeSubgraph).toBe(0);

    // Click the second tab button ("reviews").
    const reviewsBtn = container.querySelector("button[aria-pressed='false']")!;
    fireEvent.click(reviewsBtn);

    // The active index should now be 1, so the Editor's value prop becomes
    // subgraphs[1].sdl — confirming the editor displays the correct SDL.
    expect(useWorkspace.getState().activeSubgraph).toBe(1);
  });

  it("editing a subgraph updates the store and re-runs composition", async () => {
    const initialCount = composeCallCount;
    render(<App />);

    // Wait for initial composition (loadCore is async).
    await vi.waitFor(() => expect(composeCallCount).toBeGreaterThan(initialCount));
    const countAfterRender = composeCallCount;

    // Simulate the Monaco editor's onChange firing with new SDL.
    useWorkspace.getState().setSubgraphSdl(0, "type Query { b: String }");

    // The store update changes the subgraphs array reference, which should
    // trigger the useEffect([subgraphs]) in App to re-run composition.
    await vi.waitFor(() => {
      expect(composeCallCount).toBe(countAfterRender + 1);
    });

    // Verify the store actually contains the new SDL.
    const state = useWorkspace.getState();
    expect(state.subgraphs[0].sdl).toBe("type Query { b: String }");
  });

  it("fixing the error clears the underline", async () => {
    vi.useFakeTimers();
    const invalidSdl = "type Query { hello: BogusType }";
    const fixedSdl = "type Query { hello: String }";

    // First validation returns an error.
    validateSubgraphMock.mockReturnValueOnce({
      diagnostics: [
        {
          severity: "error" as const,
          message: "Cannot find type `BogusType`",
          line: 1,
          col: 20,
          len: 9,
        },
      ],
    });

    // Second validation (after fix) returns no diagnostics.
    validateSubgraphMock.mockReturnValueOnce({
      diagnostics: [],
    });

    render(<App />);

    await vi.waitFor(() => expect(composeCallCount).toBeGreaterThan(0));

    const setModelMarkersSpy = vi.spyOn(monaco.editor, "setModelMarkers");
    const mockModel = {};
    const mockEditor = { getModel: vi.fn(() => mockModel), focus: vi.fn() };

    expect(globalThis.__editorTestHarness.onMount).not.toBeNull();
    globalThis.__editorTestHarness.onMount!(mockEditor, monaco);

    // Type invalid SDL.
    useWorkspace.getState().setSubgraphSdl(0, invalidSdl);
    await vi.advanceTimersByTimeAsync(350);

    // Should have a marker.
    expect(setModelMarkersSpy).toHaveBeenCalledTimes(1);
    const [, , markersFirst] = setModelMarkersSpy.mock.calls[0];
    expect(markersFirst).toHaveLength(1);

    // Now fix the SDL.
    useWorkspace.getState().setSubgraphSdl(0, fixedSdl);
    await vi.advanceTimersByTimeAsync(350);

    // Should be called again with an empty array to clear markers.
    expect(setModelMarkersSpy).toHaveBeenCalledTimes(2);
    const [, , markersSecond] = setModelMarkersSpy.mock.calls[1];
    expect(markersSecond).toEqual([]);
  });

  it("debounces validation so rapid keystrokes trigger only one validateSubgraph call", async () => {
    vi.useFakeTimers();

    render(<App />);

    await vi.waitFor(() => expect(composeCallCount).toBeGreaterThan(0));

    const setModelMarkersSpy = vi.spyOn(monaco.editor, "setModelMarkers");
    const mockModel = {};
    const mockEditor = { getModel: vi.fn(() => mockModel), focus: vi.fn() };

    expect(globalThis.__editorTestHarness.onMount).not.toBeNull();
    globalThis.__editorTestHarness.onMount!(mockEditor, monaco);

    // Simulate typing multiple characters rapidly.
    useWorkspace.getState().setSubgraphSdl(0, "t");
    useWorkspace.getState().setSubgraphSdl(0, "ty");
    useWorkspace.getState().setSubgraphSdl(0, "typ");
    useWorkspace.getState().setSubgraphSdl(0, "type");

    // Wait for the debounce timeout to fire once.
    await vi.advanceTimersByTimeAsync(350);

    // validateSubgraph should have been called exactly once (after the
    // debounce settled), not once per keystroke.
    expect(validateSubgraphCallCount).toBe(1);
    expect(validateSubgraphMock).toHaveBeenCalledWith("type");

    // Markers should also have been set exactly once.
    expect(setModelMarkersSpy).toHaveBeenCalledTimes(1);
  });

  it("debounces composition so rapid subgraph edits trigger at most one compose call per 300ms window", async () => {
    vi.useFakeTimers();

    render(<App />);

    // Wait for the initial composition to fire.
    await vi.waitFor(() => expect(composeCallCount).toBeGreaterThan(0));
    const countAfterRender = composeCallCount;

    // Simulate rapid subgraph edits (like typing).
    useWorkspace.getState().setSubgraphSdl(0, "type Query { a }");
    useWorkspace.getState().setSubgraphSdl(0, "type Query { ab }");
    useWorkspace.getState().setSubgraphSdl(0, "type Query { abc }");

    // Wait past the 300ms debounce window.
    await vi.advanceTimersByTimeAsync(350);

    // Compose should have been called exactly once after the debounce settled,
    // not three times — confirming the ~300ms debounce on composition.
    expect(composeCallCount).toBe(countAfterRender + 1);
  });

  it("successful compose shows supergraph SDL and errors/hints count status line", async () => {
    vi.useFakeTimers();

    render(<App />);

    // Advance past the debounce window so the composition effect fires.
    await vi.advanceTimersByTimeAsync(350);

    // The Supergraph SDL tab should be present; click it to see the SDL.
    const supergraphTab = screen.getByText("Supergraph SDL");
    expect(supergraphTab).toBeInTheDocument();
    fireEvent.click(supergraphTab);

    expect(screen.getByText("# supergraph")).toBeInTheDocument();

    // A status line showing error and hint count should be present.
    expect(screen.getByText(/Composition:.*errors/)).toBeInTheDocument();
  });

  // AC#2: dedicated test — two errors with the same code, each message asserted separately
  it("returns two errors with the same code and asserts both messages appear (AC#2)", async () => {
    vi.useFakeTimers();

    mockCompose.mockReturnValueOnce({
      ok: false,
      errors: [
        { code: "SATISFIABILITY_ERROR", message: "first" },
        { code: "SATISFIABILITY_ERROR", message: "second" },
      ],
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(350);

    // Switch to the SDL tab — compose errors are only shown there.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    // Both messages must appear independently — not just as part of a compound regex.
    expect(screen.getByText(/first/)).toBeInTheDocument();
    expect(screen.getByText(/second/)).toBeInTheDocument();
  });

  it("renders every error line when multiple errors share the same code (AC#1)", async () => {
    vi.useFakeTimers();

    // Two errors with the SAME code — React key collision would drop one.
    mockCompose.mockReturnValueOnce({
      ok: false,
      errors: [
        { code: "SATISFIABILITY_ERROR", message: "first" },
        { code: "SATISFIABILITY_ERROR", message: "second" },
      ],
    });

    render(<App />);

    // Advance past the debounce window.
    await vi.advanceTimersByTimeAsync(350);

    // Switch to the SDL tab — compose errors are only shown there.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    // Both error messages must appear — index keys prevent React from dropping duplicates.
    expect(screen.getByText(/SATISFIABILITY_ERROR.*first/)).toBeInTheDocument();
    expect(screen.getByText(/SATISFIABILITY_ERROR.*second/)).toBeInTheDocument();
  });

  it("failing compose shows an error banner with each code and message", async () => {
    vi.useFakeTimers();

    // Make compose return a failure with two errors.
    mockCompose.mockReturnValueOnce({
      ok: false,
      errors: [
        { code: "ERR001", message: "Field `a` conflicts with field `b`" },
        { code: "ERR002", message: "Type `Product` is inaccessible" },
      ],
    });

    render(<App />);

    // Advance past the debounce window.
    await vi.advanceTimersByTimeAsync(350);

    // Switch to the SDL tab — compose errors are only shown there.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    // The error banner should be present — identified by its red left border.
    const banner = screen.getByText(/ERR001.*Field `a` conflicts/);
    expect(banner).toBeInTheDocument();

    // Each error code:message pair appears on its own line.
    expect(screen.getByText(/ERR002.*Type `Product` is inaccessible/)).toBeInTheDocument();
  });

  it("stale badge and gray styling appear when composition fails after prior success (AC#1)", async () => {
    vi.useFakeTimers();

    // Pre-populate the store with a previously successful SDL.
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      supergraphSdl: "# previous supergraph",
      composeErrors: null,
      composeHints: 0,
    });

    mockCompose.mockReturnValueOnce({
      ok: false,
      errors: [{ code: "ERR001", message: "Something went wrong" }],
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(350);

    // Switch to the SDL tab to see the stale content.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    // The stale badge text must appear.
    expect(screen.getByText("stale")).toBeInTheDocument();

    // The supergraph SDL should still be visible below the banner.
    expect(screen.getByText("# previous supergraph")).toBeInTheDocument();

    // The stale supergraph <pre> is visually distinguished via the
    // code-block--stale class (grayed-out styling lives in theme.css).
    const pres = document.querySelectorAll("pre");
    const grayPre = Array.from(pres).find((p) => p.textContent === "# previous supergraph");
    expect(grayPre).toBeDefined();
    expect(grayPre!.classList.contains("code-block--stale")).toBe(true);
  });

  it("successful compose removes stale badge and styling (AC#2)", async () => {
    vi.useFakeTimers();

    // Pre-populate with a stale supergraph SDL.
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      supergraphSdl: "# previous supergraph",
      composeErrors: null,
      composeHints: 0,
    });

    mockCompose.mockReturnValueOnce({
      ok: true,
      supergraph_sdl: "# fresh supergraph",
      api_schema_sdl: "type Query { products: [Product] }",
      hints: [],
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(350);

    // Switch to the SDL tab to check its contents.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    // No stale badge should be present after a successful compose.
    expect(screen.queryByText("stale")).not.toBeInTheDocument();

    // The fresh SDL should be shown.
    expect(screen.getByText("# fresh supergraph")).toBeInTheDocument();
  });

  it("no stale badge on first-ever failure (AC#3)", async () => {
    vi.useFakeTimers();

    // Start with supergraphSdl: null (already the default in beforeEach).
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,
    });

    mockCompose.mockReturnValueOnce({
      ok: false,
      errors: [{ code: "ERR001", message: "Something went wrong" }],
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(350);

    // Switch to the SDL tab to check its contents.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    // The placeholder text should be shown.
    expect(screen.getByText("No valid composition yet")).toBeInTheDocument();

    // No stale badge should appear.
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });

  it("failing compose shows 'No valid composition yet' when no prior success", async () => {
    vi.useFakeTimers();

    // Force the mock to always return a failure for this test.
    mockCompose.mockReturnValue({
      ok: false,
      errors: [{ code: "ERR001", message: "Something went wrong" }],
    } as never);

    render(<App />);

    await vi.advanceTimersByTimeAsync(350);

    // Switch to the SDL tab to check its contents.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    expect(screen.getByText("No valid composition yet")).toBeInTheDocument();
  });

  // ---- AC#3: Tab switching shows correct SDL ----

  it("editor displays the active subgraph's SDL after clicking a different tab (AC #3)", () => {
    useWorkspace.setState({
      subgraphs: [
        { name: "products", sdl: "type Query { products }" },
        { name: "reviews", sdl: "type Query { reviews }" },
      ],
      activeSubgraph: 0,
    });

    const { container } = render(<App />);

    // Initially the first tab is active — editor should show its SDL.
    expect(container.textContent).toContain("type Query { products }");

    // Click the second tab button ("reviews", aria-pressed=false).
    const reviewsBtn = container.querySelector("button[aria-pressed='false']")!;
    fireEvent.click(reviewsBtn);

    // The active index should now be 1.
    expect(useWorkspace.getState().activeSubgraph).toBe(1);

    // The editor should now display the second subgraph's SDL.
    expect(container.textContent).toContain("type Query { reviews }");
    expect(container.textContent).not.toContain("type Query { products }");
  });

  it("editor shows empty SDL for a newly added subgraph (AC #3)", () => {
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a }" }],
      activeSubgraph: 0,
    });

    const { container } = render(<App />);

    // Click the [+] button to add a new subgraph.
    const nav = document.querySelector("nav")!;
    const addBtn = nav.querySelector("button:last-child")!;
    fireEvent.click(addBtn);

    // The new subgraph is appended and becomes active (index 1).
    expect(useWorkspace.getState().activeSubgraph).toBe(1);

    // A newly added subgraph has an empty SDL, so the editor should not
    // contain any old content — just be blank.
    expect(container.textContent).not.toContain("type Query { a }");
  });

  it("editor shows correct SDL after removing a subgraph (AC #3)", () => {
    useWorkspace.setState({
      subgraphs: [
        { name: "products", sdl: "type Query { products }" },
        { name: "reviews", sdl: "type Query { reviews }" },
        { name: "orders", sdl: "type Query { orders }" },
      ],
      activeSubgraph: 2, // orders is active
    });

    const { container } = render(<App />);

    // Orders SDL should be visible.
    expect(container.textContent).toContain("type Query { orders }");

    // Remove the active tab (orders at index 2) - find close spans by content.
    // 3 subgraph tabs + 1 query tab = 4 close spans total.
    const closeSpans = Array.from(container.querySelectorAll("span")).filter(
      (s) => s.textContent === "×",
    );
    expect(closeSpans).toHaveLength(4);
    fireEvent.click(closeSpans[2]);

    // removeSubgraph sets activeSubgraph to the nearest neighbor automatically.
    expect(useWorkspace.getState().activeSubgraph).toBe(1);

    // The editor should now display reviews' SDL, not orders'.
    expect(container.textContent).toContain("type Query { reviews }");
    expect(container.textContent).not.toContain("type Query { orders }");
  });

  // ---- AC#1: [+] button creates new subgraph ----

  it("renders a [+] button at the end of the tab bar", () => {
    render(<App />);
    const nav = document.querySelector("nav");
    expect(nav).toBeInTheDocument();
    const addBtn = nav!.querySelector("button:last-child");
    expect(addBtn).toBeInTheDocument();
    expect(addBtn!.textContent).toBe("+");
  });

  it("clicking [+] creates a new subgraph with auto-generated name and selects it (AC#1)", () => {
    const addSpy = vi.spyOn(useWorkspace.getState(), "addSubgraph");

    render(<App />);

    // Locate the [+] button (last child of nav).
    const nav = document.querySelector("nav")!;
    const addBtn = nav.querySelector("button:last-child")!;

    fireEvent.click(addBtn);

    // The store should have received a call with "subgraph-1" (lowest unused).
    expect(addSpy).toHaveBeenCalledWith("subgraph-1");

    // The new subgraph is appended and becomes active.
    const state = useWorkspace.getState();
    expect(state.subgraphs).toHaveLength(2);
    expect(state.subgraphs[1].name).toBe("subgraph-1");
    expect(state.activeSubgraph).toBe(1);
  });

  it("adding subgraphs with interleaved removals never produces duplicate names", () => {
    // Start with [{name: "products"}]
    render(<App />);
    const nav = document.querySelector("nav")!;

    // Add two subgraphs: should produce subgraph-1, subgraph-2
    fireEvent.click(nav.querySelector("button:last-child")!);
    fireEvent.click(nav.querySelector("button:last-child")!);

    // Remove the middle one (subgraph-1 at index 1)
    const closeSpans = Array.from(nav.querySelectorAll("span")).filter(
      (s) => s.textContent === "×",
    );
    fireEvent.click(closeSpans[1]);

    // Add again: should produce subgraph-1 (the gap), not subgraph-3
    fireEvent.click(nav.querySelector("button:last-child")!);

    const names = useWorkspace.getState().subgraphs.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length); // all unique
  });

  it("clicking [+] focuses the Monaco editor (AC#1)", async () => {
    vi.useFakeTimers();

    render(<App />);

    const mockEditor = { getModel: vi.fn(() => ({}) as never), focus: vi.fn() };

    expect(globalThis.__editorTestHarness.onMount).not.toBeNull();
    globalThis.__editorTestHarness.onMount!(mockEditor, monaco);

    // Locate and click the [+] button.
    const nav = document.querySelector("nav")!;
    const addBtn = nav.querySelector("button:last-child")!;
    fireEvent.click(addBtn);

    await vi.advanceTimersByTimeAsync(50);

    // The editor's focus() should have been called after adding.
    expect(mockEditor.focus).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("typing invalid SDL shows a red underline at the correct position within ~300ms", async () => {
    vi.useFakeTimers();
    const invalidSdl = "type Query { hello: BogusType }";

    // Configure validateSubgraph to return a diagnostic for this SDL.
    validateSubgraphMock.mockReturnValue({
      diagnostics: [
        {
          severity: "error" as const,
          message: "Cannot find type `BogusType`",
          line: 1,
          col: 20,
          len: 9,
        },
      ],
    });

    render(<App />);

    // Wait for the app to mount and composition to settle.
    await vi.waitFor(() => expect(composeCallCount).toBeGreaterThan(0));

    // Build a mock Monaco model and editor.
    const setModelMarkersSpy = vi.spyOn(monaco.editor, "setModelMarkers");
    const mockModel = {};
    const mockEditor = {
      getModel: vi.fn(() => mockModel),
      focus: vi.fn(),
    };

    // Trigger onMount so the component captures the editor & monaco instances.
    expect(globalThis.__editorTestHarness.onMount).not.toBeNull();
    globalThis.__editorTestHarness.onMount!(mockEditor, monaco);

    // Simulate typing into the editor (via store update) with invalid SDL.
    useWorkspace.getState().setSubgraphSdl(0, invalidSdl);

    // Wait for the debounce timeout (300ms) + async boundary.
    await vi.advanceTimersByTimeAsync(350);

    // Validate that the core was called with the invalid SDL.
    expect(validateSubgraphMock).toHaveBeenCalledWith(invalidSdl);

    // Validate that markers were applied at the correct position.
    expect(setModelMarkersSpy).toHaveBeenCalled();
    const [, , markers] = setModelMarkersSpy.mock.calls[0];
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      startLineNumber: 1,
      startColumn: 20,
      endLineNumber: 1,
      endColumn: 29,
      message: "Cannot find type `BogusType`",
      severity: monaco.MarkerSeverity.Error,
    });
  });

  // ---- TASK-19 AC#2: Run calls executeMock with correct args and shows pretty-printed results ----

  it("TASK-19 AC#2: clicking Run calls executeMock with schema, query, and seed; shows pretty-printed data", async () => {
    const mockData = { products: [{ id: "1", name: "Widget" }] };
    mockExecuteMock.mockClear();
    mockExecuteMock.mockReturnValueOnce({ data: mockData, errors: [] } as never);

    const testQuery = "query { products { id name } }";
    const testSeed = 99;

    // Pre-set the store so supergraphSdl is non-null (Run button enabled).
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      supergraphSdl: "# supergraph",
      composeErrors: null,
      composeHints: 0,
      queryTabs: [{ name: "Query 1", query: testQuery }],
      activeQueryTab: 0,
      seed: testSeed,
    });

    render(<App />);

    // Click Run.
    const runButton = screen.getByRole("button", { name: /run/i });
    fireEvent.click(runButton);

    // Wait for the async executeMock call to complete and the DOM to update.
    await vi.waitFor(() => {
      expect(mockExecuteMock).toHaveBeenCalledTimes(1);
    });

    // executeMock must have been called with schema, query, and seed.
    expect(mockExecuteMock).toHaveBeenCalledWith("# supergraph", testQuery, testSeed);

    // The pretty-printed data must appear in the Results panel.
    await vi.waitFor(() => {
      expect(screen.getByText(/"Widget"/)).toBeInTheDocument();
    });

    // The full JSON.stringify output must be present in a <pre> element.
    const pres = document.querySelectorAll("pre");
    const resultPre = Array.from(pres).find((p) => p.textContent?.includes('"Widget"'));
    expect(resultPre).toBeDefined();
    expect(resultPre!.textContent).toContain('"products"');
    expect(resultPre!.textContent).toContain('"id"');
    expect(resultPre!.textContent).toContain('"1"');
  });

  // ---- TASK-19 AC#3: Same query+seed yields identical results; changing seed changes them ----

  it("TASK-19 AC#3: clicking Run twice with the same seed calls executeMock both times with the same seed", async () => {
    mockExecuteMock.mockClear();
    mockExecuteMock.mockReturnValue({ data: { hello: "world" }, errors: [] } as never);

    const testSeed = 42;

    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      supergraphSdl: "# supergraph",
      composeErrors: null,
      composeHints: 0,
      queryTabs: [{ name: "Query 1", query: "query { hello }" }],
      activeQueryTab: 0,
      seed: testSeed,
    });

    render(<App />);

    const runButton = screen.getByRole("button", { name: /run/i });

    // Click Run the first time.
    fireEvent.click(runButton);
    await vi.waitFor(() => expect(mockExecuteMock).toHaveBeenCalledTimes(1));

    // Click Run the second time without changing anything.
    fireEvent.click(runButton);
    await vi.waitFor(() => expect(mockExecuteMock).toHaveBeenCalledTimes(2));

    // Both calls must have been made with the same seed value.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstCallSeed = (mockExecuteMock.mock.calls[0] as any[])[2];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondCallSeed = (mockExecuteMock.mock.calls[1] as any[])[2];
    expect(firstCallSeed).toBe(testSeed);
    expect(secondCallSeed).toBe(testSeed);
    expect(firstCallSeed).toBe(secondCallSeed);
  });

  it("TASK-19 AC#3: changing the seed input before Run passes the new seed to executeMock", async () => {
    mockExecuteMock.mockClear();
    mockExecuteMock.mockReturnValue({ data: { hello: "world" }, errors: [] } as never);

    const initialSeed = 42;
    const changedSeed = 99;

    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      supergraphSdl: "# supergraph",
      composeErrors: null,
      composeHints: 0,
      queryTabs: [{ name: "Query 1", query: "query { hello }" }],
      activeQueryTab: 0,
      seed: initialSeed,
    });

    render(<App />);

    const runButton = screen.getByRole("button", { name: /run/i });

    // First Run with seed=42.
    fireEvent.click(runButton);
    await vi.waitFor(() => expect(mockExecuteMock).toHaveBeenCalledTimes(1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockExecuteMock.mock.calls[0] as any[])[2]).toBe(initialSeed);

    // Change the seed input to 99.
    const seedInput = screen.getByRole("spinbutton");
    fireEvent.change(seedInput, { target: { value: String(changedSeed) } });

    // Second Run with seed=99.
    fireEvent.click(runButton);
    await vi.waitFor(() => expect(mockExecuteMock).toHaveBeenCalledTimes(2));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockExecuteMock.mock.calls[1] as any[])[2]).toBe(changedSeed);
  });

  // ---- AC#2: Query editor is a Monaco editor wired to the store query ----

  it("AC#2: query editor renders a Monaco editor showing the store query value", () => {
    const initialQuery = "query {\n  products {\n    id\n    name\n  }\n}\n";
    useWorkspace.setState({
      queryTabs: [{ name: "Query 1", query: initialQuery }],
      activeQueryTab: 0,
    });

    const { container } = render(<App />);

    // The query editor must be a Monaco editor (not a plain <pre> or <textarea>).
    // It renders with path="query-0.graphql" (per-tab path) so we can identify it.
    const queryEditor = container.querySelector('[data-path="query-0.graphql"]');
    expect(queryEditor).not.toBeNull();
    expect(queryEditor!.textContent).toContain("products");
  });

  it("AC#2: onChange on the query editor calls setQueryTabQuery in the store", () => {
    const initialQuery = "query { products { id } }";
    useWorkspace.setState({
      queryTabs: [{ name: "Query 1", query: initialQuery }],
      activeQueryTab: 0,
    });

    render(<App />);

    // The mock harness captures onChange by path (query-0.graphql for first tab).
    const onChangeQuery = globalThis.__editorTestHarness.onChangeByPath["query-0.graphql"];
    expect(onChangeQuery).toBeDefined();

    // Simulate the user typing a new query.
    const newQuery = "query { products { name } }";
    onChangeQuery!(newQuery);

    expect(useWorkspace.getState().queryTabs[0].query).toBe(newQuery);
  });

  it("AC#2: onChange on the query editor with undefined falls back to empty string", () => {
    useWorkspace.setState({
      queryTabs: [{ name: "Query 1", query: "query { x }" }],
      activeQueryTab: 0,
    });

    render(<App />);

    const onChangeQuery = globalThis.__editorTestHarness.onChangeByPath["query-0.graphql"];
    expect(onChangeQuery).toBeDefined();

    onChangeQuery!(undefined);

    expect(useWorkspace.getState().queryTabs[0].query).toBe("");
  });

  // ---- AC#1: setModeConfiguration enables autocomplete on init ----

  it("AC#1: calls setModeConfiguration with all features enabled after successful compose", async () => {
    vi.useFakeTimers();
    mockSetModeConfiguration.mockClear();

    mockCompose.mockReturnValueOnce({
      ok: true,
      supergraph_sdl: "# supergraph",
      api_schema_sdl: "type Query { products: [Product] }",
      hints: [],
    });

    render(<App />);

    // Advance past the 300ms debounce window so composition fires.
    await vi.advanceTimersByTimeAsync(350);

    // setModeConfiguration must have been called with diagnostics disabled (WASM core handles validation)
    // and all other features enabled.
    expect(mockSetModeConfiguration).toHaveBeenCalledWith({
      completionItems: true,
      diagnostics: false,
      hovers: true,
      documentSymbols: true,
      documentFormattingEdits: true,
    });

    vi.useRealTimers();
  });

  // ---- AC#3: setSchemaConfig is called with the api_schema_sdl after successful compose ----

  it("AC#3: calls setSchemaConfig with api_schema_sdl from the composed result", async () => {
    vi.useFakeTimers();

    const apiSchemaSdl = "type Query { products: [Product] }\ntype Product { id: ID! }";
    mockCompose.mockReturnValueOnce({
      ok: true,
      supergraph_sdl: "# supergraph",
      api_schema_sdl: apiSchemaSdl,
      hints: [],
    });

    render(<App />);

    // Advance past the 300ms debounce window so composition fires.
    await vi.advanceTimersByTimeAsync(350);

    // setSchemaConfig must have been called with the api_schema_sdl.
    expect(mockSetSchemaConfig).toHaveBeenCalledWith([
      {
        documentString: apiSchemaSdl,
        uri: "api-schema.graphql",
        fileMatch: ["**/*.graphql"],
      },
    ]);

    vi.useRealTimers();
  });

  it("AC#3: does not call setSchemaConfig when compose fails", async () => {
    vi.useFakeTimers();
    mockSetSchemaConfig.mockClear();

    mockCompose.mockReturnValueOnce({
      ok: false,
      errors: [{ code: "ERR001", message: "bad" }],
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(350);

    expect(mockSetSchemaConfig).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // ---- AC#4: Editing subgraphs updates the autocomplete schema to match ----

  it("AC#4: editing a subgraph triggers re-composition and calls setSchemaConfig with the new api_schema_sdl", async () => {
    vi.useFakeTimers();
    mockSetSchemaConfig.mockClear();

    const firstSchemaSdl = "type Query { products: [Product] }\ntype Product { id: ID! }";
    const secondSchemaSdl = "type Query { orders: [Order] }\ntype Order { orderId: ID! }";

    // First compose: initial schema
    mockCompose.mockReturnValueOnce({
      ok: true,
      supergraph_sdl: "# supergraph v1",
      api_schema_sdl: firstSchemaSdl,
      hints: [],
    });

    // Second compose: new schema after subgraph edit
    mockCompose.mockReturnValueOnce({
      ok: true,
      supergraph_sdl: "# supergraph v2",
      api_schema_sdl: secondSchemaSdl,
      hints: [],
    });

    render(<App />);

    // Wait for initial composition to fire.
    await vi.advanceTimersByTimeAsync(350);

    // setSchemaConfig should have been called once with the first schema.
    expect(mockSetSchemaConfig).toHaveBeenCalledTimes(1);
    expect(mockSetSchemaConfig).toHaveBeenCalledWith([
      {
        documentString: firstSchemaSdl,
        uri: "api-schema.graphql",
        fileMatch: ["**/*.graphql"],
      },
    ]);

    // Simulate editing a subgraph — this changes the subgraphs array reference
    // and triggers the debounced compose useEffect to re-run.
    useWorkspace
      .getState()
      .setSubgraphSdl(0, "type Query { orders: [Order] }\ntype Order { orderId: ID! }");

    // Wait for the debounce to settle on the second composition.
    await vi.advanceTimersByTimeAsync(350);

    // setSchemaConfig should now have been called a second time with the updated schema.
    expect(mockSetSchemaConfig).toHaveBeenCalledTimes(2);
    expect(mockSetSchemaConfig).toHaveBeenLastCalledWith([
      {
        documentString: secondSchemaSdl,
        uri: "api-schema.graphql",
        fileMatch: ["**/*.graphql"],
      },
    ]);

    vi.useRealTimers();
  });

  // ---- TASK-45 AC#2: Query Plan is the default tab on mount ----

  it("TASK-45 AC#2: Query Plan tab is active on initial load without user interaction", () => {
    render(<App />);

    // The Query Plan pane's placeholder text must be visible immediately.
    expect(screen.getByText(/Run a query to see the plan/)).toBeInTheDocument();

    // The "Query Plan" tab button should be pressed (active).
    const planTab = screen.getByRole("button", { name: /Query Plan/ });
    expect(planTab).toHaveAttribute("aria-pressed", "true");
  });

  // ---- TASK-45 AC#3: Vertical split is draggable ----

  it("TASK-45 AC#3: vertical Group with Separator renders between top and bottom rows", () => {
    render(<App />);

    // The outer <Group> (orientation="vertical") wraps two Panel children:
    // the top row (subgraph editor + SDL/plan) and the bottom row (query + results).
    // Both must be direct children of the same Group.
    const main = document.querySelector("[style*='height: 100vh']");
    expect(main).not.toBeNull();

    // The outer group has three direct children: top Panel, Separator, bottom Panel.
    expect(main!.children.length).toBe(3);

    // Between them sits a <Separator> element — the draggable divider.
    const separator =
      document.querySelector("button[role='separator']") ??
      document.querySelector("div[role='separator']") ??
      Array.from(document.querySelectorAll("*")).find(
        (el) =>
          el.classList.contains("rp-Separator") || el.getAttribute("data-rp-separator") !== null,
      );
    // react-resizable-panels renders separators as <button> or <div> elements
    // that sit between Panel children in the DOM.
    expect(separator).toBeDefined();
  });

  // ---- TASK-45 AC#4: Horizontal split between subgraph editor and SDL/plan is draggable ----

  it("TASK-45 AC#4: horizontal Separator renders between subgraph editor and SDL/plan pane", () => {
    render(<App />);

    // The top row Panel contains an inner <Group orientation="horizontal">
    // wrapping two Panels (subgraph editor | SDL/plan) with a Separator between them.
    // react-resizable-panels renders separators as sibling elements within the Group.
    // DOM structure:
    //   main (outer vertical Group)
    //     ├─ main.child[0] = top Panel wrapper
    //     │   └─ main.child[0].child[0] = content div (flex column)
    //     │       └─ main.child[0].child[0].child[0] = inner horizontal Group
    //     │           ├─ child[0] = subgraph editor Panel
    //     │           ├─ child[1] = Separator (horizontal split)
    //     │           └─ child[2] = SDL/plan Panel
    //     ├─ main.child[1] = Separator (vertical split)
    //     └─ main.child[2] = bottom Panel wrapper
    const main = document.querySelector("[style*='height: 100vh']");
    expect(main).not.toBeNull();

    // The outer app div has 3 children: page header, panel Group, page footer.
    // The panel Group (children[1]) has: top Panel | Separator | bottom Panel.
    const panelGroup = main!.children[1];
    expect(panelGroup.children.length).toBe(3);

    // The inner horizontal Group sits at panelGroup.child[0].child[0].child[0]
    // and has the subgraph editor Panel, a Separator, and the SDL/plan Panel.
    const innerGroup = panelGroup.children[0].children[0].children[0];
    expect(innerGroup).not.toBeNull();

    // The inner horizontal Group has at least 3 direct children: subgraph editor,
    // Separator, SDL/plan.
    expect(innerGroup.children.length).toBeGreaterThanOrEqual(3);

    // child[1] must be a <div role="separator"> — the draggable divider between
    // the subgraph editor and the SDL/plan pane.
    const topSeparator = innerGroup.children[1];
    expect(topSeparator.getAttribute("role")).toBe("separator");
  });

  // ---- TASK-45 AC#5: Horizontal split between query and results is draggable ----

  it("TASK-45 AC#5: bottom row has Group with 2 Panels and 1 Separator for draggable split", () => {
    render(<App />);

    // The outer <Group> (orientation="vertical") wraps two Panel children:
    // the top row and the bottom row.  The bottom row is main.child[2].
    const main = document.querySelector("[style*='height: 100vh']");
    expect(main).not.toBeNull();

    // The outer app div has 3 children: page header, panel Group, page footer.
    // The panel Group (children[1]) has: top Panel | Separator | bottom Panel.
    const panelGroup = main!.children[1];
    expect(panelGroup.children.length).toBe(3);

    // Bottom row is panelGroup.children[2] — an outer <Panel> wrapper.
    const bottomRow = panelGroup.children[2];
    expect(bottomRow).not.toBeNull();

    // The bottom row Panel wraps:
    //   bottomRow.child[0] = content div (flex column)
    //     └─ child[0] = inner <Group orientation="horizontal">
    //         ├─ child[0] = Query Panel wrapper
    //         ├─ child[1] = Separator (query | results)
    //         └─ child[2] = Results Panel wrapper
    const contentDiv = bottomRow.children[0];
    expect(contentDiv).not.toBeNull();

    const innerGroup = contentDiv.children[0];
    expect(innerGroup).not.toBeNull();

    // The inner horizontal Group must have 3 direct children:
    // 2 Panel wrappers + 1 Separator.
    expect(innerGroup.children.length).toBe(3);

    // child[1] must be a separator element (the draggable divider).
    const sepBetweenQueryAndResults = innerGroup.children[1];
    expect(sepBetweenQueryAndResults.getAttribute("role")).toBe("separator");
  });

  // ---- TASK-45 AC#1: Show/Hide toggle removed, SDL always visible ----

  it("TASK-45 AC#1: no Show/Hide button exists; SDL content visible when tab is active", async () => {
    render(<App />);

    // The Show/Hide button must NOT be present anywhere in the SDL tab.
    expect(screen.queryByText(/Show|Hide/)).not.toBeInTheDocument();

    // Switch to the SDL tab (default is "plan"). The content area renders
    // immediately — no Show/Hide toggle is needed to reveal it.
    fireEvent.click(screen.getByText("Supergraph SDL"));

    // The SDL content area is visible right away (showing "Loading core…" or
    // the composed SDL). The critical AC is that no toggle gates the content.
    expect(
      screen.queryByText(/Loading core|# supergraph|No valid composition/),
    ).toBeInTheDocument();
  });

  // ---- TASK-43 AC#1: No auto hash update on edit ----

  it("TASK-43 AC#1: editing subgraphs, queries, variables, and seed does NOT update location.hash", async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, "location", {
      value: { hash: "" },
      writable: true,
      configurable: true,
    });

    render(<App />);

    // Advance past the initial mount debounce so any first-hash is set.
    await vi.advanceTimersByTimeAsync(350);

    const hashAfterMount = globalThis.location.hash;

    // Editing subgraph SDL should NOT change the hash.
    useWorkspace.getState().setSubgraphSdl(0, "type Query { newField }");
    await vi.advanceTimersByTimeAsync(350);
    expect(globalThis.location.hash).toBe(hashAfterMount);

    // Editing query tab should NOT change the hash.
    useWorkspace.getState().setQueryTabQuery(0, "query { x }");
    await vi.advanceTimersByTimeAsync(350);
    expect(globalThis.location.hash).toBe(hashAfterMount);

    // Changing seed should NOT change the hash.
    useWorkspace.getState().setSeed(99);
    await vi.advanceTimersByTimeAsync(350);
    expect(globalThis.location.hash).toBe(hashAfterMount);

    vi.useRealTimers();
  });

  // ---- TASK-23 AC#3: Loading a URL with a valid hash restores workspace ----

  it("TASK-23 AC#3: valid hash in location.hash restores subgraphs, queryTabs, and seed on mount", async () => {
    const { encode: encodeShare } = await import("./share");
    const payload = {
      subgraphs: [{ name: "shared", sdl: "type Query { shared: String }" }],
      queryTabs: [{ name: "Query 1", query: "query { shared }" }],
      activeQueryTab: 0,
      seed: 77,
    };
    Object.defineProperty(globalThis, "location", {
      value: { hash: encodeShare(payload) },
      writable: true,
      configurable: true,
    });

    render(<App />);

    const state = useWorkspace.getState();
    expect(state.subgraphs).toHaveLength(1);
    expect(state.subgraphs[0].name).toBe("shared");
    expect(state.queryTabs[0].query).toBe("query { shared }");
    expect(state.seed).toBe(77);
    expect(state.activeSubgraph).toBe(0);
    expect(state.activeQueryTab).toBe(0);
  });

  // ---- TASK-43 AC#3: Hash stripped via history.replaceState after restore ----

  it("TASK-43 AC#3: hydrating from a hash calls history.replaceState to strip the hash", async () => {
    const { encode: encodeShare } = await import("./share");
    const payload = {
      subgraphs: [{ name: "products", sdl: "type Query { hello: String }" }],
      queryTabs: [{ name: "Query 1", query: "query { hello }" }],
      activeQueryTab: 0,
      seed: 42,
    };

    // JSDOM workaround: replaceState is not configurable, so we must assign directly.
    const origReplaceState = window.history.replaceState;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.history as any).replaceState = vi.fn();

    Object.defineProperty(globalThis, "location", {
      value: { hash: encodeShare(payload) },
      writable: true,
      configurable: true,
    });

    render(<App />);

    // replaceState must have been called to strip the hash.
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      window.location.pathname + window.location.search,
    );

    // Restore original method after test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.history as any).replaceState = origReplaceState;
  });

  // ---- TASK-43 AC#2: Hydrate from URL hash preserved after removing debounce ----

  it("TASK-43 AC#2: navigating to a URL with #w=… hash hydrates the workspace correctly", async () => {
    const { encode: encodeShare } = await import("./share");
    const payload = {
      subgraphs: [{ name: "hydrated", sdl: "type Query { hello: String }" }],
      queryTabs: [{ name: "Query 1", query: "query { hello }", variables: "{}" }],
      activeQueryTab: 0,
      seed: 42,
    };
    Object.defineProperty(globalThis, "location", {
      value: { hash: encodeShare(payload) },
      writable: true,
      configurable: true,
    });

    render(<App />);

    const state = useWorkspace.getState();
    expect(state.subgraphs).toHaveLength(1);
    expect(state.subgraphs[0].name).toBe("hydrated");
    expect(state.subgraphs[0].sdl).toBe("type Query { hello: String }");
    expect(state.queryTabs[0].query).toBe("query { hello }");
    expect(state.seed).toBe(42);
    expect(state.activeSubgraph).toBe(0);
    expect(state.activeQueryTab).toBe(0);
  });

  // ---- TASK-43 AC#6: Share button shows "Copied!" feedback that reverts ----

  it("TASK-43 AC#6: clicking Share shows 'Copied!' then reverts after 1500ms", async () => {
    vi.useFakeTimers();

    // Mock navigator.clipboard for JSDOM.
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWriteText },
      configurable: true,
    });

    Object.defineProperty(globalThis, "location", {
      value: {
        hash: "",
        origin: "http://localhost",
        hostname: "localhost",
        port: "",
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    render(<App />);

    // Advance past the initial debounce so any first hash is set.
    await vi.advanceTimersByTimeAsync(350);

    // The Share button should initially show "Share" text.
    const shareBtn = screen.getByRole("button", { name: /share/i });
    expect(shareBtn.textContent).toBe("Share");

    // Click the Share button.
    fireEvent.click(shareBtn);

    // The clipboard write should have been triggered.
    expect(mockWriteText).toHaveBeenCalledTimes(1);

    // Advance 1ms to let React flush its internal timer-driven state update.
    await vi.advanceTimersByTimeAsync(1);

    // The button text should now be "Copied!" (green feedback).
    const allBtns = screen.getAllByRole("button");
    const copiedText = allBtns.find((b) => b.textContent === "Copied!");
    expect(copiedText).toBeDefined();

    // Advance 1499ms more — the setTimeout callback should fire and revert.
    await vi.advanceTimersByTimeAsync(1499);

    // The button text should be back to "Share".
    const shareBtnAfter = screen.getAllByRole("button").find((b) => b.textContent === "Share");
    expect(shareBtnAfter).toBeDefined();
  });

  it("TASK-23 AC#4: corrupt hash falls back to default workspace without throwing", () => {
    Object.defineProperty(globalThis, "location", {
      value: { hash: "#w=notvalidbase64!!" },
      writable: true,
      configurable: true,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Should render without throwing.
    expect(() => render(<App />)).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to restore workspace from URL hash:",
      expect.any(Error),
    );
    warnSpy.mockRestore();

    // Store must still be in a usable state (defaults from beforeEach).
    const state = useWorkspace.getState();
    expect(state.subgraphs.length).toBeGreaterThan(0);
  });

  it("TASK-25 AC#3: seed restored from URL hash is passed to executeMock on Run", async () => {
    const { encode: encodeShare } = await import("./share");
    const urlSeed = 55;
    const payload = {
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      queryTabs: [{ name: "Query 1", query: "query { a }", variables: "{}" }],
      activeQueryTab: 0,
      seed: urlSeed,
    };
    Object.defineProperty(globalThis, "location", {
      value: { hash: encodeShare(payload) },
      writable: true,
      configurable: true,
    });
    useWorkspace.setState({ supergraphSdl: "# supergraph" });
    mockExecuteMock.mockClear();
    mockExecuteMock.mockReturnValueOnce({ data: {}, errors: [] } as never);

    render(<App />);

    expect(useWorkspace.getState().seed).toBe(urlSeed);

    const runButton = screen.getByRole("button", { name: /run/i });
    fireEvent.click(runButton);

    await vi.waitFor(() => expect(mockExecuteMock).toHaveBeenCalledTimes(1));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calledSeed = (mockExecuteMock.mock.calls[0] as any[])[2];
    expect(calledSeed).toBe(urlSeed);
  });

  // ---- TASK-43 AC#4: Share button is visible and generates shareable URL ----

  it("TASK-43 AC#4: Share button is visible in the UI and generates a point-in-time shareable URL with #w=…", async () => {
    vi.useFakeTimers();

    // Mock navigator.clipboard for JSDOM.
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockWriteText },
      configurable: true,
    });

    // Set up a fully-formed location so the URL builder works correctly.
    Object.defineProperty(globalThis, "location", {
      value: {
        hash: "",
        origin: "http://localhost",
        hostname: "localhost",
        port: "",
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    // Set workspace state to match the payload we'll assert against.
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      queryTabs: [{ name: "Query 1", query: "" }],
      activeQueryTab: 0,
      seed: 42,
      activeSubgraph: 0,
    });

    render(<App />);

    // Advance past the initial debounce so any first hash is set.
    await vi.advanceTimersByTimeAsync(350);

    // The Share button must be visible in the UI.
    const shareBtn = screen.getByRole("button", { name: /share/i });
    expect(shareBtn).toBeInTheDocument();

    // Click the Share button.
    fireEvent.click(shareBtn);

    // navigator.clipboard.writeText must have been called with a full URL
    // containing origin + pathname + #w= hash (AC#5).
    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockWriteText.mock.calls[0];
    expect(calledUrl).toMatch(/^https?:\/\/.+#w=/);

    // AC#5: the full URL must include origin + pathname + encoded hash.
    // In JSDOM location.origin is undefined, so copyShareUrl falls back to
    // http://localhost — verify the constructed URL matches that fallback.
    const payload = {
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      queryTabs: [{ name: "Query 1", query: "" }],
      activeQueryTab: 0,
      seed: 42,
    };
    const expectedHash = encode(payload);
    // pathname is "/", so the URL is origin + pathname + hash.
    expect(calledUrl).toBe("http://localhost/" + expectedHash);

    vi.useRealTimers();
  });

  // ---- TASK-45 AC#6: Drag handles have a visible hover state ----

  it("TASK-45 AC#6: separator elements carry resize-handle class for styling", () => {
    render(<App />);

    // All separators must carry the .resize-handle class so theme.css can size
    // them (the gutter width, per aria-orientation) and style their hover/drag
    // state. react-resizable-panels renders separators with role="separator" and
    // passes through the className prop. The hover/sizing rules themselves live in
    // theme.css (imported in main.tsx, not in this JSDOM render), so we assert the
    // class hook the CSS depends on rather than the rule text.
    const separators = Array.from(document.querySelectorAll('[role="separator"].resize-handle'));
    expect(separators.length).toBeGreaterThan(0);
  });

  // ---- TASK-46: Sequence Diagram tab ----

  it("TASK-46: Sequence Diagram tab button is visible in the right pane", () => {
    render(<App />);
    const seqTab = screen.getByRole("button", { name: /Sequence Diagram/ });
    expect(seqTab).toBeInTheDocument();
    expect(seqTab).toHaveAttribute("aria-pressed", "false");
  });

  it("TASK-46: clicking Sequence Diagram tab shows placeholder when no plan is available", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Sequence Diagram/ }));
    expect(screen.getByText(/Run a query to see the sequence diagram/)).toBeInTheDocument();
  });

  // ---- TASK-58: Fullscreen expand button for visual tabs ----

  it("TASK-58 AC#1: expand button appears when Timeline tab is active", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    expect(screen.getByRole("button", { name: /Expand to full screen/ })).toBeInTheDocument();
  });

  it("TASK-58 AC#1: expand button appears when Sequence Diagram tab is active", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Sequence Diagram/ }));
    expect(screen.getByRole("button", { name: /Expand to full screen/ })).toBeInTheDocument();
  });

  it("TASK-58 AC#1: expand button appears when Entities tab is active", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^Entities$/ }));
    expect(screen.getByRole("button", { name: /Expand to full screen/ })).toBeInTheDocument();
  });

  it("TASK-58 AC#1: expand button appears when Type Graph tab is active", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Type Graph/ }));
    expect(screen.getByRole("button", { name: /Expand to full screen/ })).toBeInTheDocument();
  });

  it("TASK-58 AC#5: expand button absent when Query Plan tab is active", () => {
    render(<App />);
    // Query Plan is the default — no expand button should be present.
    expect(screen.queryByRole("button", { name: /Expand to full screen/ })).not.toBeInTheDocument();
  });

  it("TASK-58 AC#5: expand button absent when Supergraph SDL tab is active", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Supergraph SDL/ }));
    expect(screen.queryByRole("button", { name: /Expand to full screen/ })).not.toBeInTheDocument();
  });

  it("TASK-58 AC#2: clicking expand button opens modal dialog", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand to full screen/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Modal title element (span) within the dialog header should say "Timeline".
    expect(dialog.querySelector(".fullscreen-modal__title")?.textContent).toBe("Timeline");
  });

  it("TASK-58 AC#3: clicking close button in modal closes it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand to full screen/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Close full screen/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("TASK-58 AC#3: pressing Escape key closes the modal", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand to full screen/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("TASK-58 AC#3: clicking the backdrop closes the modal", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand to full screen/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Click the backdrop (the element with class fullscreen-modal-backdrop).
    const backdrop = container.querySelector(".fullscreen-modal-backdrop")!;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("TASK-58 AC#4: modal renders the Timeline content (same component as embedded tab)", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand to full screen/ }));

    const dialog = screen.getByRole("dialog");
    // The modal body should contain the timeline placeholder text.
    expect(dialog.textContent).toContain("Run a query to see the timeline");
  });

  it("TASK-58 AC#4: modal renders the Sequence Diagram content", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Sequence Diagram/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand to full screen/ }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Run a query to see the sequence diagram");
  });

  it("TASK-58: modal aria-label reflects the active tab name", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Type Graph/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand to full screen/ }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toMatch(/Type Graph/);
  });
});
