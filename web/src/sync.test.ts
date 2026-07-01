// Tests for web/src/sync.ts (TASK-88.6 + TASK-88.7 + TASK-88.8 + TASK-92)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeWorkspaces, deltaRefresh, initSync } from "./sync";

// Encryption is tested separately in encryption.test.ts.  Here we stub it out
// so sync tests are not sensitive to crypto.subtle timing (native thread-pool
// operations can't be awaited by vi.advanceTimersByTimeAsync).
vi.mock("./encryption", () => ({
  initEncryption: () => Promise.resolve(),
  getOrCreateKey: () => Promise.resolve({}),
  encrypt: (_key: unknown, text: string) => Promise.resolve(text),
  decrypt: (_key: unknown, text: string) => Promise.resolve(text),
}));
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
  subgraphs?: { name: string; sdl: string }[];
  updated_at?: number;
}) {
  return {
    id: overrides.id,
    name: overrides.name ?? "WS",
    payload: JSON.stringify({
      subgraphs: overrides.subgraphs ?? [{ name: "sg", sdl: "type Query { b: String }" }],
      queryTabs: [{ name: "Q1", query: "" }],
      activeQueryTab: 0,
      seed: 42,
      mockConfig: "",
    }),
    version: overrides.version ?? 1,
    updated_at: overrides.updated_at ?? Date.now(),
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

  it("remote newer: preserves the local activeSubgraph (session-only state)", () => {
    const id = "ws-sg";
    const subgraphs = [
      { name: "a", sdl: "type Query { a: String }" },
      { name: "b", sdl: "type Query { b: String }" },
    ];
    const local = [makeEntry({ id, version: 2, activeSubgraph: 1, subgraphs })];
    const remote = [makeRow({ id, version: 10, subgraphs })];
    const result = mergeWorkspaces(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe(10);
    // The user was editing subgraph index 1; sync must not snap them back to 0.
    expect(result[0].activeSubgraph).toBe(1);
  });

  it("remote newer: clamps activeSubgraph when remote removed subgraphs", () => {
    const id = "ws-sg-clamp";
    const local = [
      makeEntry({
        id,
        version: 2,
        activeSubgraph: 2,
        subgraphs: [
          { name: "a", sdl: "" },
          { name: "b", sdl: "" },
          { name: "c", sdl: "" },
        ],
      }),
    ];
    // Remote now has only one subgraph; the stale index 2 must clamp to 0.
    const remote = [makeRow({ id, version: 10, subgraphs: [{ name: "a", sdl: "" }] })];
    const result = mergeWorkspaces(local, remote);
    expect(result[0].activeSubgraph).toBe(0);
  });

  it("remote-only workspace (no local entry) defaults activeSubgraph to 0", () => {
    const remote = [makeRow({ id: "remote-only", version: 1 })];
    const result = mergeWorkspaces([], remote);
    expect(result[0].activeSubgraph).toBe(0);
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
    // Resetting lastPullAttemptTs via a module-level setter trick isn't
    // straightforward across tests; instead we advance fake time past the
    // throttle window.
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
      .mockResolvedValue(
        new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
      );
    // Advance time well past the 30 s throttle window
    vi.setSystemTime(new Date(Date.now() + 60_000));
    await deltaRefresh();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deltaRefresh — server cursor contract (TASK-94.2)
// ---------------------------------------------------------------------------

describe("deltaRefresh server cursor contract", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AC #1: a client clock skewed +10 minutes does not change the since= sent on the next pull", async () => {
    useAuth.setState({ status: "authed" });
    const serverCursor = Date.now();
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((url: RequestInfo | URL) => {
      urls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ workspaces: [], cursor: serverCursor }), { status: 200 }),
      );
    });

    // First pull (force=true bypasses the 15 s throttle) — the client learns
    // the server-issued cursor.
    await deltaRefresh(true);

    // Client clock skews forward by 10 minutes before the next pull.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 10 * 60_000));

    await deltaRefresh(true);

    // The second request's since= must equal the server cursor returned by
    // the first response, never a client-derived (skewed) Date.now() value.
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain(`since=${serverCursor}`);
    expect(urls[1]).not.toContain(`since=${serverCursor + 10 * 60_000}`);
  });

  it("AC #2: a row landing exactly on the previous cursor is not missed on the next pull", async () => {
    useAuth.setState({ status: "authed" });
    const firstCursor = Date.now();
    const urls: string[] = [];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((url: RequestInfo | URL) => {
      urls.push(String(url));
      call++;
      if (call === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: firstCursor }), { status: 200 }),
        );
      }
      // Second pull: the server delivers a row whose updated_at lands exactly
      // on the cursor the first pull returned — proxying the server's
      // inclusive `>=` boundary guarantee (functions/_lib/db.ts) through the
      // client flow. This row must not be dropped just because it shares the
      // exact cursor timestamp.
      return Promise.resolve(
        new Response(
          JSON.stringify({
            workspaces: [makeRow({ id: "ws-race", version: 2, updated_at: firstCursor })],
            cursor: firstCursor + 1,
          }),
          { status: 200 },
        ),
      );
    });

    await deltaRefresh(true);
    await deltaRefresh(true);

    // The second request must have echoed back the exact first cursor.
    expect(urls[1]).toContain(`since=${firstCursor}`);
    // And the boundary-equal row must have been merged into the store.
    const { workspaces } = useWorkspace.getState();
    expect(workspaces.some((w) => w.id === "ws-race")).toBe(true);
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
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      });

    cleanup = initSync();

    const ws = makeEntry({ id: "ws-1", name: "Initial" });
    useWorkspace.setState({ workspaces: [ws] });

    // Trigger three rapid changes
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Change 1" }] });
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Change 2" }] });
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Change 3" }] });

    // Advance time past the 2 s debounce (but not the 20 s poll interval)
    await vi.advanceTimersByTimeAsync(3_000);

    const putCalls = (fetchSpy.mock.calls as unknown as [string, { method?: string }][]).filter(
      ([, opts]) => opts?.method === "PUT",
    );
    expect(putCalls.length).toBe(1);
  });

  it("two edits faster than the mocked round-trip get distinct increasing versions and never lose the newer edit", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    const wsId = "ws-race";
    const putBodies: { version: number; name: string }[] = [];
    const resolvers: ((res: Response) => void)[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "PUT") {
          putBodies.push(JSON.parse(opts.body as string));
          // Never resolves on its own — the test resolves it manually, to
          // simulate a save whose round-trip is slower than the next edit.
          return new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          });
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    const ws = makeEntry({ id: wsId, name: "Initial", version: 1 });
    useWorkspace.setState({ workspaces: [ws] });

    // First edit: advance past the debounce so autoSave fires and its PUT is
    // sent, but leave the response unresolved (in-flight).
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Edit 1" }] });
    await vi.advanceTimersByTimeAsync(2_100);

    // Second edit fires while the first request is still pending.
    const afterFirstBump = useWorkspace.getState().workspaces.find((w) => w.id === wsId);
    useWorkspace.setState({ workspaces: [{ ...afterFirstBump!, name: "Edit 2" }] });
    await vi.advanceTimersByTimeAsync(2_100);

    // AC #1: a burst of rapid edits produces distinct, monotonically
    // increasing versions in what's actually sent over the wire — never the
    // same version twice.
    expect(putBodies.map((b) => b.version)).toEqual([2, 3]);

    // Resolve the responses out of order: the newer (second) request's
    // response arrives before the older (first) request's stale response.
    resolvers[1](
      new Response(
        JSON.stringify({ workspace: makeRow({ id: wsId, version: 3, name: "Edit 2" }) }),
        {
          status: 200,
        },
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0](
      new Response(
        JSON.stringify({ workspace: makeRow({ id: wsId, version: 2, name: "Edit 1" }) }),
        {
          status: 200,
        },
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    // AC #2: no save silently overwrites a newer local edit — the late
    // arriving stale (version 2) response must not roll the store back.
    const finalWs = useWorkspace.getState().workspaces.find((w) => w.id === wsId);
    expect(finalWs?.version).toBe(3);
    expect(finalWs?.name).toBe("Edit 2");
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

    // Advance past the 2 s debounce (not the 20 s poll interval)
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// initSync — onLogin propagates workspace deletions (TASK-92)
// ---------------------------------------------------------------------------

describe("initSync onLogin", () => {
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

  it("deleted workspace is removed from store on login", async () => {
    // Simulate a workspace that was previously synced at version 2.
    const wsId = "ws-deleted";
    const ws = makeEntry({ id: wsId, name: "Workspace A", version: 2 });
    useWorkspace.setState({ workspaces: [ws], activeWorkspaceIndex: 0 });

    // Server returns the row with deleted_at set (soft-deleted by another client).
    vi.spyOn(globalThis, "fetch").mockImplementation((_url: RequestInfo | URL) => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            workspaces: [makeRow({ id: wsId, deleted_at: Date.now() })],
            cursor: Date.now(),
          }),
          { status: 200 },
        ),
      );
    });

    cleanup = initSync();
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    // Advance fake time by 100 ms (well under the 20 s poll interval) to flush
    // all Promise microtasks from the onLogin chain without triggering the
    // setInterval polling loop (vi.runAllTimersAsync would loop forever).
    await vi.advanceTimersByTimeAsync(100);

    const { workspaces } = useWorkspace.getState();
    // The deleted workspace must be gone.
    expect(workspaces.some((w) => w.id === wsId)).toBe(false);
    // The store must never be empty (fallback workspace provided).
    expect(workspaces.length).toBeGreaterThanOrEqual(1);
  });

  it("local-only workspace is pushed to server on login", async () => {
    // Workspace exists locally but has never been on the server.
    const wsId = "ws-local-only";
    const ws = makeEntry({ id: wsId, name: "Local Only", version: 1 });
    useWorkspace.setState({ workspaces: [ws], activeWorkspaceIndex: 0 });

    let putCalled = false;
    const serverRow = makeRow({ id: wsId, version: 1 });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if ((opts as RequestInit)?.method === "PUT") {
          putCalled = true;
          return Promise.resolve(
            new Response(JSON.stringify({ workspace: serverRow }), { status: 200 }),
          );
        }
        // pullWorkspaces(0) returns nothing — server has no workspaces yet.
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(putCalled).toBe(true);
  });

  it("activeWorkspaceIndex is clamped when a workspace is removed by deltaRefresh", async () => {
    // Two workspaces, active is the second one (index 1).
    const ws1 = makeEntry({ id: "ws-a", name: "WS A", version: 1 });
    const ws2 = makeEntry({ id: "ws-b", name: "WS B", version: 1 });
    useWorkspace.setState({ workspaces: [ws1, ws2], activeWorkspaceIndex: 1 });
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    // Delta response soft-deletes ws-b.
    vi.spyOn(globalThis, "fetch").mockImplementation((_url: RequestInfo | URL) => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            workspaces: [makeRow({ id: "ws-b", deleted_at: Date.now() })],
            cursor: Date.now(),
          }),
          { status: 200 },
        ),
      );
    });

    // force=true bypasses the 15 s throttle.
    await deltaRefresh(true);

    const state = useWorkspace.getState();
    expect(state.workspaces.some((w) => w.id === "ws-b")).toBe(false);
    // Index must have been clamped from 1 → 0 (only ws-a remains).
    expect(state.activeWorkspaceIndex).toBe(0);
    expect(state.activeWorkspaceIndex).toBeLessThan(state.workspaces.length);
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
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    const ws = makeEntry({ id: "ws-loop", name: "WS" });
    useWorkspace.setState({ workspaces: [ws] });
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Changed" }] });

    // Advance past the 2 s debounce (not the 20 s poll interval)
    await vi.advanceTimersByTimeAsync(3_000);

    // The server-side update triggers a store.setState inside isSyncing=true,
    // so no new debounced save should be queued. Expect exactly 1 PUT.
    expect(putCount).toBe(1);
  });
});
