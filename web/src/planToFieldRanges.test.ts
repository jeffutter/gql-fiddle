import { describe, expect, it } from "vitest";
import { planToFieldRanges, collectServiceNames } from "./planToFieldRanges";
import type { PlanNode } from "./core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function range(result: ReturnType<typeof planToFieldRanges>, service: string) {
  return result.filter((r) => r.service === service);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Each Fetch now carries pre-computed resolved_fields (as the Rust WASM layer
// produces them) instead of requiring planToFieldRanges to re-parse the
// operation string.

const FETCH_USERS: PlanNode = {
  kind: "Fetch",
  service: "users",
  operation: "{ me { id name } }",
  operation_kind: "query",
  resolved_fields: [
    { field_name: "me", type_condition: null },
    { field_name: "id", type_condition: null },
    { field_name: "name", type_condition: null },
  ],
};

const FETCH_REVIEWS: PlanNode = {
  kind: "Fetch",
  service: "reviews",
  operation: "{ topProducts { upc title } }",
  operation_kind: "query",
  resolved_fields: [
    { field_name: "topProducts", type_condition: null },
    { field_name: "upc", type_condition: null },
    { field_name: "title", type_condition: null },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("planToFieldRanges", () => {
  it("single Fetch — returns one FieldRange for each matched top-level field", () => {
    const query = "{ me { id name } }";
    const result = planToFieldRanges(FETCH_USERS, query);
    // "me" should be tagged to the users service
    const userRanges = range(result, "users");
    expect(userRanges.length).toBeGreaterThanOrEqual(1);
    const names = userRanges.map((r) => query.slice(r.col - 1, r.col - 1 + r.len));
    expect(names).toContain("me");
  });

  it("single Fetch — all returned ranges have the correct service tag", () => {
    const query = "{ me { id name } }";
    const result = planToFieldRanges(FETCH_USERS, query);
    expect(result.every((r) => r.service === "users")).toBe(true);
  });

  it("Sequence of two Fetches — each field is tagged to its service", () => {
    const query = "{ me { id } topProducts { upc } }";
    const node: PlanNode = { kind: "Sequence", nodes: [FETCH_USERS, FETCH_REVIEWS] };
    const result = planToFieldRanges(node, query);
    expect(result.some((r) => r.service === "users")).toBe(true);
    expect(result.some((r) => r.service === "reviews")).toBe(true);
  });

  it("Parallel two Fetches — all fields are accounted for", () => {
    const query = "{ me { id } topProducts { upc } }";
    const node: PlanNode = { kind: "Parallel", nodes: [FETCH_USERS, FETCH_REVIEWS] };
    const result = planToFieldRanges(node, query);
    expect(result.some((r) => r.service === "users")).toBe(true);
    expect(result.some((r) => r.service === "reviews")).toBe(true);
  });

  it("Fetch with no resolved_fields — skips gracefully, no throw", () => {
    const emptyFetch: PlanNode = {
      kind: "Fetch",
      service: "broken",
      operation: "{ something }",
      operation_kind: "query",
      // resolved_fields absent — graceful degradation (stale WASM)
    };
    const query = "{ me { id } }";
    expect(() => planToFieldRanges(emptyFetch, query)).not.toThrow();
    const result = planToFieldRanges(emptyFetch, query);
    expect(result.filter((r) => r.service === "broken")).toHaveLength(0);
  });

  it("invalid original query — returns empty array", () => {
    const result = planToFieldRanges(FETCH_USERS, "{{{{ not valid graphql");
    expect(result).toEqual([]);
  });

  it("alias field — range starts at the alias keyword position, not the field name", () => {
    const query = "{ renamedMe: me { id } }";
    // Fetch uses the underlying field name "me"
    const result = planToFieldRanges(FETCH_USERS, query);
    const userRanges = range(result, "users");
    // There should be a range whose token text is "renamedMe"
    const aliasRange = userRanges.find((r) => {
      const token = query.slice(r.col - 1, r.col - 1 + r.len);
      return token === "renamedMe";
    });
    expect(aliasRange).toBeDefined();
  });

  it("Nested Parallel inside Sequence — all services returned", () => {
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, { kind: "Parallel", nodes: [FETCH_REVIEWS, FETCH_USERS] }],
    };
    const query = "{ me { id } topProducts { upc } }";
    const result = planToFieldRanges(node, query);
    expect(result.some((r) => r.service === "users")).toBe(true);
    expect(result.some((r) => r.service === "reviews")).toBe(true);
  });

  it("line and col values are 1-based", () => {
    const query = "{\n  me {\n    id\n  }\n}";
    const result = planToFieldRanges(FETCH_USERS, query);
    // "me" is on line 2
    const meRange = result.find((r) => {
      const lines = query.split("\n");
      const line = lines[r.line - 1] ?? "";
      return line.slice(r.col - 1, r.col - 1 + r.len) === "me";
    });
    expect(meRange).toBeDefined();
    expect(meRange!.line).toBe(2);
  });

  it("empty plan tree — returns empty array", () => {
    // A Parallel with no children — unusual but should not crash
    const node: PlanNode = { kind: "Parallel", nodes: [] };
    const result = planToFieldRanges(node, "{ me { id } }");
    expect(result).toEqual([]);
  });

  it("fragment spread in original query — fields inside fragment are found", () => {
    const query = "fragment F on Query { me { id } }\n{ ...F }";
    // FETCH_USERS resolved_fields contains "me" — should match the fragment field
    const result = planToFieldRanges(FETCH_USERS, query);
    expect(result.some((r) => r.service === "users")).toBe(true);
  });

  it("entity fetch — fields with type_condition are attributed to correct subgraph", () => {
    const entityFetch: PlanNode = {
      kind: "Fetch",
      service: "products",
      operation:
        "query($_representations: [_Any!]!) { _entities(representations: $_representations) { ... on Product { price name } } }",
      operation_kind: "query",
      resolved_fields: [
        { field_name: "price", type_condition: "Product" },
        { field_name: "name", type_condition: "Product" },
      ],
    };
    const query = '{ product(id: "1") { ... on Product { price name } } }';
    const result = planToFieldRanges(entityFetch, query);
    expect(result.some((r) => r.service === "products")).toBe(true);
    const productRanges = range(result, "products");
    const names = productRanges.map((r) => query.slice(r.col - 1, r.col - 1 + r.len));
    expect(names).toContain("price");
    expect(names).toContain("name");
  });

  it("absent resolved_fields (undefined) — graceful degradation, returns empty array", () => {
    const fetchWithoutFields: PlanNode = {
      kind: "Fetch",
      service: "legacy",
      operation: "{ me }",
      operation_kind: "query",
      // no resolved_fields key at all
    };
    const result = planToFieldRanges(fetchWithoutFields, "{ me }");
    // No crash, and no results since we have nothing to match
    expect(result).toEqual([]);
  });
});

describe("collectServiceNames", () => {
  it("single Fetch — returns that service", () => {
    expect(collectServiceNames(FETCH_USERS)).toEqual(["users"]);
  });

  it("Sequence of two different services — returns both in order", () => {
    const node: PlanNode = { kind: "Sequence", nodes: [FETCH_USERS, FETCH_REVIEWS] };
    expect(collectServiceNames(node)).toEqual(["users", "reviews"]);
  });

  it("deduplicates repeated services", () => {
    const node: PlanNode = { kind: "Sequence", nodes: [FETCH_USERS, FETCH_USERS] };
    expect(collectServiceNames(node)).toEqual(["users"]);
  });
});
