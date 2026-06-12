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
  query: "query { products { id name } }",
  variables: "{}",
  seed: 42,
};

describe("share.ts encode/decode", () => {
  it("round-trip: decode(encode(payload)) equals original payload", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    const decoded = decode(encoded);
    expect(decoded).toEqual(SAMPLE_PAYLOAD);
  });

  it("decode returns correct subgraphs, query, variables, and seed values", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    const decoded = decode(encoded);
    expect(decoded.subgraphs).toHaveLength(2);
    expect(decoded.subgraphs[0].name).toBe("products");
    expect(decoded.subgraphs[1].name).toBe("reviews");
    expect(decoded.query).toBe("query { products { id name } }");
    expect(decoded.variables).toBe("{}");
    expect(decoded.seed).toBe(42);
  });

  it("encode produces output starting with #w= prefix", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    expect(encoded).toMatch(/^#w=/);
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
});
