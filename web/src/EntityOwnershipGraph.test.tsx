import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EntityOwnershipGraph } from "./EntityOwnershipGraph";
import type { EntityGraph } from "./schemaToEntityGraph";

afterEach(() => {
  cleanup();
});

/** Extract the "M x y" start point from a path's `d` attribute. */
function pathStart(d: string): string {
  const match = /^M\s+([\d.-]+)\s+([\d.-]+)/.exec(d);
  return match ? `${match[1]},${match[2]}` : "";
}

describe("EntityOwnershipGraph", () => {
  it("draws edges originating from the entity node that actually holds the reference", () => {
    // Source subgraph "SRC" owns two entities: TypeA and TypeB.
    // Both have an outbound reference to TypeC in the "TGT" subgraph.
    const graph: EntityGraph = {
      subgraphs: ["SRC", "TGT"],
      nodes: [
        { id: "SRC:TypeA", typeName: "TypeA", subgraph: "SRC", keyFields: ["id"] },
        { id: "SRC:TypeB", typeName: "TypeB", subgraph: "SRC", keyFields: ["id"] },
        { id: "TGT:TypeC", typeName: "TypeC", subgraph: "TGT", keyFields: ["id"] },
      ],
      edges: [
        {
          id: "SRC->TGT:TypeC#1",
          sourceSubgraph: "SRC",
          targetSubgraph: "TGT",
          sourceTypeName: "TypeA",
          typeName: "TypeC",
          keyFields: "id",
        },
        {
          id: "SRC->TGT:TypeC#2",
          sourceSubgraph: "SRC",
          targetSubgraph: "TGT",
          sourceTypeName: "TypeB",
          typeName: "TypeC",
          keyFields: "id",
        },
      ],
    };

    const { container } = render(<EntityOwnershipGraph graph={graph} />);

    // Two visible edge paths (each edge renders a hit-area path + a visible path).
    const paths = Array.from(container.querySelectorAll("path")).filter(
      (p) => p.getAttribute("stroke") !== "transparent",
    );
    expect(paths).toHaveLength(2);

    const starts = paths.map((p) => pathStart(p.getAttribute("d") ?? ""));
    expect(starts[0]).not.toBe("");
    expect(starts[1]).not.toBe("");
    // The two edges must originate from different nodes (TypeA vs TypeB),
    // not both from the first node in the SRC cluster.
    expect(starts[0]).not.toBe(starts[1]);
  });

  it("still renders a single edge correctly for the single-entity-per-subgraph case", () => {
    const graph: EntityGraph = {
      subgraphs: ["SRC", "TGT"],
      nodes: [
        { id: "SRC:TypeA", typeName: "TypeA", subgraph: "SRC", keyFields: ["id"] },
        { id: "TGT:TypeC", typeName: "TypeC", subgraph: "TGT", keyFields: ["id"] },
      ],
      edges: [
        {
          id: "SRC->TGT:TypeC",
          sourceSubgraph: "SRC",
          targetSubgraph: "TGT",
          sourceTypeName: "TypeA",
          typeName: "TypeC",
          keyFields: "id",
        },
      ],
    };

    const { container } = render(<EntityOwnershipGraph graph={graph} />);

    const visiblePath = Array.from(container.querySelectorAll("path")).find(
      (p) => p.getAttribute("stroke") !== "transparent",
    );
    expect(visiblePath).toBeDefined();
    expect(visiblePath?.getAttribute("d")).toBeTruthy();
  });
});
