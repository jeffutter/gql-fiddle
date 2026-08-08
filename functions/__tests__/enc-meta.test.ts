import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestPut } from "../api/auth/enc-meta";
import { SESSION_COOKIE_NAME, mintSession } from "../_lib/auth";
import { getKwk, getOrCreateUser } from "../_lib/db";
import { createD1Mock } from "./d1-mock";

const migrationSql = [
  readFileSync(join(__dirname, "../../migrations/0001_initial.sql"), "utf-8"),
  readFileSync(
    join(__dirname, "../../migrations/0002_users_wrapped_dek.sql"),
    "utf-8",
  ),
  readFileSync(join(__dirname, "../../migrations/0003_users_kwk.sql"), "utf-8"),
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
let userId: string;

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
  userId = user.id;

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

  it("stores the KWK in the users table", async () => {
    expect(await getKwk(db, userId)).toBeNull();

    const res = await onRequestGet(makeGetCtx(env, userCookie));
    const { kwk } = (await res.json()) as { kwk: string };

    const stored = await getKwk(db, userId);
    expect(stored).toBe(kwk);

    // Must decode to 32 bytes, same shape asserted on the response above.
    const decoded = Uint8Array.from(atob(stored!), (c) => c.charCodeAt(0));
    expect(decoded.byteLength).toBe(32);
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

  it("returns 200 with the stored wrapped_dek", async () => {
    const res = await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:realWrapped==" }, userCookie),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wrapped_dek: string };
    expect(body.wrapped_dek).toBe("E1:realWrapped==");

    // Verify it is readable back via GET
    const getRes = await onRequestGet(makeGetCtx(env, userCookie));
    const { wrapped_dek } = (await getRes.json()) as {
      wrapped_dek: string | null;
    };
    expect(wrapped_dek).toBe("E1:realWrapped==");
  });

  it("second PUT is a no-op and both callers get the first-stored wrapped_dek", async () => {
    const res1 = await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:first==" }, userCookie),
    );
    const body1 = (await res1.json()) as { wrapped_dek: string };
    expect(body1.wrapped_dek).toBe("E1:first==");

    const res2 = await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:second==" }, userCookie),
    );
    const body2 = (await res2.json()) as { wrapped_dek: string };
    expect(body2.wrapped_dek).toBe("E1:first==");

    const getRes = await onRequestGet(makeGetCtx(env, userCookie));
    const { wrapped_dek } = (await getRes.json()) as {
      wrapped_dek: string | null;
    };
    expect(wrapped_dek).toBe("E1:first==");
  });

  it("emits a data.dek_write event with user_id, and never logs the wrapped_dek literal value", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const secretDek = "E1:very-secret-wrapped-dek-value==";
      const res = await onRequestPut(
        makePutCtx(env, { wrapped_dek: secretDek }, userCookie),
      );
      expect(res.status).toBe(200);

      const lines = logSpy.mock.calls.map((call) => call[0] as string);
      const writeLine = lines.find((line) => line.includes("data.dek_write"));
      expect(writeLine).toBeDefined();
      const record = JSON.parse(writeLine!);
      expect(typeof record.user_id).toBe("string");

      for (const line of lines) {
        expect(line).not.toContain(secretDek);
      }
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Legacy KV KWK recovery (TASK-128)
// ---------------------------------------------------------------------------

describe("legacy KV KWK recovery (TASK-128)", () => {
  it("GET omits legacy_kwk when wrapped_dek is not set yet", async () => {
    // Simulates data left over from before TASK-118: a legacy KV entry
    // exists, but this account has no wrapped_dek yet, so there is nothing
    // to reconcile — the first GET just creates a fresh, unrelated D1 kwk.
    kvStore.set(`kwk:${userId}`, "legacy-kwk-value==");

    const res = await onRequestGet(makeGetCtx(env, userCookie));
    const body = (await res.json()) as {
      kwk: string;
      wrapped_dek: string | null;
      legacy_kwk: string | null;
    };
    expect(body.wrapped_dek).toBeNull();
    expect(body.legacy_kwk).toBeNull();
  });

  it("GET returns legacy_kwk once wrapped_dek exists and it disagrees with the D1 kwk", async () => {
    kvStore.set(`kwk:${userId}`, "legacy-kwk-value==");

    // First GET creates a fresh D1 kwk unrelated to the legacy entry.
    await onRequestGet(makeGetCtx(env, userCookie));
    await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:orphaned==" }, userCookie),
    );

    const res = await onRequestGet(makeGetCtx(env, userCookie));
    const body = (await res.json()) as {
      kwk: string;
      wrapped_dek: string | null;
      legacy_kwk: string | null;
    };
    expect(body.legacy_kwk).toBe("legacy-kwk-value==");
    expect(body.kwk).not.toBe(body.legacy_kwk);
  });

  it("GET omits legacy_kwk once it matches the current D1 kwk (never diverged)", async () => {
    // First GET generates and stores a D1 kwk.
    const res1 = await onRequestGet(makeGetCtx(env, userCookie));
    const { kwk } = (await res1.json()) as { kwk: string };

    // Legacy KV entry holds the SAME value — this account never diverged
    // (e.g. it started and finished key setup entirely post-TASK-118, and
    // some unrelated legacy-looking KV entry happens to already agree).
    kvStore.set(`kwk:${userId}`, kwk);
    await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:established==" }, userCookie),
    );

    const res2 = await onRequestGet(makeGetCtx(env, userCookie));
    const body2 = (await res2.json()) as { legacy_kwk: string | null };
    expect(body2.legacy_kwk).toBeNull();
  });

  it("PUT confirm_kwk repairs the stored KWK when it matches the legacy KV value", async () => {
    kvStore.set(`kwk:${userId}`, "legacy-kwk-value==");
    await onRequestGet(makeGetCtx(env, userCookie));
    await onRequestPut(
      makePutCtx(env, { wrapped_dek: "E1:orphaned==" }, userCookie),
    );

    const putRes = await onRequestPut(
      makePutCtx(env, { confirm_kwk: "legacy-kwk-value==" }, userCookie),
    );
    expect(putRes.status).toBe(200);
    expect(await getKwk(db, userId)).toBe("legacy-kwk-value==");

    const getRes = await onRequestGet(makeGetCtx(env, userCookie));
    const body = (await getRes.json()) as {
      kwk: string;
      legacy_kwk: string | null;
    };
    expect(body.kwk).toBe("legacy-kwk-value==");
    expect(body.legacy_kwk).toBeNull();
  });

  it("PUT confirm_kwk is a no-op when the value does not match the legacy KV entry", async () => {
    kvStore.set(`kwk:${userId}`, "legacy-kwk-value==");
    await onRequestGet(makeGetCtx(env, userCookie));
    const before = await getKwk(db, userId);

    const res = await onRequestPut(
      makePutCtx(env, { confirm_kwk: "not-the-legacy-value==" }, userCookie),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(await getKwk(db, userId)).toBe(before);
  });

  it("PUT confirm_kwk is a no-op when there is no legacy KV entry at all", async () => {
    await onRequestGet(makeGetCtx(env, userCookie));
    const before = await getKwk(db, userId);

    const res = await onRequestPut(
      makePutCtx(env, { confirm_kwk: "some-arbitrary-value==" }, userCookie),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(await getKwk(db, userId)).toBe(before);
  });

  it("PUT confirm_kwk alongside a wrapped_dek in the same request repairs the KWK and stores the wrapped_dek", async () => {
    kvStore.set(`kwk:${userId}`, "legacy-kwk-value==");
    await onRequestGet(makeGetCtx(env, userCookie));

    const res = await onRequestPut(
      makePutCtx(
        env,
        {
          wrapped_dek: "E1:combined==",
          confirm_kwk: "legacy-kwk-value==",
        },
        userCookie,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wrapped_dek: string };
    expect(body.wrapped_dek).toBe("E1:combined==");
    expect(await getKwk(db, userId)).toBe("legacy-kwk-value==");
  });
});
