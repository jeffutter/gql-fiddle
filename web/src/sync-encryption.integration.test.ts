// Integration test: verifies that the sync engine sends AES-GCM ciphertext
// (CE1: prefix) to the server, not plaintext. This file intentionally omits
// vi.mock("./encryption") so real Web Crypto operations run. The sync.test.ts
// suite mocks encryption to avoid crypto/fake-timer timing issues; this file
// uses real timers and vi.waitFor instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSync } from "./sync";
import { useAuth } from "./auth";
import { useWorkspace } from "./store";
import type { WorkspaceEntry } from "./share";
import { encrypt } from "./encryption";

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

function toB64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

// Clears every cached-DEK entry (namespaced by user id, e.g.
// "gql-fiddle-dek:u1" / "gql-fiddle-dek:anon") regardless of which users a
// test logged in as, so each test starts with no local key.
function clearAllCachedDeks(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("gql-fiddle-dek:")) localStorage.removeItem(key);
  }
}

// Wraps a known DEK with a known KWK, mirroring the format initEncryption()
// expects from the server's wrapped_dek field.
async function wrapDek(kwkBytes: Uint8Array, dekBytes: Uint8Array): Promise<string> {
  const kwk = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(kwkBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      kwk,
      new TextEncoder().encode(toB64(dekBytes)),
    ),
  );
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv);
  combined.set(enc, 12);
  return toB64(combined);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("sync + encryption integration", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    // Clear the DEK cache so each test starts with no local key.
    clearAllCachedDeks();

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
    clearAllCachedDeks();
  });

  it("workspace name and payload pushed to server are CE1:-prefixed ciphertext", async () => {
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
        // enc-meta PUT: accept the wrapped DEK and echo it back (this device
        // is alone, so it "wins" per the server's setWrappedDekIfAbsent contract)
        if (urlStr.includes("/api/auth/enc-meta") && method === "PUT") {
          const body = JSON.parse((opts?.body as string) ?? "{}") as {
            wrapped_dek: string;
          };
          return Promise.resolve(Response.json({ wrapped_dek: body.wrapped_dek }, { status: 200 }));
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
      expect(body.name).toMatch(/^CE1:/);
      expect(body.payload).toMatch(/^CE1:/);
    }
  });

  it("debounced auto-save also sends CE1:-prefixed ciphertext", async () => {
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
          const body = JSON.parse((opts?.body as string) ?? "{}") as {
            wrapped_dek: string;
          };
          return Promise.resolve(Response.json({ wrapped_dek: body.wrapped_dek }, { status: 200 }));
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

    expect(capturedPuts[0].name).toMatch(/^CE1:/);
    expect(capturedPuts[0].payload).toMatch(/^CE1:/);
  });

  it("skips a row that fails to decrypt instead of surfacing its ciphertext", async () => {
    const kwkBytes = crypto.getRandomValues(new Uint8Array(32));
    const kwkB64 = toB64(kwkBytes);
    const dekBytes = crypto.getRandomValues(new Uint8Array(32));
    const wrappedDek = await wrapDek(kwkBytes, dekBytes);
    const dek = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(dekBytes),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );

    const validPayload = JSON.stringify({
      subgraphs: [],
      queryTabs: [{ name: "Q1", query: "{ a }" }],
      activeQueryTab: 0,
      seed: 1,
      mockConfig: "",
    });
    const validName = await encrypt(dek, "Valid Workspace");
    const validEncPayload = await encrypt(dek, validPayload);

    // Corrupt row: valid CE1: prefix, but the ciphertext body is tampered
    // with so AES-GCM auth fails — simulates wrong key / tampering.
    const corruptCiphertext = await encrypt(dek, "Secret Workspace Name");
    const corruptName = corruptCiphertext.slice(0, -4) + "AAAA";
    const corruptPayload = await encrypt(dek, validPayload);

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        const urlStr = String(url);
        const method = opts?.method ?? "GET";

        if (urlStr.includes("/api/auth/enc-meta") && method !== "PUT") {
          return Promise.resolve(
            new Response(JSON.stringify({ kwk: kwkB64, wrapped_dek: wrappedDek }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (urlStr.includes("/api/workspaces") && method === "GET") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                workspaces: [
                  {
                    id: "valid-id",
                    name: validName,
                    payload: validEncPayload,
                    version: 1,
                    updated_at: 0,
                    deleted_at: null,
                  },
                  {
                    id: "corrupt-id",
                    name: corruptName,
                    payload: corruptPayload,
                    version: 1,
                    updated_at: 0,
                    deleted_at: null,
                  },
                ],
                cursor: 1,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ workspaces: [] }), { status: 200 }));
      },
    );

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    cleanup = initSync();

    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    await vi.waitFor(() => expect(useAuth.getState().syncStatus).toBe("synced"), {
      timeout: 5000,
    });

    const workspaces = useWorkspace.getState().workspaces;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].id).toBe("valid-id");
    expect(workspaces[0].name).toBe("Valid Workspace");

    // The corrupted row's ciphertext must never appear anywhere in state.
    const serialized = JSON.stringify(workspaces);
    expect(serialized).not.toContain(corruptName);
    expect(serialized).not.toContain(corruptCiphertext);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("skipping workspace corrupt-id"),
      expect.anything(),
    );
  });
});
