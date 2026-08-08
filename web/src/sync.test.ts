// Tests for web/src/sync.ts (TASK-88.6 + TASK-88.7 + TASK-88.8 + TASK-92)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeWorkspaces,
  mergeSavedLibrary,
  useSavedWorkspaceLibrary,
  openSavedWorkspace,
  closeSavedWorkspace,
  renameSavedWorkspace,
  deleteSavedWorkspace,
  deltaRefresh,
  initSync,
} from "./sync";

// Encryption is tested separately in encryption.test.ts.  Here we stub it out
// so sync tests are not sensitive to crypto.subtle timing (native thread-pool
// operations can't be awaited by vi.advanceTimersByTimeAsync).
vi.mock("./encryption", () => ({
  initEncryption: () => Promise.resolve(),
  getOrCreateKey: () => Promise.resolve({}),
  encrypt: (_key: unknown, text: string) => Promise.resolve(text),
  // Conditional stub: a sentinel payload ("UNDECRYPTABLE") simulates a row
  // that fails to decrypt (wrong key / tampering) so individual tests can
  // opt a specific row into that failure mode without touching real crypto.
  decrypt: (_key: unknown, text: string) => {
    if (text === "UNDECRYPTABLE") {
      return Promise.reject(new Error("Failed to decrypt value"));
    }
    return Promise.resolve(text);
  },
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
  saved?: boolean;
  open?: boolean;
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
    // Matches the server's documented defaults (functions/_lib/db.ts /
    // AGENTS.md's Workspace API section): every non-deleted row is
    // implicitly open everywhere unless explicitly marked saved+closed.
    saved: overrides.saved ?? false,
    open: overrides.open ?? true,
  };
}

// A row whose name/payload both decrypt-fail via the mocked `decrypt` above
// — simulates a KWK/wrapped_dek mismatch or tampering (TASK-128.2).
function makeUndecryptableRow(id: string) {
  return {
    id,
    name: "UNDECRYPTABLE",
    payload: "UNDECRYPTABLE",
    version: 1,
    updated_at: Date.now(),
    deleted_at: null,
  };
}

function resetStores() {
  useAuth.setState({ user: null, status: "loading", syncStatus: "synced", decryptWarning: null });
  // Reset workspace store to a fresh default
  useWorkspace.setState({
    workspaces: [makeEntry({ id: crypto.randomUUID(), name: "Workspace 1" })],
    activeWorkspaceIndex: 0,
    supergraphSdl: null,
    composeErrors: null,
    composeHints: 0,
  });
  useSavedWorkspaceLibrary.setState({ entries: [] });
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

  it("excludes a closed saved workspace from the tab bar, even if previously present locally", () => {
    // Simulates another device closing a saved workspace: the local tab bar
    // still has it, but the remote row now says saved+closed and wins LWW.
    const id = "ws-closed";
    const local = [makeEntry({ id, version: 1, name: "Was open" })];
    const remote = [makeRow({ id, version: 2, saved: true, open: false })];
    const result = mergeWorkspaces(local, remote);
    expect(result.some((w) => w.id === id)).toBe(false);
  });

  it("does not remove a not-yet-pushed local change when the closed-saved remote row is stale", () => {
    // The local copy is already newer (e.g. the user just re-opened it here)
    // than what a slower remote pull reports — the local change must survive
    // until it reaches the server.
    const id = "ws-race";
    const local = [
      makeEntry({ id, version: 5, name: "Locally reopened", saved: true, open: true }),
    ];
    const remote = [makeRow({ id, version: 2, saved: true, open: false })];
    const result = mergeWorkspaces(local, remote);
    expect(result.some((w) => w.id === id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mergeSavedLibrary — pure function tests
// ---------------------------------------------------------------------------

describe("mergeSavedLibrary", () => {
  it("includes a closed saved workspace", () => {
    const remote = [makeRow({ id: "ws-lib", version: 1, saved: true, open: false })];
    const result = mergeSavedLibrary([], remote);
    expect(result.some((w) => w.id === "ws-lib")).toBe(true);
  });

  it("excludes an open saved workspace (currently open elsewhere)", () => {
    const remote = [makeRow({ id: "ws-open-elsewhere", version: 1, saved: true, open: true })];
    const result = mergeSavedLibrary([], remote);
    expect(result.some((w) => w.id === "ws-open-elsewhere")).toBe(false);
  });

  it("excludes a non-saved workspace", () => {
    const remote = [makeRow({ id: "ws-not-saved", version: 1, saved: false, open: false })];
    const result = mergeSavedLibrary([], remote);
    expect(result.some((w) => w.id === "ws-not-saved")).toBe(false);
  });

  it("remote soft-delete removes a previously-known library entry", () => {
    const id = "ws-lib-deleted";
    const local = [makeEntry({ id, version: 1, saved: true, open: false })];
    const remote = [makeRow({ id, deleted_at: Date.now(), saved: true, open: false })];
    const result = mergeSavedLibrary(local, remote);
    expect(result.some((w) => w.id === id)).toBe(false);
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
// decryptWarning — surfaced when pullWorkspaces reports skippedIds
// (TASK-128.2)
// ---------------------------------------------------------------------------

describe("decryptWarning", () => {
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

  it("onLogin sets decryptWarning when a pulled row fails to decrypt", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url: RequestInfo | URL) => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            workspaces: [makeRow({ id: "ws-good" }), makeUndecryptableRow("ws-bad")],
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
    await vi.advanceTimersByTimeAsync(100);

    const warning = useAuth.getState().decryptWarning;
    expect(warning).not.toBeNull();
    expect(warning).toContain("1");
  });

  it("onLogin does not set decryptWarning when all rows decrypt successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url: RequestInfo | URL) => {
      return Promise.resolve(
        new Response(
          JSON.stringify({ workspaces: [makeRow({ id: "ws-good" })], cursor: Date.now() }),
          { status: 200 },
        ),
      );
    });

    cleanup = initSync();
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(useAuth.getState().decryptWarning).toBeNull();
  });

  it("deltaRefresh sets decryptWarning when a delta row fails to decrypt, even when it pulls zero new rows", async () => {
    useAuth.setState({ status: "authed" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ workspaces: [makeUndecryptableRow("ws-bad")], cursor: Date.now() }),
        { status: 200 },
      ),
    );

    // The undecryptable row is excluded from `rows` (only skippedIds counts
    // it), so this pull returns zero *new* rows — the warning must still
    // surface despite the deltaRefresh's rows.length === 0 early return.
    await deltaRefresh(true);

    const warning = useAuth.getState().decryptWarning;
    expect(warning).not.toBeNull();
    expect(warning).toContain("1");
  });

  it("deltaRefresh clears a previous decryptWarning once the row decrypts successfully", async () => {
    useAuth.setState({ status: "authed", decryptWarning: "stale warning" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
    );

    await deltaRefresh(true);

    expect(useAuth.getState().decryptWarning).toBeNull();
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

// ---------------------------------------------------------------------------
// initSync — offline queue (TASK-94.3): edits flush from live store state,
// and deletes issued or failed offline are tombstoned and retried.
// ---------------------------------------------------------------------------

describe("initSync offline queue", () => {
  let cleanup: (() => void) | undefined;

  function setOnline(value: boolean) {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
  }

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AC #1 regression: flush pushes the latest store content, not the stale queued snapshot", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    const wsId = "ws-stale-flush";
    const putBodies: { name: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "PUT") {
          putBodies.push(JSON.parse(opts.body as string));
          return Promise.resolve(
            new Response(JSON.stringify({ workspace: makeRow({ id: wsId }) }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    const ws = makeEntry({ id: wsId, name: "Initial" });
    useWorkspace.setState({ workspaces: [ws] });

    // Go offline, then edit — the debounced autoSave fires while offline and
    // captures this (first) edit's id in the offline queue.
    setOnline(false);
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Edit 1 (offline)" }] });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(putBodies.length).toBe(0); // still offline — nothing sent yet

    // A further edit lands after the offline autoSave already queued the id,
    // without going through another debounced autoSave call itself — the
    // live store now holds content newer than whatever autoSave observed
    // when it queued the id.
    useWorkspace.setState({ workspaces: [{ ...ws, name: "Edit 2 (latest)" }] });

    // Reconnect and flush. flushOfflineQueue must re-read the current store
    // entry by id (as autoSave always does), not push a stale captured
    // snapshot from when the id was first queued.
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(100);

    expect(putBodies.length).toBe(1);
    expect(putBodies[0].name).toBe("Edit 2 (latest)");
  });

  it("AC #2: a delete issued offline propagates to the server on reconnect", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    const wsId = "ws-del";
    const ws = makeEntry({ id: wsId, name: "To delete" });
    useWorkspace.setState({ workspaces: [ws], activeWorkspaceIndex: 0 });

    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          deleteCalls.push(String(url));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    // Remove the workspace from the store while offline (simulates the user
    // deleting it without connectivity).
    setOnline(false);
    useWorkspace.setState({ workspaces: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(deleteCalls.length).toBe(0); // no DELETE attempted while offline

    // Reconnect — the tombstoned delete should flush.
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(100);

    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0]).toContain(`/api/workspaces/${wsId}`);
  });

  it("AC #3: a failed delete is retried rather than silently dropped", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    const wsId = "ws-fail";
    const ws = makeEntry({ id: wsId, name: "Flaky delete" });
    useWorkspace.setState({ workspaces: [ws], activeWorkspaceIndex: 0 });

    let deleteAttempts = 0;
    let failNextDelete = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          deleteAttempts++;
          if (failNextDelete) {
            return Promise.resolve(new Response(null, { status: 500 }));
          }
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    // Online throughout — the first DELETE attempt fails (500), so it must
    // be queued rather than dropped.
    useWorkspace.setState({ workspaces: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(deleteAttempts).toBe(1);

    // A second flush (e.g. the next "online" event) retries the queued
    // delete; this time it succeeds.
    failNextDelete = false;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(100);

    expect(deleteAttempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// openSavedWorkspace (TASK-126.2)
// ---------------------------------------------------------------------------

describe("openSavedWorkspace", () => {
  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("moves a library entry into the tab bar (open, focused) and pushes open: true", async () => {
    const id = "ws-saved-open";
    useSavedWorkspaceLibrary.setState({
      entries: [makeEntry({ id, name: "Saved WS", version: 3, saved: true, open: false })],
    });

    const putBodies: { open?: boolean }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "PUT") {
          putBodies.push(JSON.parse(opts.body as string));
          return Promise.resolve(
            new Response(
              JSON.stringify({ workspace: makeRow({ id, version: 4, saved: true, open: true }) }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    openSavedWorkspace(id);

    const { workspaces, activeWorkspaceIndex } = useWorkspace.getState();
    expect(workspaces.some((w) => w.id === id)).toBe(true);
    expect(workspaces[activeWorkspaceIndex].id).toBe(id);
    expect(useSavedWorkspaceLibrary.getState().entries.some((w) => w.id === id)).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].open).toBe(true);
  });

  it("focuses an already-open workspace instead of duplicating it, and issues no PUT", async () => {
    const id = "ws-already-open";
    useWorkspace.setState({
      workspaces: [
        makeEntry({ id: "other", name: "Other" }),
        makeEntry({ id, name: "Already open", saved: true, open: true }),
      ],
      activeWorkspaceIndex: 0,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    openSavedWorkspace(id);

    const state = useWorkspace.getState();
    expect(state.activeWorkspaceIndex).toBe(1);
    expect(state.workspaces).toHaveLength(2); // no duplicate tab

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// closeSavedWorkspace (TASK-126.2)
// ---------------------------------------------------------------------------

describe("closeSavedWorkspace", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("removes the workspace from the tab bar, adds it to the library, and never calls DELETE; PUT body includes open: false", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    const id = "ws-to-close";
    useWorkspace.setState({
      workspaces: [makeEntry({ id, name: "Saved & open", version: 2, saved: true, open: true })],
      activeWorkspaceIndex: 0,
    });

    const putBodies: { open?: boolean }[] = [];
    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "PUT") {
          putBodies.push(JSON.parse(opts.body as string));
          return Promise.resolve(
            new Response(
              JSON.stringify({ workspace: makeRow({ id, version: 3, saved: true, open: false }) }),
              { status: 200 },
            ),
          );
        }
        if (opts?.method === "DELETE") {
          deleteCalls.push(String(url));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    // Run with the store subscription (unsubStore) active — the regression
    // this whole ticket exists to prevent is closeSavedWorkspace's tab-bar
    // removal being mistaken for a user-delete by that subscriber.
    cleanup = initSync();

    closeSavedWorkspace(id);

    expect(useWorkspace.getState().workspaces.some((w) => w.id === id)).toBe(false);
    const libEntry = useSavedWorkspaceLibrary.getState().entries.find((w) => w.id === id);
    expect(libEntry?.open).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].open).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });

  it("no-ops (and never fetches) when called on a workspace that isn't saved", async () => {
    const id = "ws-not-saved";
    useWorkspace.setState({
      workspaces: [makeEntry({ id, name: "Not saved" })], // saved undefined
      activeWorkspaceIndex: 0,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    closeSavedWorkspace(id);

    expect(useWorkspace.getState().workspaces.some((w) => w.id === id)).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cross-device: a closed-saved row from deltaRefresh moves a locally-open
// workspace into the library without a network delete (TASK-126.2 AC #1)
// ---------------------------------------------------------------------------

describe("deltaRefresh — saved workspace closed on another device", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  it("removes it from the tab bar and adds it to the library, without a network delete", async () => {
    useAuth.setState({ status: "authed" });
    const id = "ws-closed-elsewhere";
    useWorkspace.setState({
      workspaces: [makeEntry({ id, name: "Was open here", version: 1, saved: true, open: true })],
      activeWorkspaceIndex: 0,
    });

    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          deleteCalls.push(String(url));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              workspaces: [makeRow({ id, version: 2, saved: true, open: false })],
              cursor: Date.now(),
            }),
            { status: 200 },
          ),
        );
      },
    );

    // The unsubStore subscription must not mistake this remote-driven tab-bar
    // removal for a user delete.
    cleanup = initSync();

    await deltaRefresh(true);

    expect(useWorkspace.getState().workspaces.some((w) => w.id === id)).toBe(false);
    expect(useSavedWorkspaceLibrary.getState().entries.some((w) => w.id === id)).toBe(true);
    expect(deleteCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// closeSavedWorkspace — offline queue (TASK-126.2)
// ---------------------------------------------------------------------------

describe("closeSavedWorkspace offline queue", () => {
  let cleanup: (() => void) | undefined;

  function setOnline(value: boolean) {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
  }

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("queues the closed snapshot while offline and flushes a PUT with open: false on reconnect", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    const id = "ws-close-offline";
    useWorkspace.setState({
      workspaces: [makeEntry({ id, name: "Saved & open", version: 1, saved: true, open: true })],
      activeWorkspaceIndex: 0,
    });

    const putBodies: { open?: boolean }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "PUT") {
          putBodies.push(JSON.parse(opts.body as string));
          return Promise.resolve(
            new Response(
              JSON.stringify({ workspace: makeRow({ id, version: 2, saved: true, open: false }) }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    setOnline(false);
    closeSavedWorkspace(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(putBodies).toHaveLength(0); // still offline — nothing sent yet
    expect(useWorkspace.getState().workspaces.some((w) => w.id === id)).toBe(false);
    expect(useSavedWorkspaceLibrary.getState().entries.some((w) => w.id === id)).toBe(true);

    // Reconnect and flush. The queued entry is no longer in the tab bar, so
    // flushOfflineQueue must push the queued snapshot directly (pushEntry),
    // not re-read it through autoSave (which would no-op on a missing id).
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(100);

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].open).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression pin: non-saved workspace close-to-delete is unchanged
// (TASK-126.2 AC #4)
// ---------------------------------------------------------------------------

describe("non-saved workspace close still soft-deletes", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("removing a non-saved workspace from the store still triggers DELETE /api/workspaces/:id", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });

    const id = "ws-plain";
    const ws = makeEntry({ id, name: "Plain workspace" }); // saved undefined
    useWorkspace.setState({ workspaces: [ws], activeWorkspaceIndex: 0 });

    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          deleteCalls.push(String(url));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    // Same store mutation store.ts's removeWorkspace performs on tab close
    // (App.tsx's existing onRemove path) — pinned here so a future refactor
    // to this file can't silently change non-saved close-to-delete behavior.
    useWorkspace.getState().removeWorkspace(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain(`/api/workspaces/${id}`);
  });
});

// ---------------------------------------------------------------------------
// renameSavedWorkspace (TASK-126.4)
// ---------------------------------------------------------------------------

describe("renameSavedWorkspace", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renames an open+saved workspace via the store, and the debounced autosave PUT carries the new name", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    const id = "ws-open-rename";
    useWorkspace.setState({
      workspaces: [makeEntry({ id, name: "Old name", version: 1, saved: true, open: true })],
      activeWorkspaceIndex: 0,
    });

    const putBodies: { name: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "PUT") {
          putBodies.push(JSON.parse(opts.body as string));
          return Promise.resolve(
            new Response(
              JSON.stringify({ workspace: makeRow({ id, version: 2, name: "New name" }) }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    cleanup = initSync();

    renameSavedWorkspace(id, "New name");

    // Renaming an open workspace goes through the store's own renameWorkspace
    // action — no explicit push here, it flows through the generic
    // change-detection/debounced-autosave path every other tab-strip edit
    // uses, same as setWorkspaceSaved from TASK-126.3.
    expect(useWorkspace.getState().workspaces[0].name).toBe("New name");
    expect(putBodies).toHaveLength(0); // not pushed yet — still debouncing

    await vi.advanceTimersByTimeAsync(2_100);
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].name).toBe("New name");
  });

  it("renames a closed library entry in place and pushes an immediate PUT", async () => {
    const id = "ws-closed-rename";
    useSavedWorkspaceLibrary.setState({
      entries: [makeEntry({ id, name: "Old name", version: 3, saved: true, open: false })],
    });

    const putBodies: { name: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "PUT") {
          putBodies.push(JSON.parse(opts.body as string));
          return Promise.resolve(
            new Response(
              JSON.stringify({ workspace: makeRow({ id, version: 4, name: "New name" }) }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    renameSavedWorkspace(id, "New name");

    expect(useSavedWorkspaceLibrary.getState().entries[0].name).toBe("New name");

    // Immediate push (no debounce), matching openSavedWorkspace/
    // closeSavedWorkspace's synchronous pushEntry call.
    await vi.advanceTimersByTimeAsync(100);
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].name).toBe("New name");
  });

  it("no-ops (and logs) when id matches neither store", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renameSavedWorkspace("missing-id", "New name");

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteSavedWorkspace (TASK-126.4)
// ---------------------------------------------------------------------------

describe("deleteSavedWorkspace", () => {
  let cleanup: (() => void) | undefined;

  function setOnline(value: boolean) {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
  }

  beforeEach(() => {
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("deleting an open+saved workspace removes it from the tab bar and triggers DELETE via the store subscriber", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    const id = "ws-open-delete";
    useWorkspace.setState({
      workspaces: [makeEntry({ id, name: "Delete me", version: 1, saved: true, open: true })],
      activeWorkspaceIndex: 0,
    });

    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          deleteCalls.push(String(url));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    // The open branch depends on unsubStore's change-detection to fire the
    // DELETE — mirrors the "non-saved workspace close still soft-deletes" test.
    cleanup = initSync();

    deleteSavedWorkspace(id);

    expect(useWorkspace.getState().workspaces.some((w) => w.id === id)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain(`/api/workspaces/${id}`);
  });

  it("deleting a closed library entry removes it from the library and issues DELETE directly, without initSync", async () => {
    const id = "ws-closed-delete";
    useSavedWorkspaceLibrary.setState({
      entries: [makeEntry({ id, name: "Delete me too", version: 2, saved: true, open: false })],
    });

    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          deleteCalls.push(String(url));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    // Deliberately NOT calling initSync() — pins that the closed-library
    // delete path doesn't depend on the store subscriber, only on the
    // module-level requestDelete.
    deleteSavedWorkspace(id);

    expect(useSavedWorkspaceLibrary.getState().entries.some((w) => w.id === id)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain(`/api/workspaces/${id}`);
  });

  it("queues a closed-entry delete while offline and flushes it on reconnect", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    const id = "ws-closed-delete-offline";
    useSavedWorkspaceLibrary.setState({
      entries: [makeEntry({ id, name: "Offline delete", version: 1, saved: true, open: false })],
    });

    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (url: RequestInfo | URL, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          deleteCalls.push(String(url));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ workspaces: [], cursor: Date.now() }), { status: 200 }),
        );
      },
    );

    // Needs initSync() mounted so the "online" event's flushOfflineQueue
    // handler is registered.
    cleanup = initSync();

    setOnline(false);
    deleteSavedWorkspace(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(deleteCalls).toHaveLength(0); // still offline — nothing sent yet
    expect(useSavedWorkspaceLibrary.getState().entries.some((w) => w.id === id)).toBe(false);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(100);

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain(`/api/workspaces/${id}`);
  });

  it("no-ops (and logs) when id matches neither store", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    deleteSavedWorkspace("missing-id");

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});
