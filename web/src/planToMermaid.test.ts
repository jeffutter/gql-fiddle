import { describe, expect, it } from "vitest";
import { planToMermaid } from "./planToMermaid";
import type { PlanNode } from "./core/types";

const FETCH_USERS: PlanNode = {
  kind: "Fetch",
  service: "users",
  operation: "{ me { id name } }",
  operation_kind: "query",
};

const FETCH_REVIEWS: PlanNode = {
  kind: "Fetch",
  service: "reviews",
  operation: "{ topProducts { upc title } }",
  operation_kind: "query",
};

describe("planToMermaid", () => {
  it("single Fetch — declares Router and service participant, emits arrow", () => {
    const result = planToMermaid(FETCH_USERS);
    expect(result).toContain("sequenceDiagram");
    expect(result).toContain("participant Router");
    expect(result).toContain("participant users");
    expect(result).toContain("Router->>users: me");
  });

  it("Sequence of two Fetches — both arrows appear in order", () => {
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, FETCH_REVIEWS],
    };
    const result = planToMermaid(node);
    expect(result).toContain("participant users");
    expect(result).toContain("participant reviews");
    const usersIdx = result.indexOf("Router->>users:");
    const reviewsIdx = result.indexOf("Router->>reviews:");
    expect(usersIdx).toBeGreaterThan(-1);
    expect(reviewsIdx).toBeGreaterThan(usersIdx);
  });

  it("Parallel two Fetches — emits par/and/end block with both arrows", () => {
    const node: PlanNode = {
      kind: "Parallel",
      nodes: [FETCH_USERS, FETCH_REVIEWS],
    };
    const result = planToMermaid(node);
    const lines = result.split("\n");
    expect(lines.some((l) => l.trimEnd() === "  par")).toBe(true);
    expect(lines.some((l) => l.trimEnd() === "  and")).toBe(true);
    expect(lines.some((l) => l.trimEnd() === "  end")).toBe(true);
    expect(result).toContain("Router->>users:");
    expect(result).toContain("Router->>reviews:");
  });

  it("single-child Parallel — emits child directly without par/end (Mermaid requires ≥2 branches)", () => {
    const node: PlanNode = { kind: "Parallel", nodes: [FETCH_USERS] };
    const result = planToMermaid(node);
    // "\n  par\n" distinguishes the par keyword from "participant" lines
    expect(result).not.toContain("\n  par\n");
    expect(result).not.toContain("\n  end\n");
    expect(result).toContain("Router->>users:");
  });

  it("Flatten wrapping Fetch — includes flatten path Note on the arrow", () => {
    const node: PlanNode = {
      kind: "Flatten",
      path: ["users", "@"],
      node: {
        kind: "Fetch",
        service: "reviews",
        operation: "{ reviews { body } }",
        operation_kind: "query",
      },
    };
    const result = planToMermaid(node);
    expect(result).toContain("Router->>reviews: reviews");
    expect(result).toContain("Note over Router,reviews: flatten @ users.@");
  });

  it("Fetch with requires — emits Note right of with field names", () => {
    const node: PlanNode = {
      kind: "Fetch",
      service: "reviews",
      operation: "{ reviews { body } }",
      operation_kind: "query",
      requires: [
        { kind: "Field", name: "__typename" },
        { kind: "Field", name: "id" },
      ],
    };
    const result = planToMermaid(node);
    expect(result).toContain("Note right of reviews: requires: __typename, id");
  });

  it("Sequence containing Parallel — arrows and par/end nested correctly", () => {
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, { kind: "Parallel", nodes: [FETCH_REVIEWS, FETCH_USERS] }],
    };
    const result = planToMermaid(node);
    const lines = result.split("\n");
    const firstUsersLine = lines.findIndex((l) => l.includes("Router->>users:"));
    // "  par" as a complete line (not "  participant …")
    const parLine = lines.findIndex((l) => l.trimEnd() === "  par");
    expect(firstUsersLine).toBeGreaterThan(-1);
    expect(parLine).toBeGreaterThan(firstUsersLine);
    expect(lines.some((l) => l.trimEnd() === "  and")).toBe(true);
    expect(lines.some((l) => l.trimEnd() === "  end")).toBe(true);
  });

  it("participants deduplication — same service in two Fetches appears only once", () => {
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, FETCH_USERS],
    };
    const result = planToMermaid(node);
    const matches = [...result.matchAll(/participant users/g)];
    expect(matches).toHaveLength(1);
  });

  it("requires with nested InlineFragment — flattens field names from selections", () => {
    const node: PlanNode = {
      kind: "Fetch",
      service: "products",
      operation: "{ products { upc } }",
      operation_kind: "query",
      requires: [
        {
          kind: "InlineFragment",
          selections: [
            { kind: "Field", name: "__typename" },
            { kind: "Field", name: "upc" },
          ],
        },
      ],
    };
    const result = planToMermaid(node);
    expect(result).toContain("requires: __typename, upc");
  });
});
