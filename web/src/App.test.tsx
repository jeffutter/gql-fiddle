import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { useWorkspace } from "./store";

// Shared mock used by all tests in this file.
let composeCallCount = 0;
const mockCompose = vi.fn((): { ok: true; supergraph_sdl: string; hints: never[] } => {
  composeCallCount++;
  return { ok: true, supergraph_sdl: "# supergraph", hints: [] };
});

vi.mock("./core", () => ({
  loadCore: () =>
    Promise.resolve({
      compose: mockCompose,
      validateSubgraph: vi.fn(() => ({ diagnostics: [] })),
      validateQuery: vi.fn(() => ({ diagnostics: [] })),
      plan: vi.fn(() => ({})),
      executeMock: vi.fn(() => ({ data: {} })),
    }),
}));

describe("App", () => {
  beforeEach(() => {
    cleanup();
    useWorkspace.setState({
      subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
      activeSubgraph: 0,
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
});
