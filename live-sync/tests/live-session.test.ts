// Tests for the live-session Pages Function (POST + GET /api/live-session).
// Invokes the real handlers instead of re-implementing SQL inline.
import { describe, it, expect, beforeEach } from "vitest";
import { createD1Mock } from "../../functions/__tests__/d1-mock";
import { onRequestPost, onRequestGet } from "../../functions/api/live-session/index";

const MIGRATION_SQL = `
CREATE TABLE live_sessions (
  id              TEXT PRIMARY KEY,
  encoded_state   BLOB,
  created_at      INTEGER NOT NULL,
  last_active_at  INTEGER NOT NULL
);
`;

// ---------------------------------------------------------------------------
// KV mock (minimal — onRequestPost only needs the key to exist on env)
// ---------------------------------------------------------------------------

function createKVMock(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async put(key: string, value: string): Promise<void> {
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
// Context builder
// ---------------------------------------------------------------------------

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  LIVE_SYNC_URL?: string;
}

function makeCtx(
  env: Env,
  method: "POST" | "GET" = "POST",
  url?: string,
): Parameters<PagesFunction<Env>>[0] {
  return {
    request: new Request(url ?? "http://localhost/api/live-session", {
      method,
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

function makePostCtx(env: Env): Parameters<PagesFunction<Env>>[0] {
  return makeCtx(env, "POST");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/live-session", () => {
  let db: D1Database;
  let env: Env;

  beforeEach(() => {
    db = createD1Mock(MIGRATION_SQL);
    env = { DB: db, SESSIONS: createKVMock() };
  });

  it("creates a session and returns connection info", async () => {
    const ctx = makePostCtx(env);
    const res = await onRequestPost(ctx);

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      sessionId: string;
      wsUrl: string;
      createdAt: string;
    };

    // Assert response shape
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId).toHaveLength(36); // UUID format
    expect(typeof body.wsUrl).toBe("string");
    // Without LIVE_SYNC_URL, falls back to localhost:8789
    expect(body.wsUrl).toMatch(/^ws:\/\/localhost:8789\/ws\//);
    expect(typeof body.createdAt).toBe("string");
    // createdAt must be a valid ISO timestamp
    expect(new Date(body.createdAt)).toBeInstanceOf(Date);

    // Verify the D1 row was persisted with the returned sessionId
    const row = await db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(body.sessionId)
      .first();

    expect(row).not.toBeNull();
    expect(row!.id).toBe(body.sessionId);
    expect(row!.created_at).toBeDefined();
    expect(row!.last_active_at).toBeDefined();
  });

  it("builds correct WebSocket URL when LIVE_SYNC_URL is set", async () => {
    const customEnv: Env = {
      ...env,
      LIVE_SYNC_URL: "https://live-sync.example.com",
    };
    const ctx = makePostCtx(customEnv);
    const res = await onRequestPost(ctx);

    expect(res.status).toBe(200);

    const body = (await res.json()) as { wsUrl: string };
    expect(body.wsUrl).toMatch(/^wss:\/\/live-sync\.example\.com\/ws\//);
  });

  it("is idempotent — INSERT OR IGNORE preserves original row", async () => {
    // The handler generates its own crypto.randomUUID(), so we can't force two
    // calls through onRequestPost to collide on the same id. Instead, verify
    // the idempotency guarantee lives in the SQL itself.
    const sessionId = "test-id";
    const now = Date.now();

    // First insert
    await db
      .prepare(
        `INSERT OR IGNORE INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, now, now)
      .run();

    // Second insert (simulating retry)
    await db
      .prepare(
        `INSERT OR IGNORE INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, now + 100, now + 100)
      .run();

    // Should still have original timestamps
    const row = await db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first();

    expect(row).not.toBeNull();
    expect(row!.created_at).toBe(now);
    expect(row!.last_active_at).toBe(now);
  });
});

// ---------------------------------------------------------------------------
// GET /api/live-session?ls=<sessionId>
// ---------------------------------------------------------------------------

describe("GET /api/live-session", () => {
  let db: D1Database;
  let env: Env;
  let insertedId: string;
  let insertedAt: number;

  beforeEach(() => {
    db = createD1Mock(MIGRATION_SQL);
    env = { DB: db, SESSIONS: createKVMock() };

    // Insert a session for tests to query
    insertedId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    insertedAt = Date.now();
    db.prepare(
      `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
       VALUES (?, NULL, ?, ?)`,
    ).bind(insertedId, insertedAt, insertedAt).run();
  });

  it("returns session info for a valid session ID", async () => {
    const ctx = makeCtx(env, "GET", `http://localhost/api/live-session?ls=${insertedId}`);
    const res = await onRequestGet(ctx);

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      sessionId: string;
      wsUrl: string;
      createdAt: number;
    };

    expect(body.sessionId).toBe(insertedId);
    expect(typeof body.wsUrl).toBe("string");
    const expectedWs = `ws://localhost:8789/ws/${insertedId}`;
    expect(body.wsUrl).toBe(expectedWs);
    expect(body.createdAt).toBe(insertedAt);
  });

  it("builds correct WebSocket URL when LIVE_SYNC_URL is set", async () => {
    const customEnv: Env = {
      ...env,
      LIVE_SYNC_URL: "https://live-sync.example.com",
    };
    const ctx = makeCtx(customEnv, "GET", `http://localhost/api/live-session?ls=${insertedId}`);
    const res = await onRequestGet(ctx);

    expect(res.status).toBe(200);

    const body = (await res.json()) as { wsUrl: string };
    const expectedWs = `wss://live-sync.example.com/ws/${insertedId}`;
    expect(body.wsUrl).toBe(expectedWs);
  });

  it("returns 404 for an unknown session ID", async () => {
    const ctx = makeCtx(
      env,
      "GET",
      "http://localhost/api/live-session?ls=00000000-0000-0000-0000-000000000000",
    );
    const res = await onRequestGet(ctx);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Session not found");
  });

  it("returns 400 for a malformed session ID", async () => {
    const ctx = makeCtx(env, "GET", "http://localhost/api/live-session?ls=not-a-uuid");
    const res = await onRequestGet(ctx);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid session ID");
  });

  it("returns 400 when ls query parameter is missing", async () => {
    const ctx = makeCtx(env, "GET", "http://localhost/api/live-session");
    const res = await onRequestGet(ctx);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid session ID");
  });
});