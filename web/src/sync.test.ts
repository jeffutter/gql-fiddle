// Tests for web/src/sync.ts (TASK-88.6 + TASK-88.7 + TASK-88.8)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeWorkspaces, deltaRefresh, initSync } from "./sync";
import { useAuth } from "./auth";
import { useWorkspace } from "./store";
import type { WorkspaceEntry } from "./share";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<WorkspaceEntry> & { id: string }): WorkspaceEntry {
  return {
    name: "WS",
    version: 1,
    subgraphs: [{ name: "sg", sdl: "type Query { a: String }" }],
    activeSubgraph: 0,
    queryTabs: [{ name: "Q1", query: "" }],
    activeQueryTab: 0,
    seed: 42,
    mockConfig: "",
    tourDraft: null,
    ...overrides,
  };
}

function makeRow(overrides: {
  id: string;
  version?: number;
  name?: string;
  deleted_at?: number | null;
}) {
  return {
    id: overrides.id,
    name: overrides.name ?? "WS",
    payload: JSON.stringify({
      subgraphs: [{ name: "sg", sdl: "type Query { b: String }" }],
      queryTabs: [{ name: "Q1", query: "" }],
      activeQueryTab: 0,
      seed: 42,
      mockConfig: "",
    }),
    version: overrides.version ?? 1,
    updated_at: Date.now(),
    deleted_at: overrides.deleted_at ?? null,
  };
}

function resetStores() {
  useAuth.setState({ user: null, status: "loading", syncStatus: "synced" });
  // Reset workspace store to a fresh default
  useWorkspace.setState({
    workspaces: [makeEntry({ id: crypto.randomUUID(), name: "Workspace 1" })],
    activeWorkspaceIndex: 0,
    supergraphSdl: null,
    composeErrors: null,
    composeHints: 0,
  });
}

// ---------------------------------------------------------------------------
// mergeWorkspaces — pure function tests
// ---------------------------------------------------------------------------

describe("mergeWorkspaces", () => {
  it("local newer: keeps local when local.version > row.version", () => {
    const id = "ws-1";
    const local = [makeEntry({ id, version: 5, name: "local" })];
    const remote = [makeRow({ id, version: 3, name: "remote" })];
    const result = mergeWorkspaces(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("local");
    expect(result[0].version).toBe(5);
  });

  it("remote newer: adopts remote when row.version > local.version", () => {
    const id = "ws-2";
    const local = [makeEntry({ id, version: 2, name: "local" })];
    const remote = [makeRow({ id, version: 10, name: "remote-newer" })];
    const result = mergeWorkspaces(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe(10);
  });

  it("remote soft-delete removes the entry from the merged result", () => {
    const id = "ws-3";
    const local = [makeEntry({ id, version: 1 })];
    const remote = [makeRow({ id, deleted_at: Date.now() })];
    const result = mergeWorkspaces(local, remote);
    expect(result).toHaveLength(0);
  });

  it("local-only workspace (no matching remote row) is preserved", () => {
    const local = [makeEntry({ id: "local-only-id", version: 1, name: "Local only" })];
    const remote: ReturnType<typeof makeRow>[] = [];
    const result = mergeWorkspaces(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("local-only-id");
  });

  it("version tie: local wins (remote version === local version → keep local)", () => {
    const id = "ws-tie";
    const local = [makeEntry({ id, version: 3, name: "local-tie" })];
    const remote = [makeRow({ id, version: 3, name: "remote-tie" })];
    const result = mergeWorkspaces(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("local-tie");
  });

  it("merges correctly with multiple workspaces", () => {
    const local = [
      makeEntry({ id: "a", version: 1, name: "A local" }),
      makeEntry({ id: "b", version: 5, name: "B local newer" }),
      makeEntry({ id: "c", version: 1, name: "C local only" }),
    ];
    const remote = [
      makeRow({ id: "a", version: 3, name: "A remote newer" }),
      makeRow({ id: "b", version: 2, name: "B remote older" }),
      makeRow({ id: "d", version: 1, name: "D remote only" }),
    ];
    const result = mergeWorkspaces(local, remote);
    const byId = Object.fromEntries(result.map((w) => [w.id, w]));
    // A: remote newer → remote
    expect(byId["a"].version).toBe(3);
    // B: local newer → local
    expect(byId["b"].name).toBe("B local newer");
    // C: local only → preserved
    expect(byId["c"]).toBeDefined();
    // D: remote only → adopted
    expect(byId["d"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// deltaRefresh — throttle test
// ---------------------------------------------------------------------------

describe("deltaRefresh throttle", () => {
  beforeEach(() => {
    resetStores();
    // Reset lastPullTs by calling module-level setter trick via re-import
    // is not straightforward; instead we advance fake time past the throttle.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call fetch when status is not authed", async () => {
    useAuth.setState({ status: "anonymous" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await deltaRefresh();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls fetch when authed (if throttle has passed)", async () => {
    useAuth.setState({ status: "authed" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ workspaces: [] }), { status: 200 }));
    // Advance time well past the 30 s throttle window
    vi.setSystemTime(new Date(Date.now() + 60_000));
    await deltaRefresh();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// initSync — debounce test
// ---------------------------------------------------------------------------

describe("initSync auto-save debounce", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("three rapid store updates produce at most one fetch PUT after 300 ms", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    const serverRow = makeRow({ id: "ws-1" });
    // Use mockImplementation to return a fresh Response each call (body can only be read once).
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url: RequestInfo | URL, opts?: RequestInit) => {
        if ((opts as RequestInit)?.method === "PUT") {
          return Promise.resolve(
            new Response(JSON.stringify({ workspace: serverRow }), { status: 200 }),
          );
        }
        // GET calls (delta refresh polling, etc.)
        return Promise.resolve(new Response(JSON.stringify({ workspaces: [] }), { status: 200 }));
      });

    cleanup = initSync();

    const ws = makeEntry({ id: "ws-1", name: "Initial" });
    useWorkspace.setState({ workspaces: [ws] });

    // Trigger three rapid changes
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Change 1" }] });
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Change 2" }] });
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Change 3" }] });

    // Advance time past the 300 ms debounce (but not the 60 s poll interval)
    await vi.advanceTimersByTimeAsync(500);

    const putCalls = (fetchSpy.mock.calls as unknown as [string, { method?: string }][]).filter(
      ([, opts]) => opts?.method === "PUT",
    );
    expect(putCalls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// initSync — anonymous mode makes no API calls
// ---------------------------------------------------------------------------

describe("initSync anonymous mode", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not call fetch when status is anonymous", async () => {
    useAuth.setState({ status: "anonymous" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    cleanup = initSync();

    const ws = makeEntry({ id: "ws-anon", name: "Anon WS" });
    useWorkspace.setState({ workspaces: [ws] });
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Changed" }] });

    // Advance past the 300 ms debounce (not the 60 s poll interval)
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// initSync — no sync loop (isSyncing flag)
// ---------------------------------------------------------------------------

describe("initSync no sync loop", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a store update caused by auto-save does not re-queue a new debounced save", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    let putCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if ((opts as RequestInit)?.method === "PUT") {
          putCount++;
          // Simulate server returning the row back — which will update store
          const serverRow = makeRow({ id: "ws-loop", version: 2 });
          return Promise.resolve(
            new Response(JSON.stringify({ workspace: serverRow }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ workspaces: [] }), { status: 200 }));
      },
    );

    cleanup = initSync();

    const ws = makeEntry({ id: "ws-loop", name: "WS" });
    useWorkspace.setState({ workspaces: [ws] });
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Changed" }] });

    // Advance past the 300 ms debounce (not the 60 s poll interval)
    await vi.advanceTimersByTimeAsync(500);

    // The server-side update triggers a store.setState inside isSyncing=true,
    // so no new debounced save should be queued. Expect exactly 1 PUT.
    expect(putCount).toBe(1);
  });
});
