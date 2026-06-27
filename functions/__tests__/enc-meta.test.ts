import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { onRequestGet, onRequestPut } from "../api/auth/enc-meta";
import { SESSION_COOKIE_NAME, mintSession } from "../_lib/auth";
import { getOrCreateUser } from "../_lib/db";
import { createD1Mock } from "./d1-mock";

const migrationSql = [
  readFileSync(join(__dirname, "../../migrations/0001_initial.sql"), "utf-8"),
  readFileSync(
    join(__dirname, "../../migrations/0002_users_wrapped_dek.sql"),
    "utf-8",
  ),
].join("\n");

// ---------------------------------------------------------------------------
// KV mock
// ---------------------------------------------------------------------------

function createKVMock(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
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
  return { kv, store };
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

function makeGetCtx(
  env: Env,
  cookie?: string,
): Parameters<PagesFunction<Env>>[0] {
  return {
    request: new Request("http://localhost/api/auth/enc-meta", {
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

function makePutCtx(
  env: Env,
  body: unknown,
  cookie?: string,
): Parameters<PagesFunction<Env>>[0] {
  return {
    request: new Request("http://localhost/api/auth/enc-meta", {
      method: "PUT",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let db: D1Database;
let kv: KVNamespace;
let kvStore: Map<string, string>;
let env: Env;
let userCookie: string;

beforeEach(async () => {
  db = createD1Mock(migrationSql);
  ({ kv, store: kvStore } = createKVMock());
  env = { DB: db, SESSIONS: kv };

  const user = await getOrCreateUser(db, {
    github_id: 1,
    login: "alice",
    name: "Alice",
    avatar_url: null,
  });

  const token = await mintSession(kv, user.id);
  userCookie = `${SESSION_COOKIE_NAME}=${token}`;
});

// ---------------------------------------------------------------------------
// GET /api/auth/enc-meta
// ---------------------------------------------------------------------------

describe("GET /api/auth/enc-meta", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await onRequestGet(makeGetCtx(env));
    expect(res.status).toBe(401);
  });

  it("creates a KWK on first call and returns it with null wrapped_dek", async () => {
    const res = await onRequestGet(makeGetCtx(env, userCookie));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      kwk: string;
      wrapped_dek: string | null;
    };
    expect(body.wrapped_dek).toBeNull();

    // KWK must be a valid base64 string decoding to 32 bytes.
    expect(typeof body.kwk).toBe("string");
    const decoded = Uint8Array.from(atob(body.kwk), (c) => c.charCodeAt(0));
    expect(decoded.byteLength).toBe(32);
  });

  it("is idempotent — returns the same KWK on repeated calls", async () => {
    const res1 = await onRequestGet(makeGetCtx(env, userCookie));
    const res2 = await onRequestGet(makeGetCtx(env, userCookie));

    const { kwk: kwk1 } = (await res1.json()) as { kwk: string };
    const { kwk: kwk2 } = (await res2.json()) as { kwk: string };

    expect(kwk1).toBe(kwk2);
  });

  it("stores the KWK in KV under kwk:<user_id>", async () => {
    const kwkKeysBefore = [...kvStore.keys()].filter((k) =>
      k.startsWith("kwk:"),
    );
    expect(kwkKeysBefore).toHaveLength(0);

    await onRequestGet(makeGetCtx(env, userCookie));

    const kwkKeys = [...kvStore.keys()].filter((k) => k.startsWith("kwk:"));
    expect(kwkKeys).toHaveLength(1);
  });

  it("returns the wrapped_dek after it has been stored via PUT", async () => {
    // First call — no wrapped_dek yet
    const res1 = await onRequestGet(makeGetCtx(env, userCookie));
    const { wrapped_dek: wd1 } = (await res1.json()) as {
      wrapped_dek: string | null;
    };
    expect(wd1).toBeNull();

    // Store a wrapped DEK
    await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:fakeWrappedDek==" }, userCookie),
    );

    // Subsequent GET returns the wrapped_dek
    const res2 = await onRequestGet(makeGetCtx(env, userCookie));
    const { wrapped_dek: wd2 } = (await res2.json()) as {
      wrapped_dek: string | null;
    };
    expect(wd2).toBe("E1:fakeWrappedDek==");
  });
});

// ---------------------------------------------------------------------------
// PUT /api/auth/enc-meta
// ---------------------------------------------------------------------------

describe("PUT /api/auth/enc-meta", () => {
  it("returns 401 when no session cookie is present", async () => {
    const res = await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:something==" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing wrapped_dek field", async () => {
    const res = await onRequestPut(
      makePutCtx(env, { other_field: "foo" }, userCookie),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty wrapped_dek string", async () => {
    const res = await onRequestPut(
      makePutCtx(env, { wrapped_dek: "" }, userCookie),
    );
    expect(res.status).toBe(400);
  });

  it("returns 204 and stores the wrapped_dek", async () => {
    const res = await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:realWrapped==" }, userCookie),
    );
    expect(res.status).toBe(204);

    // Verify it is readable back via GET
    const getRes = await onRequestGet(makeGetCtx(env, userCookie));
    const { wrapped_dek } = (await getRes.json()) as {
      wrapped_dek: string | null;
    };
    expect(wrapped_dek).toBe("E1:realWrapped==");
  });

  it("overwrites a previously stored wrapped_dek", async () => {
    await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:first==" }, userCookie),
    );
    await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:second==" }, userCookie),
    );

    const getRes = await onRequestGet(makeGetCtx(env, userCookie));
    const { wrapped_dek } = (await getRes.json()) as {
      wrapped_dek: string | null;
    };
    expect(wrapped_dek).toBe("E1:second==");
  });
});
