import { describe, expect, it } from "vitest";
import { decode, encode, WorkspacePayload } from "./share";

const SAMPLE_PAYLOAD: WorkspacePayload = {
  subgraphs: [
    {
      name: "products",
      sdl: "type Query { products: [Product] }\ntype Product { id: ID! name: String }",
    },
    { name: "reviews", sdl: 'type Product @key(fields: "id") { id: ID! review: String }' },
  ],
  queryTabs: [{ name: "Query 1", query: "query { products { id name } }", variables: "{}" }],
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
    expect(decoded.queryTabs[0].variables).toBe("{}");
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
        { name: "Query 1", query: "query { products { id } }", variables: "{}" },
        { name: "Query 2", query: "query { products { name } }", variables: '{"limit":5}' },
        { name: "Named Op", query: "query GetAll { products { id name } }", variables: "{}" },
      ],
      activeQueryTab: 1,
      seed: 77,
    };
    const decoded = decode(encode(multiTabPayload));
    expect(decoded).toEqual(multiTabPayload);
    expect(decoded.queryTabs).toHaveLength(3);
    expect(decoded.queryTabs[1].variables).toBe('{"limit":5}');
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

  it("encoded payload contains only URL-safe characters (no +, /, or =)", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    const payload = encoded.slice("#w=".length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
