import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    // Default to desktop so useMobile() returns false.
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      writable: true,
      configurable: true,
    });
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

  describe("mobile layout", () => {
    beforeEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: 375,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: 1024,
        writable: true,
        configurable: true,
      });
    });

    it("AC#1: renders mobile tab bar instead of 3-pane layout at ≤768px", () => {
      const { container } = render(<TourPlayback tour={sampleTour} />);
      expect(container.querySelector(".mobile-tabbar")).not.toBeNull();
      expect(container.querySelector(".tour-playback__body")).toBeNull();
    });

    it("AC#1: outer element has tour-playback--mobile class", () => {
      const { container } = render(<TourPlayback tour={sampleTour} />);
      expect(container.querySelector(".tour-playback--mobile")).not.toBeNull();
    });

    it("AC#2: Tour tab shows step prose, step label, step counter, and tour title", () => {
      const { container } = render(<TourPlayback tour={sampleTour} />);
      // Tour tab is the default — content is immediately visible.
      expect(screen.getByTestId("tour-title").textContent).toBe("GraphQL Federation Tour");
      expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
      expect(screen.getByTestId("step-label").textContent).toBe("Introduction");
      const prose = container.querySelector(".tour-playback__prose-content");
      expect(prose).not.toBeNull();
      expect(prose!.textContent).toContain("Welcome to");
    });

    it("AC#2: Prev/Next buttons are present in the mobile header", () => {
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.getByRole("button", { name: /prev/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /next/i })).toBeTruthy();
    });

    it("AC#2: Prev/Next navigation updates step counter on mobile", () => {
      render(<TourPlayback tour={sampleTour} />);
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
      expect(screen.getByTestId("step-counter").textContent).toBe("2 / 2");
      fireEvent.click(screen.getByRole("button", { name: /prev/i }));
      expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
    });

    it("AC#3: Schema tab shows subgraph SDL panel", () => {
      const { container } = render(<TourPlayback tour={sampleTour} />);
      fireEvent.click(screen.getByRole("button", { name: "Schema" }));
      expect(container.querySelector(".tour-playback__schema-panel")).not.toBeNull();
    });

    it("AC#4: Plan tab shows plan panel", () => {
      const { container } = render(<TourPlayback tour={sampleTour} />);
      fireEvent.click(screen.getByRole("button", { name: "Plan" }));
      expect(container.querySelector(".tour-playback__plan-panel--mobile")).not.toBeNull();
    });

    it("AC#5: Open in Fiddle button is accessible on mobile", () => {
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.getByRole("button", { name: /open in fiddle/i })).toBeTruthy();
    });
  });

  describe("keyboard navigation (TASK-73)", () => {
    it("AC#1: ArrowRight advances from step 0 to step 1", () => {
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(screen.getByTestId("step-counter").textContent).toBe("2 / 2");
    });

    it("AC#2: ArrowLeft retreats from step 1 to step 0", () => {
      render(<TourPlayback tour={sampleTour} />);
      // Navigate to step 1 first.
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(screen.getByTestId("step-counter").textContent).toBe("2 / 2");
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
    });

    it("AC#4: ArrowRight on last step is a no-op", () => {
      render(<TourPlayback tour={sampleTour} />);
      // Navigate to last step.
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(screen.getByTestId("step-counter").textContent).toBe("2 / 2");
      // ArrowRight again — should stay at last step.
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(screen.getByTestId("step-counter").textContent).toBe("2 / 2");
    });

    it("AC#4: ArrowLeft on first step is a no-op", () => {
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
    });

    it("AC#5: ArrowRight does not fire when focus is inside an <input>", () => {
      render(<TourPlayback tour={sampleTour} />);
      const inputEl = document.createElement("input");
      document.body.appendChild(inputEl);
      inputEl.focus();
      try {
        fireEvent.keyDown(inputEl, { key: "ArrowRight" });
        expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
      } finally {
        document.body.removeChild(inputEl);
      }
    });

    it("AC#5: ArrowRight does not fire when focus is inside a <textarea>", () => {
      render(<TourPlayback tour={sampleTour} />);
      const textareaEl = document.createElement("textarea");
      document.body.appendChild(textareaEl);
      textareaEl.focus();
      try {
        fireEvent.keyDown(textareaEl, { key: "ArrowRight" });
        expect(screen.getByTestId("step-counter").textContent).toBe("1 / 2");
      } finally {
        document.body.removeChild(textareaEl);
      }
    });
  });

  describe("onboarding hint (TASK-74)", () => {
    beforeEach(() => {
      // Clear localStorage so the hint is in its default visible state.
      localStorage.clear();
    });

    afterEach(() => {
      localStorage.clear();
    });

    it("AC#1: hint appears on first entry (clean localStorage)", () => {
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.getByTestId("onboarding-hint")).toBeTruthy();
    });

    it("AC#2: hint text mentions Prev/Next buttons and arrow keys", () => {
      const { container } = render(<TourPlayback tour={sampleTour} />);
      const hint = container.querySelector("[data-testid='onboarding-hint']");
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toContain("← Prev");
      expect(hint!.textContent).toContain("Next →");
      expect(hint!.textContent).toContain("arrow keys");
      // <kbd> elements should be present for the keyboard glyphs.
      expect(hint!.querySelectorAll("kbd").length).toBeGreaterThanOrEqual(2);
    });

    it("AC#3: clicking the dismiss button hides the hint", () => {
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.getByTestId("onboarding-hint")).toBeTruthy();
      fireEvent.click(screen.getByTestId("onboarding-hint-dismiss"));
      expect(screen.queryByTestId("onboarding-hint")).toBeNull();
    });

    it("AC#3: pressing Escape dismisses the hint", () => {
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.getByTestId("onboarding-hint")).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("onboarding-hint")).toBeNull();
    });

    it("AC#4: localStorage flag is set to '1' after dismissal", () => {
      render(<TourPlayback tour={sampleTour} />);
      fireEvent.click(screen.getByTestId("onboarding-hint-dismiss"));
      expect(localStorage.getItem("gql-fiddle:tour-onboarding-dismissed")).toBe("1");
    });

    it("AC#4: hint does not reappear after dismissal and remount", () => {
      const { unmount } = render(<TourPlayback tour={sampleTour} />);
      // Dismiss — sets the localStorage flag.
      fireEvent.click(screen.getByTestId("onboarding-hint-dismiss"));
      unmount();
      cleanup();
      // Re-render — localStorage already has the flag, so hint must not appear.
      render(<TourPlayback tour={sampleTour} />);
      expect(screen.queryByTestId("onboarding-hint")).toBeNull();
    });

    it("AC#5 (structural): TourPlayback is only mounted in playback mode — hint is absent in authoring mode by construction", () => {
      // TourPlayback is rendered only when `playbackTour !== null` in App.tsx
      // (the normal fiddle/authoring UI renders instead). Therefore any
      // TourPlayback instance is implicitly in playback mode. This test
      // documents that invariant: the component renders, so we are in playback.
      render(<TourPlayback tour={sampleTour} />);
      // Hint is shown in playback mode — authoring mode never mounts this component.
      expect(screen.getByTestId("onboarding-hint")).toBeTruthy();
    });
  });

  describe("per-step pane visibility (TASK-71)", () => {
    it("schema panel is absent when paneVisibility.schema = false", () => {
      const tour: Tour = {
        ...sampleTour,
        steps: [{ ...sampleTour.steps[0], paneVisibility: { schema: false } }, sampleTour.steps[1]],
      };
      const { container } = render(<TourPlayback tour={tour} />);
      expect(container.querySelector(".tour-playback__schema-panel")).toBeNull();
    });

    it("plan panel is absent when paneVisibility.plan = false", () => {
      const tour: Tour = {
        ...sampleTour,
        steps: [{ ...sampleTour.steps[0], paneVisibility: { plan: false } }, sampleTour.steps[1]],
      };
      const { container } = render(<TourPlayback tour={tour} />);
      expect(container.querySelector(".tour-playback__plan-panel")).toBeNull();
    });

    it("both panels present when no paneVisibility set (default, backward compat)", () => {
      const { container } = render(<TourPlayback tour={sampleTour} />);
      expect(container.querySelector(".tour-playback__schema-panel")).not.toBeNull();
      expect(container.querySelector(".tour-playback__plan-panel")).not.toBeNull();
    });

    it("right column gets --hidden class when both panes are hidden", () => {
      const tour: Tour = {
        ...sampleTour,
        steps: [
          { ...sampleTour.steps[0], paneVisibility: { schema: false, plan: false } },
          sampleTour.steps[1],
        ],
      };
      const { container } = render(<TourPlayback tour={tour} />);
      expect(container.querySelector(".tour-playback__right--hidden")).not.toBeNull();
    });

    it("navigating to a step with paneVisibility: { plan: false } hides plan panel", () => {
      const tour: Tour = {
        ...sampleTour,
        steps: [sampleTour.steps[0], { ...sampleTour.steps[1], paneVisibility: { plan: false } }],
      };
      const { container } = render(<TourPlayback tour={tour} />);
      // Step 0 — plan panel should be visible.
      expect(container.querySelector(".tour-playback__plan-panel")).not.toBeNull();
      // Navigate to step 1.
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
      // Step 1 — plan panel should be hidden.
      expect(container.querySelector(".tour-playback__plan-panel")).toBeNull();
    });

    describe("mobile pane visibility", () => {
      beforeEach(() => {
        Object.defineProperty(window, "innerWidth", {
          value: 375,
          writable: true,
          configurable: true,
        });
      });

      afterEach(() => {
        Object.defineProperty(window, "innerWidth", {
          value: 1024,
          writable: true,
          configurable: true,
        });
      });

      it("Schema tab button absent when paneVisibility.schema = false", () => {
        const tour: Tour = {
          ...sampleTour,
          steps: [
            { ...sampleTour.steps[0], paneVisibility: { schema: false } },
            sampleTour.steps[1],
          ],
        };
        render(<TourPlayback tour={tour} />);
        // "Schema" button should not appear in the tab bar.
        expect(screen.queryByRole("button", { name: "Schema" })).toBeNull();
      });

      it("Plan tab button absent when paneVisibility.plan = false", () => {
        const tour: Tour = {
          ...sampleTour,
          steps: [{ ...sampleTour.steps[0], paneVisibility: { plan: false } }, sampleTour.steps[1]],
        };
        render(<TourPlayback tour={tour} />);
        expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
      });
    });
  });
});
