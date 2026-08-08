// Integration tests for the workspace sync REST API (TASK-88.4).
// Uses the D1 mock + inline KV mock; the endpoint handlers
// are imported directly and invoked without a real HTTP server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "../api/workspaces/index";
import { onRequestPut, onRequestDelete } from "../api/workspaces/[id]";
import { SESSION_COOKIE_NAME, mintSession } from "../_lib/auth";
import { getOrCreateUser } from "../_lib/db";
import { createD1Mock } from "./d1-mock";

const migrationSql = [
  readFileSync(join(__dirname, "../../migrations/0001_initial.sql"), "utf-8"),
  readFileSync(
    join(__dirname, "../../migrations/0005_workspaces_saved_open.sql"),
    "utf-8",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// KV mock
// ---------------------------------------------------------------------------

function createKVMock(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async put(key: string, value: string, _opts?: unknown): Promise<void> {
      store.set(key, value);
    },
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Context builder helpers
// ---------------------------------------------------------------------------

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

function makeGetCtx(
  env: Env,
  url: string,
  cookie?: string,
): Parameters<PagesFunction<Env>>[0] {
  return {
    request: new Request(url, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
    params: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
    pluginArgs: {},
    functionPath: "",
  } as unknown as Parameters<PagesFunction<Env>>[0];
}

function makeIdCtx(
  env: Env,
  id: string,
  method: string,
  body?: unknown,
  cookie?: string,
): Parameters<PagesFunction<Env>>[0] {
  return {
    request: new Request(`http://localhost/api/workspaces/${id}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    params: { id },
    waitUntil: () => {},
    passThroughOnException: () => {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
    pluginArgs: {},
    functionPath: "",
  } as unknown as Parameters<PagesFunction<Env>>[0];
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let db: D1Database;
let kv: KVNamespace;
let env: Env;
let userCookie: string;
let userId: string;

beforeEach(async () => {
  db = createD1Mock(migrationSql);
  kv = createKVMock();
  env = { DB: db, SESSIONS: kv };

  const user = await getOrCreateUser(db, {
    github_id: 1,
    login: "alice",
    name: "Alice",
    avatar_url: null,
  });
  userId = user.id;
  const token = await mintSession(kv, userId);
  userCookie = `${SESSION_COOKIE_NAME}=${token}`;
});

// ---------------------------------------------------------------------------
// GET /api/workspaces — unauthenticated
// ---------------------------------------------------------------------------

describe("GET /api/workspaces — authentication", () => {
  it("returns 401 without a valid session", async () => {
    const ctx = makeGetCtx(env, "http://localhost/api/workspaces");
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces — full snapshot
// ---------------------------------------------------------------------------

describe("GET /api/workspaces — full snapshot", () => {
  it("returns only live (non-deleted) workspaces for the user", async () => {
    // Seed a live and a deleted workspace
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    await onRequestPut(
      makeIdCtx(
        env,
        id1,
        "PUT",
        { name: "WS1", payload: "{}", version: 1 },
        userCookie,
      ),
    );
    await onRequestPut(
      makeIdCtx(
        env,
        id2,
        "PUT",
        { name: "WS2", payload: "{}", version: 1 },
        userCookie,
      ),
    );
    await onRequestDelete(makeIdCtx(env, id2, "DELETE", undefined, userCookie));

    const ctx = makeGetCtx(env, "http://localhost/api/workspaces", userCookie);
    const res = await onRequestGet(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: Array<{ id: string }>;
      cursor: number;
    };
    const ids = body.workspaces.map((w) => w.id);
    expect(ids).toContain(id1);
    expect(ids).not.toContain(id2);
    // Full snapshot responses must also carry a cursor for the client's next delta pull.
    expect(typeof body.cursor).toBe("number");
  });

  it("includes saved/open as JS booleans", async () => {
    const id = crypto.randomUUID();
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "WS", payload: "{}", version: 1 },
        userCookie,
      ),
    );

    const ctx = makeGetCtx(env, "http://localhost/api/workspaces", userCookie);
    const res = await onRequestGet(ctx);
    const body = (await res.json()) as {
      workspaces: Array<{ id: string; saved: boolean; open: boolean }>;
    };
    const ws = body.workspaces.find((w) => w.id === id);
    expect(ws).toBeDefined();
    expect(typeof ws!.saved).toBe("boolean");
    expect(typeof ws!.open).toBe("boolean");
    expect(ws!.saved).toBe(false);
    expect(ws!.open).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces?since=<cursor> — delta
// ---------------------------------------------------------------------------

describe("GET /api/workspaces?since=<cursor>", () => {
  it("includes soft-deleted rows so clients learn of deletions", async () => {
    const id = crypto.randomUUID();
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "WS", payload: "{}", version: 1 },
        userCookie,
      ),
    );

    const before = Date.now();
    await new Promise((r) => setTimeout(r, 2)); // ensure updated_at > before

    await onRequestDelete(makeIdCtx(env, id, "DELETE", undefined, userCookie));

    const ctx = makeGetCtx(
      env,
      `http://localhost/api/workspaces?since=${before}`,
      userCookie,
    );
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: Array<{ id: string; deleted_at: number | null }>;
      cursor: number;
    };
    const ws = body.workspaces.find((w) => w.id === id);
    expect(ws).toBeDefined();
    expect(ws!.deleted_at).not.toBeNull();
    expect(typeof body.cursor).toBe("number");
  });

  it("returns a row whose updated_at equals `since` exactly (inclusive `>=` boundary)", async () => {
    const id = crypto.randomUUID();
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "Boundary WS", payload: "{}", version: 1 },
        userCookie,
      ),
    );

    const raw = await db
      .prepare(`SELECT updated_at FROM workspaces WHERE id = ?`)
      .bind(id)
      .first<{ updated_at: number }>();
    const exactUpdatedAt = raw!.updated_at;

    // Requesting since=<exact updated_at> must still include the row — under
    // the old exclusive `>` comparison this row would have been excluded.
    const ctx = makeGetCtx(
      env,
      `http://localhost/api/workspaces?since=${exactUpdatedAt}`,
      userCookie,
    );
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspaces: Array<{ id: string }> };
    expect(body.workspaces.map((w) => w.id)).toContain(id);
  });

  it("includes saved/open as JS booleans in delta responses", async () => {
    const id = crypto.randomUUID();
    const before = Date.now();
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "WS", payload: "{}", version: 1, saved: true, open: false },
        userCookie,
      ),
    );

    const ctx = makeGetCtx(
      env,
      `http://localhost/api/workspaces?since=${before}`,
      userCookie,
    );
    const res = await onRequestGet(ctx);
    const body = (await res.json()) as {
      workspaces: Array<{ id: string; saved: boolean; open: boolean }>;
    };
    const ws = body.workspaces.find((w) => w.id === id);
    expect(ws).toBeDefined();
    expect(typeof ws!.saved).toBe("boolean");
    expect(typeof ws!.open).toBe("boolean");
    expect(ws!.saved).toBe(true);
    expect(ws!.open).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET cross-user isolation
// ---------------------------------------------------------------------------

describe("GET cross-user isolation", () => {
  it("does not return another user's workspaces", async () => {
    // Create a second user and seed a workspace
    const bob = await getOrCreateUser(db, {
      github_id: 2,
      login: "bob",
      name: "Bob",
      avatar_url: null,
    });
    const bobToken = await mintSession(kv, bob.id);
    const bobCookie = `${SESSION_COOKIE_NAME}=${bobToken}`;
    const bobWsId = crypto.randomUUID();
    await onRequestPut(
      makeIdCtx(
        env,
        bobWsId,
        "PUT",
        { name: "BobWS", payload: "{}", version: 1 },
        bobCookie,
      ),
    );

    // Alice's GET should not see Bob's workspace
    const ctx = makeGetCtx(env, "http://localhost/api/workspaces", userCookie);
    const res = await onRequestGet(ctx);
    const body = (await res.json()) as { workspaces: Array<{ id: string }> };
    expect(body.workspaces.map((w) => w.id)).not.toContain(bobWsId);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/workspaces/:id
// ---------------------------------------------------------------------------

describe("PUT /api/workspaces/:id", () => {
  it("inserts a new workspace and returns 200 with the workspace row", async () => {
    const id = crypto.randomUUID();
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "New WS", payload: '{"x":1}', version: 1 },
      userCookie,
    );
    const res = await onRequestPut(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { id: string; name: string };
    };
    expect(body.workspace.id).toBe(id);
    expect(body.workspace.name).toBe("New WS");
  });

  it("accepts an update with a higher version", async () => {
    const id = crypto.randomUUID();
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "v1", payload: "{}", version: 1 },
        userCookie,
      ),
    );
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "v2", payload: "{}", version: 2 },
      userCookie,
    );
    const res = await onRequestPut(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { name: string; version: number };
    };
    expect(body.workspace.name).toBe("v2");
    expect(body.workspace.version).toBe(2);
  });

  it("returns 409 with the current server row when version is stale", async () => {
    const id = crypto.randomUUID();
    // Insert at version 5
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "v5", payload: "{}", version: 5 },
        userCookie,
      ),
    );
    // Try to overwrite at version 3 (stale)
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "stale", payload: "{}", version: 3 },
      userCookie,
    );
    const res = await onRequestPut(ctx);

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      conflict: boolean;
      current: {
        name: string;
        version: number;
        saved: boolean;
        open: boolean;
      };
    };
    expect(body.conflict).toBe(true);
    expect(body.current.name).toBe("v5");
    expect(body.current.version).toBe(5);
    expect(typeof body.current.saved).toBe("boolean");
    expect(typeof body.current.open).toBe("boolean");
  });

  it("returns 413 when payload exceeds 1 MB", async () => {
    const id = crypto.randomUUID();
    const bigPayload = "x".repeat(1_048_577);
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "big", payload: bigPayload, version: 1 },
      userCookie,
    );
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(413);
  });

  it("returns 413 for a multi-byte payload over 1 MB in bytes but under 1 MB in UTF-16 units", async () => {
    const id = crypto.randomUUID();
    // "あ" is 1 UTF-16 code unit but 3 UTF-8 bytes: 400,000 units is only
    // ~800 KB as .length would (wrongly) measure it, but ~1.2 MB in bytes.
    const bigPayload = "あ".repeat(400_000);
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "multibyte", payload: bigPayload, version: 1 },
      userCookie,
    );
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(413);
  });

  it("returns 400 when name exceeds the byte limit", async () => {
    const id = crypto.randomUUID();
    const bigName = "x".repeat(300);
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: bigName, payload: "{}", version: 1 },
      userCookie,
    );
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/name too long/i);
  });

  it("persists saved/open when provided on a new workspace", async () => {
    const id = crypto.randomUUID();
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "New WS", payload: "{}", version: 1, saved: true, open: false },
      userCookie,
    );
    const res = await onRequestPut(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { saved: boolean; open: boolean };
    };
    expect(body.workspace.saved).toBe(true);
    expect(body.workspace.open).toBe(false);
  });

  it("defaults saved/open to false/true when omitted on a new workspace", async () => {
    const id = crypto.randomUUID();
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "New WS", payload: "{}", version: 1 },
      userCookie,
    );
    const res = await onRequestPut(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { saved: boolean; open: boolean };
    };
    expect(body.workspace.saved).toBe(false);
    expect(body.workspace.open).toBe(true);
  });

  it("preserves saved/open when omitted on an update to an existing workspace (does not reset to defaults)", async () => {
    const id = crypto.randomUUID();
    // Mark saved: true, open: false on the initial write.
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "v1", payload: "{}", version: 1, saved: true, open: false },
        userCookie,
      ),
    );

    // A later write (e.g. from a client unaware of these fields) omits both.
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "v2", payload: "{}", version: 2 },
      userCookie,
    );
    const res = await onRequestPut(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { name: string; saved: boolean; open: boolean };
    };
    expect(body.workspace.name).toBe("v2");
    expect(body.workspace.saved).toBe(true);
    expect(body.workspace.open).toBe(false);
  });

  it("returns 400 when saved is present but not a boolean", async () => {
    const id = crypto.randomUUID();
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "WS", payload: "{}", version: 1, saved: "yes" },
      userCookie,
    );
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when open is present but not a boolean", async () => {
    const id = crypto.randomUUID();
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "WS", payload: "{}", version: 1, open: "no" },
      userCookie,
    );
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the workspace id belongs to another user", async () => {
    // Bob creates a workspace
    const bob = await getOrCreateUser(db, {
      github_id: 3,
      login: "bob2",
      name: "Bob",
      avatar_url: null,
    });
    const bobToken = await mintSession(kv, bob.id);
    const bobCookie = `${SESSION_COOKIE_NAME}=${bobToken}`;
    const id = crypto.randomUUID();
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "BobWS", payload: "{}", version: 1 },
        bobCookie,
      ),
    );

    // Alice tries to overwrite Bob's workspace
    const ctx = makeIdCtx(
      env,
      id,
      "PUT",
      { name: "Alice hijack", payload: "{}", version: 2 },
      userCookie,
    );
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(404);
  });

  it("returns 401 without a valid session", async () => {
    const id = crypto.randomUUID();
    const ctx = makeIdCtx(env, id, "PUT", {
      name: "WS",
      payload: "{}",
      version: 1,
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(401);
  });

  it("logs a data.cross_user_denied event when the id belongs to another user", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const bob = await getOrCreateUser(db, {
        github_id: 5,
        login: "bob4",
        name: "Bob",
        avatar_url: null,
      });
      const bobToken = await mintSession(kv, bob.id);
      const bobCookie = `${SESSION_COOKIE_NAME}=${bobToken}`;
      const id = crypto.randomUUID();
      await onRequestPut(
        makeIdCtx(
          env,
          id,
          "PUT",
          { name: "BobWS", payload: "{}", version: 1 },
          bobCookie,
        ),
      );

      const ctx = makeIdCtx(
        env,
        id,
        "PUT",
        { name: "Alice hijack", payload: "{}", version: 2 },
        userCookie,
      );
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(404);

      const lines = logSpy.mock.calls.map((call) => call[0] as string);
      const denyLine = lines.find((line) =>
        line.includes("data.cross_user_denied"),
      );
      expect(denyLine).toBeDefined();
      const record = JSON.parse(denyLine!);
      expect(record.user_id).toBe(userId);
      expect(record.workspace_id).toBe(id);
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/workspaces/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/workspaces/:id", () => {
  it("soft-deletes a workspace and it is visible in ?since read", async () => {
    const id = crypto.randomUUID();
    const ts = Date.now() - 10;
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "ToDelete", payload: "{}", version: 1 },
        userCookie,
      ),
    );

    const delCtx = makeIdCtx(env, id, "DELETE", undefined, userCookie);
    const delRes = await onRequestDelete(delCtx);
    expect(delRes.status).toBe(204);

    // Should appear in delta read with deleted_at set
    const sinceCtx = makeGetCtx(
      env,
      `http://localhost/api/workspaces?since=${ts}`,
      userCookie,
    );
    const sinceRes = await onRequestGet(sinceCtx);
    const body = (await sinceRes.json()) as {
      workspaces: Array<{ id: string; deleted_at: number | null }>;
    };
    const ws = body.workspaces.find((w) => w.id === id);
    expect(ws).toBeDefined();
    expect(ws!.deleted_at).not.toBeNull();
  });

  it("returns 404 when the workspace belongs to another user", async () => {
    const bob = await getOrCreateUser(db, {
      github_id: 4,
      login: "bob3",
      name: "Bob",
      avatar_url: null,
    });
    const bobToken = await mintSession(kv, bob.id);
    const bobCookie = `${SESSION_COOKIE_NAME}=${bobToken}`;
    const id = crypto.randomUUID();
    await onRequestPut(
      makeIdCtx(
        env,
        id,
        "PUT",
        { name: "BobWS", payload: "{}", version: 1 },
        bobCookie,
      ),
    );

    const ctx = makeIdCtx(env, id, "DELETE", undefined, userCookie);
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(404);
  });

  it("returns 401 without a valid session", async () => {
    const ctx = makeIdCtx(env, crypto.randomUUID(), "DELETE");
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(401);
  });
});
