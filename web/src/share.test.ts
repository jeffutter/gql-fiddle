import { describe, expect, it } from "vitest";
import * as pako from "pako";
import {
  decode,
  encode,
  WorkspacePayload,
  encodeTour,
  decodeTour,
  resolveTourStep,
  Tour,
} from "./share";

const SAMPLE_PAYLOAD: WorkspacePayload = {
  subgraphs: [
    {
      name: "products",
      sdl: "type Query { products: [Product] }\ntype Product { id: ID! name: String }",
    },
    { name: "reviews", sdl: 'type Product @key(fields: "id") { id: ID! review: String }' },
  ],
  queryTabs: [{ name: "Query 1", query: "query { products { id name } }" }],
  activeQueryTab: 0,
  seed: 42,
};

describe("share.ts encode/decode", () => {
  it("round-trip: decode(encode(payload)) equals original payload", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    const decoded = decode(encoded);
    expect(decoded).toEqual(SAMPLE_PAYLOAD);
  });

  it("decode returns correct subgraphs, queryTabs, activeQueryTab, and seed values", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    const decoded = decode(encoded);
    expect(decoded.subgraphs).toHaveLength(2);
    expect(decoded.subgraphs[0].name).toBe("products");
    expect(decoded.subgraphs[1].name).toBe("reviews");
    expect(decoded.queryTabs).toHaveLength(1);
    expect(decoded.queryTabs[0].name).toBe("Query 1");
    expect(decoded.queryTabs[0].query).toBe("query { products { id name } }");
    expect(decoded.activeQueryTab).toBe(0);
    expect(decoded.seed).toBe(42);
  });

  it("encode produces output starting with #w= prefix", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    expect(encoded).toMatch(/^#w=/);
  });

  it("round-trips a payload with multiple query tabs", () => {
    const multiTabPayload: WorkspacePayload = {
      subgraphs: [{ name: "products", sdl: "type Query { products: [Product] }" }],
      queryTabs: [
        { name: "Query 1", query: "query { products { id } }" },
        { name: "Query 2", query: "query { products { name } }" },
        { name: "Named Op", query: "query GetAll { products { id name } }" },
      ],
      activeQueryTab: 1,
      seed: 77,
    };
    const decoded = decode(encode(multiTabPayload));
    expect(decoded).toEqual(multiTabPayload);
    expect(decoded.queryTabs).toHaveLength(3);
    expect(decoded.activeQueryTab).toBe(1);
  });

  it("throws on empty string", () => {
    expect(() => decode("")).toThrow();
  });

  it("throws on random base64 without prefix", () => {
    expect(() => decode("SGVsbG8gV29ybGQ=")).toThrow();
  });

  it("throws on truncated gzip data (valid prefix + garbage)", () => {
    // Valid #w= prefix but not valid gzip — pako.inflate should throw
    const b64url = "dGVzdA"; // base64url for "test" — not gzip
    expect(() => decode("#w=" + b64url)).toThrow();
  });

  it("throws on empty payload after prefix", () => {
    expect(() => decode("#w=")).toThrow();
  });

  it("backward compat: decodes a pre-TASK-30 URL with flat query/variables into a single queryTab", () => {
    // Encode an old-format payload (query/variables at top level, no queryTabs).
    const oldPayload = {
      subgraphs: [{ name: "products", sdl: "type Query { products: [Product] }" }],
      query: "query { products { id } }",
      variables: '{"limit":3}',
      seed: 55,
    };
    const compressed = pako.gzip(JSON.stringify(oldPayload));
    let bin = "";
    for (const b of compressed) bin += String.fromCharCode(b);
    const oldHash = "#w=" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    const decoded = decode(oldHash);
    expect(decoded.queryTabs).toHaveLength(1);
    expect(decoded.queryTabs[0].query).toBe("query { products { id } }");
    expect(decoded.activeQueryTab).toBe(0);
    expect(decoded.seed).toBe(55);
  });

  it("encoded payload contains only URL-safe characters (no +, /, or =)", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    const payload = encoded.slice("#w=".length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

const SAMPLE_TOUR: Tour = {
  title: "Introduction to Federation",
  base: {
    subgraphs: [
      {
        name: "products",
        sdl: "type Query { products: [Product] }\ntype Product { id: ID! name: String }",
      },
      { name: "reviews", sdl: 'type Product @key(fields: "id") { id: ID! review: String }' },
    ],
    queryTabs: [{ name: "Query 1", query: "query { products { id name } }" }],
    activeQueryTab: 0,
    seed: 42,
  },
  steps: [
    {
      label: "Step 1",
      prose: "Let's start with the products subgraph.",
      anchor: { subgraphIndex: 0, typeName: "Product", fieldName: "id" },
    },
    {
      label: "Step 2",
      prose: "Now let's look at the reviews subgraph.",
      overrides: {
        seed: 99,
      },
    },
    {
      label: "Step 3",
      prose: "Override multiple keys.",
      overrides: {
        queryTabs: [{ name: "Custom Query", query: "query { products { review } }" }],
        seed: 7,
      },
    },
  ],
};

describe("tour encode/decode", () => {
  it("round-trip: decodeTour(encodeTour(tour)) equals original tour", () => {
    const encoded = encodeTour(SAMPLE_TOUR);
    const decoded = decodeTour(encoded);
    expect(decoded).toEqual(SAMPLE_TOUR);
  });

  it("encodeTour produces a string starting with #t=", () => {
    const encoded = encodeTour(SAMPLE_TOUR);
    expect(encoded).toMatch(/^#t=/);
  });

  it("tour payload after prefix contains only URL-safe characters", () => {
    const encoded = encodeTour(SAMPLE_TOUR);
    const payload = encoded.slice("#t=".length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("decodeTour throws on wrong prefix (#w=)", () => {
    const workspaceHash = encode(SAMPLE_TOUR.base);
    expect(() => decodeTour(workspaceHash)).toThrow(
      "Invalid tour hash: must start with #t= and contain encoded data",
    );
  });

  it("decodeTour throws on empty string", () => {
    expect(() => decodeTour("")).toThrow(
      "Invalid tour hash: must start with #t= and contain encoded data",
    );
  });

  it("decodeTour throws on prefix only (#t= with no payload)", () => {
    expect(() => decodeTour("#t=")).toThrow(
      "Invalid tour hash: must start with #t= and contain encoded data",
    );
  });
});

describe("resolveTourStep", () => {
  it("returns base unchanged when step has no overrides", () => {
    const result = resolveTourStep(SAMPLE_TOUR, 0);
    expect(result).toBe(SAMPLE_TOUR.base);
  });

  it("returns a merged object (not the original base reference) when overrides exist", () => {
    const result = resolveTourStep(SAMPLE_TOUR, 1);
    expect(result).not.toBe(SAMPLE_TOUR.base);
  });

  it("partial override (seed only) leaves subgraphs and queryTabs from base", () => {
    // Step 1 overrides only seed: 99
    const result = resolveTourStep(SAMPLE_TOUR, 1);
    expect(result.seed).toBe(99);
    expect(result.subgraphs).toEqual(SAMPLE_TOUR.base.subgraphs);
    expect(result.queryTabs).toEqual(SAMPLE_TOUR.base.queryTabs);
    expect(result.activeQueryTab).toBe(SAMPLE_TOUR.base.activeQueryTab);
  });

  it("multi-key override: overridden keys win, unaffected base keys survive", () => {
    // Step 2 overrides queryTabs and seed, leaving subgraphs and activeQueryTab from base
    const result = resolveTourStep(SAMPLE_TOUR, 2);
    expect(result.queryTabs).toEqual([
      { name: "Custom Query", query: "query { products { review } }" },
    ]);
    expect(result.seed).toBe(7);
    expect(result.subgraphs).toEqual(SAMPLE_TOUR.base.subgraphs);
    expect(result.activeQueryTab).toBe(SAMPLE_TOUR.base.activeQueryTab);
  });
});
