import { describe, expect, it } from "vitest";
import { planToTimeline } from "./planToTimeline";
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

const FETCH_PRODUCTS: PlanNode = {
  kind: "Fetch",
  service: "products",
  operation: "{ products { id } }",
  operation_kind: "query",
};

describe("planToTimeline", () => {
  it("single Fetch — one item at depth 0, maxDepth 1, on critical path", () => {
    const data = planToTimeline(FETCH_USERS);
    expect(data.items).toHaveLength(1);
    expect(data.maxDepth).toBe(1);
    expect(data.services).toEqual(["users"]);
    const [item] = data.items;
    expect(item.depthStart).toBe(0);
    expect(item.depthEnd).toBe(1);
    expect(item.service).toBe("users");
    expect(item.label).toBe("me");
    expect(item.isOnCriticalPath).toBe(true);
  });

  it("Sequence of two Fetches — items at depths 0 and 1, both on critical path", () => {
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, FETCH_REVIEWS],
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(2);
    expect(data.maxDepth).toBe(2);
    const [a, b] = data.items;
    expect(a.depthStart).toBe(0);
    expect(a.depthEnd).toBe(1);
    expect(b.depthStart).toBe(1);
    expect(b.depthEnd).toBe(2);
    expect(a.isOnCriticalPath).toBe(true);
    expect(b.isOnCriticalPath).toBe(true);
  });

  it("Parallel of two Fetches — both at depth 0, neither on critical path", () => {
    const node: PlanNode = {
      kind: "Parallel",
      nodes: [FETCH_USERS, FETCH_REVIEWS],
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(2);
    expect(data.maxDepth).toBe(1);
    expect(data.items[0].depthStart).toBe(0);
    expect(data.items[1].depthStart).toBe(0);
    // Parallel column — neither is on critical path
    expect(data.items[0].isOnCriticalPath).toBe(false);
    expect(data.items[1].isOnCriticalPath).toBe(false);
  });

  it("Sequence containing Parallel — depth-0 item on critical path, depth-1 items not", () => {
    // Sequence: [users, Parallel([reviews, products])]
    // Depths: users=0, reviews=1, products=1; maxDepth=2
    // Column 0 has 1 occupant (sequential), column 1 has 2 (parallel).
    // The sequential chain breaks at column 1, so criticalEnd=1 but maxDepth=2 → no item is on path.
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, { kind: "Parallel", nodes: [FETCH_REVIEWS, FETCH_PRODUCTS] }],
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(3);
    expect(data.maxDepth).toBe(2);
    const users = data.items.find((i) => i.service === "users")!;
    const reviews = data.items.find((i) => i.service === "reviews")!;
    const products = data.items.find((i) => i.service === "products")!;
    expect(users.depthStart).toBe(0);
    expect(reviews.depthStart).toBe(1);
    expect(products.depthStart).toBe(1);
    // The chain from 0 reaches depth 1 which is parallel, so criticalEnd < maxDepth → false
    expect(users.isOnCriticalPath).toBe(false);
    expect(reviews.isOnCriticalPath).toBe(false);
    expect(products.isOnCriticalPath).toBe(false);
  });

  it("fully sequential chain of three — all on critical path", () => {
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, FETCH_REVIEWS, FETCH_PRODUCTS],
    };
    const data = planToTimeline(node);
    expect(data.maxDepth).toBe(3);
    expect(data.items.every((i) => i.isOnCriticalPath)).toBe(true);
  });

  it("Flatten wrapping Fetch — transparent; inner Fetch item is emitted", () => {
    const node: PlanNode = {
      kind: "Flatten",
      path: ["users", "@"],
      node: FETCH_REVIEWS,
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].service).toBe("reviews");
    expect(data.items[0].depthStart).toBe(0);
    expect(data.items[0].isOnCriticalPath).toBe(true);
  });

  it("service row deduplication — two Fetches to same service yield two items but one row", () => {
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [FETCH_USERS, FETCH_USERS],
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(2);
    expect(data.services).toHaveLength(1);
    expect(data.services[0]).toBe("users");
  });

  it("same-service same-depth merge — parallel branches to the same service are merged into one bar", () => {
    // Two parallel Sequences each ending with a Fetch to 'reviews'.
    // Both blueprint fetches land at depth 2; without merging they would
    // overlap exactly in the SVG and only the last-rendered label would be
    // visible.
    const fetchReviewsA: PlanNode = {
      kind: "Fetch",
      service: "reviews",
      operation: "{ reviewsForUser }",
      operation_kind: "query",
      entity_types: ["UserReview"],
    };
    const fetchReviewsB: PlanNode = {
      kind: "Fetch",
      service: "reviews",
      operation: "{ reviewsForProduct }",
      operation_kind: "query",
      entity_types: ["ProductReview"],
    };
    const node: PlanNode = {
      kind: "Sequence",
      nodes: [
        FETCH_USERS,
        {
          kind: "Parallel",
          nodes: [
            { kind: "Sequence", nodes: [FETCH_PRODUCTS, fetchReviewsA] },
            {
              kind: "Sequence",
              nodes: [
                {
                  kind: "Fetch",
                  service: "orders",
                  operation: "{ orders }",
                  operation_kind: "query",
                },
                fetchReviewsB,
              ],
            },
          ],
        },
      ],
    };
    const data = planToTimeline(node);
    // reviews appears twice at depth 2 → merged into one item with combined label
    const reviewItems = data.items.filter((i) => i.service === "reviews");
    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0].label).toBe("UserReview, ProductReview");
    expect(reviewItems[0].depthStart).toBe(2);
    expect(reviewItems[0].isEntityFetch).toBe(true);
    // Services list should still contain reviews exactly once
    expect(data.services.filter((s) => s === "reviews")).toHaveLength(1);
  });

  it("Subscription — primary and rest are sequential", () => {
    const node: PlanNode = {
      kind: "Subscription",
      primary: FETCH_USERS,
      rest: FETCH_REVIEWS,
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(2);
    expect(data.maxDepth).toBe(2);
    const [primary, rest] = data.items;
    expect(primary.depthStart).toBe(0);
    expect(rest.depthStart).toBe(1);
  });

  it("Subscription without rest — only primary item", () => {
    const node: PlanNode = {
      kind: "Subscription",
      primary: FETCH_USERS,
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(1);
    expect(data.maxDepth).toBe(1);
  });

  it("Defer — deferred branches start at same depth as primary (parallel semantics)", () => {
    const node: PlanNode = {
      kind: "Defer",
      primary: FETCH_USERS,
      deferred: [{ node: FETCH_REVIEWS }, { node: FETCH_PRODUCTS }],
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(3);
    // Primary at 0, deferred also at 0 (parallel to primary)
    expect(data.items[0].depthStart).toBe(0); // users (primary)
    expect(data.items[1].depthStart).toBe(0); // reviews (deferred)
    expect(data.items[2].depthStart).toBe(0); // products (deferred)
    expect(data.maxDepth).toBe(1);
  });

  it("Defer without primary — only deferred items", () => {
    const node: PlanNode = {
      kind: "Defer",
      deferred: [{ node: FETCH_REVIEWS }],
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].service).toBe("reviews");
  });

  it("Condition — both branches walked at same depth", () => {
    const node: PlanNode = {
      kind: "Condition",
      conditionVariable: "skip",
      ifBranch: FETCH_USERS,
      elseBranch: FETCH_REVIEWS,
    };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(2);
    expect(data.items[0].depthStart).toBe(0);
    expect(data.items[1].depthStart).toBe(0);
    expect(data.maxDepth).toBe(1);
  });

  it("empty Parallel — no items, maxDepth 0", () => {
    const node: PlanNode = { kind: "Parallel", nodes: [] };
    const data = planToTimeline(node);
    expect(data.items).toHaveLength(0);
    expect(data.maxDepth).toBe(0);
    expect(data.services).toHaveLength(0);
  });

  it("label extraction — extracts first top-level field", () => {
    const fetch: PlanNode = {
      kind: "Fetch",
      service: "products",
      operation: "{ topProducts { upc } }",
      operation_kind: "query",
    };
    const data = planToTimeline(fetch);
    expect(data.items[0].label).toBe("topProducts");
  });

  it("label extraction — falls back to ellipsis when operation has no field", () => {
    const fetch: PlanNode = {
      kind: "Fetch",
      service: "products",
      operation: "{}",
      operation_kind: "query",
    };
    const data = planToTimeline(fetch);
    expect(data.items[0].label).toBe("…");
  });

  it("non-entity fetch — isEntityFetch is false", () => {
    const data = planToTimeline(FETCH_USERS);
    expect(data.items[0].isEntityFetch).toBe(false);
  });

  it("entity fetch — multiple types — label shows type names, isEntityFetch true", () => {
    const fetch: PlanNode = {
      kind: "Fetch",
      service: "products",
      operation:
        "{ _entities(representations: $representations) { ... on Product { id } ... on Review { id } } }",
      operation_kind: "query",
      entity_types: ["Product", "Review"],
    };
    const data = planToTimeline(fetch);
    const [item] = data.items;
    expect(item.isEntityFetch).toBe(true);
    expect(item.label).toBe("Product, Review");
  });

  it("entity fetch — single type — label shows single type name, isEntityFetch true", () => {
    const fetch: PlanNode = {
      kind: "Fetch",
      service: "users",
      operation: "{ _entities(representations: $representations) { ... on User { id name } } }",
      operation_kind: "query",
      entity_types: ["User"],
    };
    const data = planToTimeline(fetch);
    const [item] = data.items;
    expect(item.isEntityFetch).toBe(true);
    expect(item.label).toBe("User");
  });

  it("entity fetch — no inline fragments — label falls back to _entities", () => {
    // Without entity_types, isEntityFetch is false; topLevelField gives "_entities" as label.
    const fetch: PlanNode = {
      kind: "Fetch",
      service: "products",
      operation: "{ _entities(representations: $representations) { id } }",
      operation_kind: "query",
      entity_types: [],
    };
    const data = planToTimeline(fetch);
    const [item] = data.items;
    expect(item.isEntityFetch).toBe(false);
    expect(item.label).toBe("_entities");
  });

  it("entity fetch — duplicate types are deduplicated in label", () => {
    // Rust already deduplicates; test supplies the already-deduped list.
    const fetch: PlanNode = {
      kind: "Fetch",
      service: "products",
      operation:
        "{ _entities(representations: $representations) { ... on Product { id ... on Product { title } } } }",
      operation_kind: "query",
      entity_types: ["Product"],
    };
    const data = planToTimeline(fetch);
    const [item] = data.items;
    expect(item.isEntityFetch).toBe(true);
    expect(item.label).toBe("Product");
  });
});
