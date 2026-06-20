import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TourPlayback } from "./TourPlayback";
import type { Tour } from "./share";

// Mock initializeMode for monaco-graphql (same pattern as App.test.tsx).
vi.mock("monaco-graphql/initializeMode", () => ({
  initializeMode: vi.fn(() => ({
    setSchemaConfig: vi.fn(),
    setModeConfiguration: vi.fn(),
    setDiagnosticSettings: vi.fn(),
  })),
}));

vi.mock("./core", () => ({
  loadCore: () =>
    Promise.resolve({
      compose: vi.fn(() => ({
        ok: true,
        supergraph_sdl: "# supergraph",
        api_schema_sdl: "type Query { products: [Product] }\ntype Product { id: ID! }",
        hints: [],
      })),
      validateSubgraph: vi.fn(() => ({ diagnostics: [] })),
      validateQuery: vi.fn(() => ({ diagnostics: [] })),
      plan: vi.fn(() => ({ ok: false, errors: [] })),
      executeMock: vi.fn(() => ({ data: {} })),
    }),
}));

// A tour fixture with two steps and two subgraphs.
const sampleTour: Tour = {
  title: "GraphQL Federation Tour",
  base: {
    subgraphs: [
      { name: "products", sdl: "type Query { products: [Product] }\ntype Product { id: ID! }" },
      { name: "reviews", sdl: "type Query { reviews: [Review] }\ntype Review { id: ID! }" },
    ],
    queryTabs: [{ name: "Query 1", query: "{ products { id } }" }],
    activeQueryTab: 0,
    seed: 42,
  },
  steps: [
    { label: "Introduction", prose: "Welcome to **GraphQL Federation**.\n\nThis is step one." },
    {
      label: "Second Step",
      prose: "Now we look at reviews.",
      overrides: {
        queryTabs: [{ name: "Query 1", query: "{ reviews { id } }" }],
        activeQueryTab: 0,
      },
    },
  ],
};

describe("TourPlayback", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("AC#10: tour title appears in the playback header", () => {
    render(<TourPlayback tour={sampleTour} />);
    expect(screen.getByTestId("tour-title").textContent).toBe("GraphQL Federation Tour");
  });

  it("AC#2: prose panel shows the active step label and prose text for step 0", () => {
    const { container } = render(<TourPlayback tour={sampleTour} />);

    // Step label.
    expect(screen.getByTestId("step-label").textContent).toBe("Introduction");

    // Prose content is rendered as HTML; check the container text includes prose text.
    const prosePanel = container.querySelector(".tour-playback__prose-content");
    expect(prosePanel).not.toBeNull();
    expect(prosePanel!.textContent).toContain("Welcome to");
    expect(prosePanel!.textContent).toContain("GraphQL Federation");
    expect(prosePanel!.textContent).toContain("This is step one.");
  });

  it("AC#2: prose renders bold markdown as <strong>", () => {
    const { container } = render(<TourPlayback tour={sampleTour} />);
    const prosePanel = container.querySelector(".tour-playback__prose-content");
    expect(prosePanel!.querySelector("strong")).not.toBeNull();
  });

  it("AC#6: step counter shows '1 / 2' initially", () => {
    render(<TourPlayback tour={sampleTour} />);
    expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
  });

  it("AC#6: Prev button is disabled on first step", () => {
    render(<TourPlayback tour={sampleTour} />);
    const prevBtn = screen.getByRole("button", { name: /prev/i });
    expect(prevBtn).toBeDisabled();
  });

  it("AC#6: Next button is disabled on last step", () => {
    render(<TourPlayback tour={sampleTour} />);
    // Navigate to last step.
    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn);
    expect(nextBtn).toBeDisabled();
  });

  it("AC#6: clicking Next increments the step counter", () => {
    render(<TourPlayback tour={sampleTour} />);
    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn);
    expect(screen.getByTestId("step-counter").textContent).toBe("2 / 2");
  });

  it("AC#6: clicking Next then Prev returns to step 1", () => {
    render(<TourPlayback tour={sampleTour} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /prev/i }));
    expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
  });

  it("AC#7: after navigating to step 2, prose reflects step 2 content", () => {
    const { container } = render(<TourPlayback tour={sampleTour} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByTestId("step-label").textContent).toBe("Second Step");
    const prosePanel = container.querySelector(".tour-playback__prose-content");
    expect(prosePanel!.textContent).toContain("Now we look at reviews.");
  });

  it("AC#5: subgraph tabs are present", () => {
    render(<TourPlayback tour={sampleTour} />);
    expect(screen.getByRole("button", { name: "products" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "reviews" })).toBeTruthy();
  });

  it("AC#5: clicking a subgraph tab makes it active", () => {
    render(<TourPlayback tour={sampleTour} />);
    const reviewsTab = screen.getByRole("button", { name: "reviews" });
    fireEvent.click(reviewsTab);
    expect(reviewsTab.getAttribute("aria-pressed")).toBe("true");
  });
});
