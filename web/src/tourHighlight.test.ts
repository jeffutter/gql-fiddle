import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyTourHighlight } from "./tourHighlight";
import type { TourStep } from "./share";

type DecorationsArg = Array<{
  range: { startLineNumber: number };
  options: { linesDecorationsClassName: string; className: string; isWholeLine: boolean };
}>;

// Minimal Monaco mock — just enough for applyTourHighlight to work.
function makeMonacoMock() {
  return {
    Range: class Range {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
      constructor(
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number,
      ) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    },
  };
}

function makeEditorMock() {
  const clearFn = vi.fn();
  const collectionMock = { clear: clearFn };
  const createDecorationsCollection = vi.fn(() => collectionMock);
  const revealLineInCenter = vi.fn();

  return {
    createDecorationsCollection,
    revealLineInCenter,
    collectionMock,
    clearFn,
  };
}

/** Helper: get the first call's first argument as a typed decorations array. */
function getDecorations(mock: ReturnType<typeof makeEditorMock>): DecorationsArg {
  return (mock.createDecorationsCollection.mock.calls[0] as unknown as [DecorationsArg])[0];
}

const SUBGRAPH_SDL = `type Query {
  products: [Product]
}

type Product {
  id: ID!
  name: String
  price: Float
}
`;

const PREV_SDL = `type Query {
  products: [Product]
}

type Product {
  id: ID!
  name: String
}
`;

describe("applyTourHighlight", () => {
  let editorMock: ReturnType<typeof makeEditorMock>;
  let monacoMock: ReturnType<typeof makeMonacoMock>;

  beforeEach(() => {
    editorMock = makeEditorMock();
    monacoMock = makeMonacoMock();
  });

  describe("anchor-based path", () => {
    it("creates a decoration at the field line and auto-scrolls when fieldName is set", () => {
      const step: TourStep = {
        label: "Price field",
        prose: "Notice the price field",
        anchor: { subgraphIndex: 0, typeName: "Product", fieldName: "price" },
      };

      const handle = applyTourHighlight(
        editorMock as never,
        monacoMock as never,
        step,
        SUBGRAPH_SDL,
        PREV_SDL,
        0,
      );

      expect(editorMock.createDecorationsCollection).toHaveBeenCalledOnce();
      const decorations = getDecorations(editorMock);
      expect(decorations).toHaveLength(1);
      // "  price: Float" is on line 8 (1-based) in SUBGRAPH_SDL
      expect(decorations[0]!.range.startLineNumber).toBe(8);
      expect(decorations[0]!.options.linesDecorationsClassName).toBe("tour-highlight-gutter");
      expect(decorations[0]!.options.className).toBe(
        "tour-highlight-line tour-highlight-line--anchor",
      );

      expect(editorMock.revealLineInCenter).toHaveBeenCalledWith(8);

      // dispose clears the collection
      handle.dispose();
      expect(editorMock.clearFn).toHaveBeenCalledOnce();
    });

    it("creates a decoration at the type declaration line when only typeName is given", () => {
      const step: TourStep = {
        label: "Product type",
        prose: "The Product type",
        anchor: { subgraphIndex: 0, typeName: "Product" },
      };

      const handle = applyTourHighlight(
        editorMock as never,
        monacoMock as never,
        step,
        SUBGRAPH_SDL,
        PREV_SDL,
        0,
      );

      expect(editorMock.createDecorationsCollection).toHaveBeenCalledOnce();
      const decorations = getDecorations(editorMock);
      expect(decorations).toHaveLength(1);
      // "type Product {" is on line 5 in SUBGRAPH_SDL
      expect(decorations[0]!.range.startLineNumber).toBe(5);
      expect(editorMock.revealLineInCenter).toHaveBeenCalledWith(5);

      handle.dispose();
      expect(editorMock.clearFn).toHaveBeenCalledOnce();
    });

    it("returns a no-op handle when the anchor type/field is not found in the SDL", () => {
      const step: TourStep = {
        label: "Missing type",
        prose: "This type does not exist",
        anchor: { subgraphIndex: 0, typeName: "Nonexistent" },
      };

      const handle = applyTourHighlight(
        editorMock as never,
        monacoMock as never,
        step,
        SUBGRAPH_SDL,
        PREV_SDL,
        0,
      );

      expect(editorMock.createDecorationsCollection).not.toHaveBeenCalled();
      expect(editorMock.revealLineInCenter).not.toHaveBeenCalled();
      // dispose is safe to call on a no-op handle
      expect(() => handle.dispose()).not.toThrow();
    });

    it("falls through to diff-based path when anchor targets a different subgraph", () => {
      const step: TourStep = {
        label: "Other subgraph anchor",
        prose: "Anchored to subgraph 1",
        anchor: { subgraphIndex: 1, typeName: "Product" },
      };

      // activeSubgraphIndex is 0, so the anchor (subgraphIndex 1) does NOT match.
      // Falls through to diff-based: SUBGRAPH_SDL has a new "price" line vs PREV_SDL.
      const handle = applyTourHighlight(
        editorMock as never,
        monacoMock as never,
        step,
        SUBGRAPH_SDL,
        PREV_SDL,
        0,
      );

      expect(editorMock.createDecorationsCollection).toHaveBeenCalledOnce();
      handle.dispose();
    });
  });

  describe("diff-based path", () => {
    it("highlights the new line and auto-scrolls to the first change", () => {
      const step: TourStep = {
        label: "Schema change",
        prose: "A field was added",
        // No anchor
      };

      const handle = applyTourHighlight(
        editorMock as never,
        monacoMock as never,
        step,
        SUBGRAPH_SDL,
        PREV_SDL,
        0,
      );

      expect(editorMock.createDecorationsCollection).toHaveBeenCalledOnce();
      const decorations = getDecorations(editorMock);
      // The new line "  price: Float" is on line 8 in SUBGRAPH_SDL (1-based)
      expect(decorations.some((d) => d.range.startLineNumber === 8)).toBe(true);
      // revealLineInCenter called with the first changed line
      expect(editorMock.revealLineInCenter).toHaveBeenCalled();

      handle.dispose();
      expect(editorMock.clearFn).toHaveBeenCalledOnce();
    });

    it("returns a no-op handle when SDL is identical (intro/summary step)", () => {
      const step: TourStep = {
        label: "Intro",
        prose: "Welcome to the tour",
        // No anchor, SDL unchanged
      };

      const handle = applyTourHighlight(
        editorMock as never,
        monacoMock as never,
        step,
        SUBGRAPH_SDL,
        SUBGRAPH_SDL, // same SDL = no diff
        0,
      );

      expect(editorMock.createDecorationsCollection).not.toHaveBeenCalled();
      expect(editorMock.revealLineInCenter).not.toHaveBeenCalled();
      expect(() => handle.dispose()).not.toThrow();
    });
  });

  describe("handle disposal (AC#4)", () => {
    it("calling dispose() clears the decoration collection", () => {
      const step: TourStep = {
        label: "Price field",
        prose: "Focus on price",
        anchor: { subgraphIndex: 0, typeName: "Product", fieldName: "price" },
      };

      const handle = applyTourHighlight(
        editorMock as never,
        monacoMock as never,
        step,
        SUBGRAPH_SDL,
        PREV_SDL,
        0,
      );

      expect(editorMock.clearFn).not.toHaveBeenCalled();
      handle.dispose();
      expect(editorMock.clearFn).toHaveBeenCalledOnce();
    });
  });
});
