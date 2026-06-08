import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { useWorkspace } from "./store";
import * as monaco from "monaco-editor";
import type { Diagnostic } from "./core/types";

let validateSubgraphCallCount = 0;

// Shared mock used by all tests in this file.
let composeCallCount = 0;
const mockCompose = vi.fn(
  ():
    | { ok: true; supergraph_sdl: string; hints: never[] }
    | { ok: false; errors: { code: string; message: string }[] } => {
    composeCallCount++;
    return { ok: true, supergraph_sdl: "# supergraph", hints: [] };
  },
);

const validateSubgraphMock = vi.fn(() => {
  validateSubgraphCallCount++;
  return { diagnostics: [] as Diagnostic[] };
});

vi.mock("./core", () => ({
  loadCore: () =>
    Promise.resolve({
      compose: mockCompose,
      validateSubgraph: validateSubgraphMock,
      validateQuery: vi.fn(() => ({ diagnostics: [] })),
      plan: vi.fn(() => ({})),
      executeMock: vi.fn(() => ({ data: {} })),
    }),
}));

describe("App", () => {
  beforeEach(() => {
    cleanup();
    validateSubgraphCallCount = 0;
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      activeSubgraph: 0,
      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,
    });
  });

  it("renders a Monaco editor for the active subgraph instead of a textarea", () => {
    const { container } = render(<App />);

    // A plain <textarea> must NOT be present — the Monaco Editor component
    // does not render an HTML textarea element.
    const textareas = container.querySelectorAll("textarea");
    expect(textareas).toHaveLength(0);

    // The Monaco editor mounts a div with class "monaco-editor".
    const monacoEditor = screen.getByRole("textbox");
    expect(monacoEditor).toBeInTheDocument();
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

    // The Supergraph pane should show the composed SDL.
    const supergraphHeading = screen.getByText("Supergraph");
    expect(supergraphHeading).toBeInTheDocument();
    expect(screen.getByText("# supergraph")).toBeInTheDocument();

    // A status line showing error and hint count should be present.
    expect(screen.getByText(/Composition:.*errors/)).toBeInTheDocument();
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

    // The error banner should be present — identified by its red left border.
    const banner = screen.getByText(/ERR001.*Field `a` conflicts/);
    expect(banner).toBeInTheDocument();

    // Each error code:message pair appears on its own line.
    expect(screen.getByText(/ERR002.*Type `Product` is inaccessible/)).toBeInTheDocument();
  });

  it("failing compose shows stale supergraph SDL from the store", async () => {
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

    // The stale supergraph SDL should still be visible below the banner.
    expect(screen.getByText("# previous supergraph")).toBeInTheDocument();
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

    // Remove the active tab (orders at index 2) — close button is the
    // third span (products=0, reviews=1, orders=2).
    const spans = container.querySelectorAll("span");
    expect(spans[2].textContent).toBe("\u00d7");
    fireEvent.click(spans[2]);

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

    // The store should have received a call with "subgraph-2".
    expect(addSpy).toHaveBeenCalledWith("subgraph-2");

    // The new subgraph is appended and becomes active.
    const state = useWorkspace.getState();
    expect(state.subgraphs).toHaveLength(2);
    expect(state.subgraphs[1].name).toBe("subgraph-2");
    expect(state.activeSubgraph).toBe(1);
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
});
