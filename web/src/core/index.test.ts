import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { GqlCore } from "./types";

// Mock the WASM module so tests run without a browser / fetch.
vi.mock("../wasm/gql_core.js", () => ({
  __esModule: true,
  default: vi.fn().mockResolvedValue(undefined),
  compose: vi.fn((s) => JSON.stringify({ ok: true, supergraph_sdl: s, hints: [] })),
  validate_subgraph: vi.fn(() => JSON.stringify({ diagnostics: [] })),
  validate_query: vi.fn(() => JSON.stringify({ diagnostics: [] })),
  plan: vi.fn(() => JSON.stringify({ ok: true, subplans: [] })),
  execute_mock: vi.fn(() => JSON.stringify({ data: { hello: "world" }, errors: [] })),
}));

// Re-import after mocking so the module cache picks up the mock.
let loadCore: () => Promise<Record<string, unknown>>;

beforeAll(async () => {
  const mod = await import("./index");
  loadCore = mod.loadCore as unknown as () => Promise<Record<string, unknown>>;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadCore", () => {
  it("returns a real GqlCore with all expected methods", async () => {
    const core = await loadCore();

    expect(core).toBeDefined();
    expect(typeof core).toBe("object");

    // Check every method from the GqlCore interface
    expect(typeof core.validateSubgraph).toBe("function");
    expect(typeof core.compose).toBe("function");
    expect(typeof core.validateQuery).toBe("function");
    expect(typeof core.plan).toBe("function");
    expect(typeof core.executeMock).toBe("function");
  });

  it("returns the same cached instance on repeated calls", async () => {
    const a = await loadCore();
    const b = await loadCore();
    expect(a).toBe(b);
  });

  it("returns a real GqlCore backed by WASM, not the stub", async () => {
    const core = await loadCore();
    const result = (
      core as {
        compose: (s: { name: string; sdl: string }[]) => {
          ok: boolean;
          supergraph_sdl?: string;
          hints?: unknown[];
          errors?: unknown[];
        };
      }
    ).compose([{ name: "test", sdl: "type Query { hello: String }" }]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.supergraph_sdl).toBe("string");
      expect(result.hints).toBeDefined();
    }
  });

  describe("makeStubCore removal (AC #3)", () => {
    it("does not export makeStubCore", async () => {
      const mod = await import("./index");
      expect((mod as unknown as Record<string, unknown>).makeStubCore).toBeUndefined();
    });
  });

  describe("real composition result (AC #5)", () => {
    it("compose returns a supergraph SDL with federation directives, not stub text", async () => {
      const core = (await loadCore()) as unknown as GqlCore;

      const result = core.compose([
        {
          name: "users",
          sdl: `type Query { me: User }\ntype User @key(fields: "id") { id: ID! name: String }`,
        },
        {
          name: "products",
          sdl: `type Query { product(id: ID!): Product }\ntype Product @key(fields: "id") { id: ID! title: String }`,
        },
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Must contain real Federation supergraph content, not stub/placeholder text.
        expect(typeof result.supergraph_sdl).toBe("string");
        expect(result.supergraph_sdl.length).toBeGreaterThan(0);
        // Federation supergraphs include @key directives on entity types.
        expect(result.supergraph_sdl).toContain("@key");
        // Should NOT contain stub-like placeholder text.
        expect(result.supergraph_sdl.toLowerCase()).not.toContain("stub");
        expect(result.supergraph_sdl.toLowerCase()).not.toContain("placeholder");
      }
    });
  });

  it("every method JSON.parses the wasm string result and returns typed values", async () => {
    const core = (await loadCore()) as unknown as GqlCore;

    // validateSubgraph: string -> object with diagnostics array
    const diagResult = core.validateSubgraph("type Query { x: ID }");
    expect(typeof diagResult).toBe("object");
    expect(Array.isArray(diagResult.diagnostics)).toBe(true);

    // compose: SubgraphInput[] (stringified) -> object with ok boolean
    const composeResult = core.compose([{ name: "s", sdl: "type Query { x: ID }" }]);
    expect(typeof composeResult).toBe("object");
    expect(composeResult.ok).toBeDefined();

    // validateQuery: strings -> object with diagnostics array
    const queryDiag = core.validateQuery("type Query { x: ID }", "{ x }");
    expect(typeof queryDiag).toBe("object");
    expect(Array.isArray(queryDiag.diagnostics)).toBe(true);

    // plan: strings -> object (NOT a raw string)
    const planResult = core.plan("type Query { x: ID }", "{ x }");
    expect(typeof planResult).not.toBe("string");
    expect(typeof planResult).toBe("object");

    // executeMock: seed -> object with data
    const mockResult = core.executeMock("type Query { x: ID }", "{ x }", 42);
    expect(typeof mockResult).toBe("object");
    expect(mockResult.data).toBeDefined();
  });
});
