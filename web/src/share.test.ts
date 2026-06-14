import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as pako from "pako";
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
    expect(decoded.queryTabs[0].variables).toBe('{"limit":3}');
    expect(decoded.activeQueryTab).toBe(0);
    expect(decoded.seed).toBe(55);
  });

  it("encoded payload contains only URL-safe characters (no +, /, or =)", () => {
    const encoded = encode(SAMPLE_PAYLOAD);
    const payload = encoded.slice("#w=".length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// ------------------------------------------------------------------- zstd benchmark (AC #1)

/**
 * A realistic workspace payload: two federated subgraph SDLs + one query.
 * This is the kind of data that actually gets share-encoded in production.
 */
const REALISTIC_PAYLOAD = JSON.stringify({
  subgraphs: [
    {
      name: "products",
      sdl: `
type Query { products: [Product!]! }

type Product @key(fields: "id") {
  id: ID!
  name: String!
  description: String
  price: Float!
  category: Category
  reviews: [Review!]!
}

type Category {
  id: ID!
  name: String!
  products: [Product!]!
}
`,
    },
    {
      name: "reviews",
      sdl: `
type Product @key(fields: "id") {
  id: ID!
  reviews: [Review!] @provides(fields: "name description")
}

type Review @key(fields: "id") {
  id: ID!
  rating: Int!
  comment: String
  author: _Entity! @external
  product: Product! @external
}
`,
    },
  ],
  queryTabs: [
    {
      name: "List Products",
      query: `query GetProducts {
  products {
    id
    name
    price
    category { name }
  }
}`,
      variables: "{}",
    },
  ],
  activeQueryTab: 0,
  seed: 42,
});

describe("zstd vs gzip compression benchmark (AC #1)", () => {
  it("benchmarks zstd vs gzip on a realistic workspace payload", () => {
    // Gzip via pako
    const gzipBytes = pako.gzip(REALISTIC_PAYLOAD);
    const gzipSize = gzipBytes.length;
    const gzipRatio = (REALISTIC_PAYLOAD.length / gzipSize).toFixed(2);

    // zstd via CLI tool (available in the nix dev shell)
    const tmpFile = join(tmpdir(), `zstd-bench-${Date.now()}.json`);
    try {
      writeFileSync(tmpFile, REALISTIC_PAYLOAD, "utf-8");
      execSync(`zstd -f -q -o ${tmpFile}.zst ${tmpFile}`);
      const zstdStat = execSync(`stat -c %s ${tmpFile}.zst`).toString();
      const zstdSize = Number(zstdStat);
      const zstdRatio = (REALISTIC_PAYLOAD.length / zstdSize).toFixed(2);

      // Both algorithms should achieve meaningful compression on structured text.
      expect(Number(gzipRatio)).toBeGreaterThan(1.5);
      expect(Number(zstdRatio)).toBeGreaterThan(1.5);

      // Log the comparison for documentation (AC #1 deliverable).
      const winner = gzipSize <= zstdSize ? "gzip" : "zstd";
      const delta = Math.abs(gzipSize - zstdSize);
      console.log(
        `Compression benchmark on realistic payload (${REALISTIC_PAYLOAD.length} bytes):\n` +
          `  gzip: ${gzipSize} bytes  (ratio ${gzipRatio}x)\n` +
          `  zstd: ${zstdSize} bytes  (ratio ${zstdRatio}x)\n` +
          `  Winner: ${winner} by ${delta} bytes`,
      );
    } finally {
      try {
        execSync(`rm -f ${tmpFile} ${tmpFile}.zst`);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("reports compression ratios for both algorithms", () => {
    const gzipBytes = pako.gzip(REALISTIC_PAYLOAD);
    const gzipSize = gzipBytes.length;
    const gzipRatio = (REALISTIC_PAYLOAD.length / gzipSize).toFixed(2);

    const tmpFile = join(tmpdir(), `zstd-bench-ratio-${Date.now()}.json`);
    try {
      writeFileSync(tmpFile, REALISTIC_PAYLOAD, "utf-8");
      execSync(`zstd -f -q -o ${tmpFile}.zst ${tmpFile}`);
      const zstdStat = execSync(`stat -c %s ${tmpFile}.zst`).toString();
      const zstdSize = Number(zstdStat);
      const zstdRatio = (REALISTIC_PAYLOAD.length / zstdSize).toFixed(2);

      // Sanity: both should achieve at least 1.5x compression on structured text
      expect(Number(gzipRatio)).toBeGreaterThan(1.5);
      expect(Number(zstdRatio)).toBeGreaterThan(1.5);
    } finally {
      try {
        execSync(`rm -f ${tmpFile} ${tmpFile}.zst`);
      } catch {
        // ignore cleanup errors
      }
    }
  });
});
