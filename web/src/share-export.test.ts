import { describe, expect, it } from "vitest";
import * as pako from "pako";
import { decodeExport, encodeExport, type ExportedWorkspace } from "./share";
import type { WorkspaceEntry } from "./share";

function makeWorkspace(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    name: "Workspace 1",
    id: "some-uuid",
    version: 3,
    subgraphs: [{ name: "users", sdl: "type Query { me: String }" }],
    activeSubgraph: 0,
    queryTabs: [{ name: "Query 1", query: "query { me }" }],
    activeQueryTab: 0,
    seed: 42,
    mockConfig: "",
    tourDraft: null,
    ...overrides,
  };
}

describe("encodeExport / decodeExport", () => {
  it("round-trips a set of workspaces, stripping id/version", () => {
    const workspaces = [
      makeWorkspace({ name: "Workspace 1" }),
      makeWorkspace({ name: "Workspace 2", seed: 7 }),
    ];
    const bytes = encodeExport(workspaces);
    const { format, skippedCount } = decodeExport(bytes);

    expect(skippedCount).toBe(0);
    expect(format.exportVersion).toBe(1);
    expect(typeof format.exportedAt).toBe("string");
    expect(format.workspaces).toHaveLength(2);
    for (const ws of format.workspaces) {
      expect(ws).not.toHaveProperty("id");
      expect(ws).not.toHaveProperty("version");
    }
    expect(format.workspaces[0].name).toBe("Workspace 1");
    expect(format.workspaces[1].name).toBe("Workspace 2");
    expect(format.workspaces[1].seed).toBe(7);
  });

  it("preserves a non-null tourDraft through the round-trip", () => {
    const tour = {
      title: "My tour",
      base: {
        subgraphs: [{ name: "users", sdl: "type Query { me: String }" }],
        queryTabs: [{ name: "Query 1", query: "query { me }" }],
        activeQueryTab: 0,
        seed: 42,
        mockConfig: "",
      },
      steps: [],
    };
    const workspaces = [makeWorkspace({ tourDraft: tour })];
    const { format } = decodeExport(encodeExport(workspaces));
    expect(format.workspaces[0].tourDraft).toEqual(tour);
  });

  it("keeps tourDraft null when the source workspace has none", () => {
    const workspaces = [makeWorkspace({ tourDraft: null })];
    const { format } = decodeExport(encodeExport(workspaces));
    expect(format.workspaces[0].tourDraft).toBeNull();
  });

  it("produces output starting with the gzip magic bytes", () => {
    const bytes = encodeExport([makeWorkspace()]);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it("accepts plain (non-gzip) UTF-8 JSON bytes as a backward-compat path", () => {
    const format = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      workspaces: [
        {
          name: "Plain workspace",
          subgraphs: [],
          activeSubgraph: 0,
          queryTabs: [],
          activeQueryTab: 0,
          seed: 1,
          mockConfig: "",
          tourDraft: null,
        } satisfies ExportedWorkspace,
      ],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(format));
    const { format: decoded, skippedCount } = decodeExport(bytes);
    expect(skippedCount).toBe(0);
    expect(decoded.workspaces[0].name).toBe("Plain workspace");
  });

  it("throws a friendly error on corrupt gzip", () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x00, 0x01, 0x02, 0x03]);
    expect(() => decodeExport(bytes)).toThrow(/not valid JSON/);
  });

  it("throws a friendly error on invalid (non-JSON) plain text", () => {
    const bytes = new TextEncoder().encode("not json at all");
    expect(() => decodeExport(bytes)).toThrow(/not valid JSON/);
  });

  it("throws when exportVersion is missing", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ workspaces: [] }));
    expect(() => decodeExport(bytes)).toThrow(/Unsupported export file version/);
  });

  it("throws when exportVersion is not 1", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ exportVersion: 2, workspaces: [] }));
    expect(() => decodeExport(bytes)).toThrow(/Unsupported export file version/);
  });

  it("throws when workspaces is missing", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ exportVersion: 1 }));
    expect(() => decodeExport(bytes)).toThrow(/missing workspaces/);
  });

  it("throws when workspaces is not an array", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ exportVersion: 1, workspaces: "nope" }),
    );
    expect(() => decodeExport(bytes)).toThrow(/missing workspaces/);
  });

  it("drops malformed individual entries and reports skippedCount without throwing", () => {
    const format = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      workspaces: [
        {
          name: "Valid",
          subgraphs: [],
          queryTabs: [],
        },
        { name: "Missing subgraphs/queryTabs" },
        { subgraphs: [], queryTabs: [] }, // missing name
      ],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(format));
    const { format: decoded, skippedCount } = decodeExport(bytes);
    expect(skippedCount).toBe(2);
    expect(decoded.workspaces).toHaveLength(1);
    expect(decoded.workspaces[0].name).toBe("Valid");
    // Defaults applied for omitted optional fields.
    expect(decoded.workspaces[0].activeSubgraph).toBe(0);
    expect(decoded.workspaces[0].activeQueryTab).toBe(0);
    expect(decoded.workspaces[0].seed).toBe(42);
    expect(decoded.workspaces[0].mockConfig).toBe("");
    expect(decoded.workspaces[0].tourDraft).toBeNull();
  });
});

describe("pako sanity check", () => {
  it("pako.gzip output is detected by decodeExport's magic-byte sniff", () => {
    const bytes = pako.gzip(
      JSON.stringify({ exportVersion: 1, exportedAt: "now", workspaces: [] }),
    );
    const { format } = decodeExport(bytes);
    expect(format.workspaces).toEqual([]);
  });
});
