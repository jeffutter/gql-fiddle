// Integration test: verifies that the sync engine sends AES-GCM ciphertext
// (E1: prefix) to the server, not plaintext. This file intentionally omits
// vi.mock("./encryption") so real Web Crypto operations run. The sync.test.ts
// suite mocks encryption to avoid crypto/fake-timer timing issues; this file
// uses real timers and vi.waitFor instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSync } from "./sync";
import { useAuth } from "./auth";
import { useWorkspace } from "./store";
import type { WorkspaceEntry } from "./share";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<WorkspaceEntry> & { id: string }): WorkspaceEntry {
  return {
    name: "Secret Workspace",
    version: 1,
    subgraphs: [{ name: "sg", sdl: "type Query { a: String }" }],
    activeSubgraph: 0,
    queryTabs: [{ name: "Q1", query: "{ a }" }],
    activeQueryTab: 0,
    seed: 42,
    mockConfig: "",
    tourDraft: null,
    ...overrides,
  };
}

function freshKwk(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("sync + encryption integration", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    // Clear the DEK cache so each test starts with no local key.
    localStorage.removeItem("gql-fiddle-dek");

    useAuth.setState({ user: null, status: "loading", syncStatus: "synced" });
    useWorkspace.setState({
      workspaces: [],
      activeWorkspaceIndex: 0,
      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,
    });
  });

  afterEach(() => {
    cleanup?.();
    vi.restoreAllMocks();
    localStorage.removeItem("gql-fiddle-dek");
  });

  it("workspace name and payload pushed to server are E1:-prefixed ciphertext", async () => {
    const kwk = freshKwk();
    const capturedPuts: Array<{ name: string; payload: string; version: number }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        const urlStr = String(url);
        const method = opts?.method ?? "GET";

        // enc-meta GET: return a fresh KWK with no wrapped DEK yet
        if (urlStr.includes("/api/auth/enc-meta") && method !== "PUT") {
          return Promise.resolve(
            new Response(JSON.stringify({ kwk, wrapped_dek: null }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        // enc-meta PUT: accept the wrapped DEK (returns 204)
        if (urlStr.includes("/api/auth/enc-meta") && method === "PUT") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        // workspaces GET: empty list (first login — no server-side workspaces yet)
        if (urlStr.includes("/api/workspaces") && method === "GET") {
          return Promise.resolve(
            new Response(JSON.stringify({ workspaces: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        // workspaces PUT: capture the body, return a server row
        if (urlStr.includes("/api/workspaces/") && method === "PUT") {
          const body = JSON.parse((opts?.body as string) ?? "{}") as {
            name: string;
            payload: string;
            version: number;
          };
          capturedPuts.push(body);
          const serverRow = {
            id: urlStr.split("/").pop(),
            name: body.name,
            payload: body.payload,
            version: body.version,
            updated_at: 0,
            deleted_at: null,
          };
          return Promise.resolve(
            new Response(JSON.stringify({ workspace: serverRow }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        // Fallback: empty workspaces list for any other GET
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );

    // Prime the workspace store with one entry — it will be pushed as
    // local-only during onLogin (the remote list is empty).
    const ws = makeEntry({ id: crypto.randomUUID() });
    useWorkspace.setState({ workspaces: [ws] });

    cleanup = initSync();

    // Transitioning to "authed" triggers onLogin → initEncryption → push
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    // Wait for the workspace PUT to be captured (real timers, real crypto).
    await vi.waitFor(() => expect(capturedPuts.length).toBeGreaterThan(0), {
      timeout: 5000,
    });

    // Both name and payload must be AES-GCM ciphertext, not plaintext.
    for (const body of capturedPuts) {
      expect(body.name).toMatch(/^E1:/);
      expect(body.payload).toMatch(/^E1:/);
    }
  });

  it("debounced auto-save also sends E1:-prefixed ciphertext", async () => {
    const kwk = freshKwk();
    const capturedPuts: Array<{ name: string; payload: string }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        const urlStr = String(url);
        const method = opts?.method ?? "GET";

        if (urlStr.includes("/api/auth/enc-meta") && method !== "PUT") {
          return Promise.resolve(
            new Response(JSON.stringify({ kwk, wrapped_dek: null }), { status: 200 }),
          );
        }
        if (urlStr.includes("/api/auth/enc-meta") && method === "PUT") {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (urlStr.includes("/api/workspaces/") && method === "PUT") {
          const body = JSON.parse((opts?.body as string) ?? "{}") as {
            name: string;
            payload: string;
          };
          capturedPuts.push(body);
          const serverRow = {
            id: urlStr.split("/").pop(),
            name: body.name,
            payload: body.payload,
            version: 2,
            updated_at: 0,
            deleted_at: null,
          };
          return Promise.resolve(
            new Response(JSON.stringify({ workspace: serverRow }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ workspaces: [] }), { status: 200 }));
      },
    );

    cleanup = initSync();

    // Log in with an empty workspace list so onLogin doesn't push anything.
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    // Wait for onLogin (initEncryption) to complete before making a workspace change.
    await vi.waitFor(() => expect(useAuth.getState().syncStatus).toBe("synced"), {
      timeout: 5000,
    });

    // Trigger a debounced save by adding a workspace.
    const ws = makeEntry({ id: crypto.randomUUID(), name: "My Sensitive Schema" });
    useWorkspace.setState({ workspaces: [ws] });

    // Wait for the debounce (300 ms) + autoSave to fire.
    await vi.waitFor(() => expect(capturedPuts.length).toBeGreaterThan(0), {
      timeout: 5000,
    });

    expect(capturedPuts[0].name).toMatch(/^E1:/);
    expect(capturedPuts[0].payload).toMatch(/^E1:/);
  });
});
