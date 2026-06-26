import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  generateState,
  getSession,
  mintSession,
  parseCookies,
  requireUser,
  SESSION_COOKIE_NAME,
  verifyState,
} from "../_lib/auth";
import { getOrCreateUser } from "../_lib/db";
import { createD1Mock } from "./d1-mock";

const migrationSql = readFileSync(
  join(__dirname, "../../migrations/0001_initial.sql"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// KV mock — minimal in-memory implementation backed by a Map. TTL expiration
// is not simulated; tests are synchronous and don't need it.
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
// parseCookies
// ---------------------------------------------------------------------------

describe("parseCookies", () => {
  it("parses a multi-value Cookie header correctly", () => {
    const result = parseCookies("foo=bar; baz=qux; __session=abc123");
    expect(result).toEqual({ foo: "bar", baz: "qux", __session: "abc123" });
  });

  it("handles values that contain = signs", () => {
    const result = parseCookies("token=abc=def=ghi");
    expect(result).toEqual({ token: "abc=def=ghi" });
  });

  it("returns empty object for empty string", () => {
    expect(parseCookies("")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// State tokens
// ---------------------------------------------------------------------------

describe("generateState", () => {
  it("returns a non-empty UUID and stores it under state: prefix", async () => {
    const { kv, store } = createKVMock();
    const state = await generateState(kv);

    expect(state).toBeTruthy();
    expect(store.has(`state:${state}`)).toBe(true);
  });
});

describe("verifyState", () => {
  it("returns true for a valid state and deletes the key (one-time use)", async () => {
    const { kv, store } = createKVMock();
    const state = await generateState(kv);

    const valid = await verifyState(kv, state);
    expect(valid).toBe(true);

    // Key must be removed after verification
    expect(store.has(`state:${state}`)).toBe(false);
  });

  it("returns false for an unknown state", async () => {
    const { kv } = createKVMock();
    const valid = await verifyState(kv, "no-such-state");
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

describe("mintSession", () => {
  it("returns a non-empty token and stores session JSON under session: prefix", async () => {
    const { kv, store } = createKVMock();
    const token = await mintSession(kv, "user-123");

    expect(token).toBeTruthy();
    const raw = store.get(`session:${token}`);
    expect(raw).toBeTruthy();
    const data = JSON.parse(raw!);
    expect(data.user_id).toBe("user-123");
    expect(typeof data.created_at).toBe("number");
  });
});

describe("getSession", () => {
  it("returns SessionData with the correct user_id for a valid token", async () => {
    const { kv } = createKVMock();
    const token = await mintSession(kv, "user-456");

    const session = await getSession(kv, token);
    expect(session).not.toBeNull();
    expect(session!.user_id).toBe("user-456");
    expect(typeof session!.created_at).toBe("number");
  });

  it("returns null for an unknown token", async () => {
    const { kv } = createKVMock();
    const session = await getSession(kv, "ghost-token");
    expect(session).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requireUser
// ---------------------------------------------------------------------------

describe("requireUser", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createD1Mock(migrationSql);
  });

  it("returns 401 when no Cookie header is present", async () => {
    const { kv } = createKVMock();
    const req = new Request("http://localhost/api/auth/me");
    const result = await requireUser(req, kv, db);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 when the session cookie is missing from the header", async () => {
    const { kv } = createKVMock();
    const req = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: "other=value" },
    });
    const result = await requireUser(req, kv, db);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 when the session token is not found in KV", async () => {
    const { kv } = createKVMock();
    const req = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=invalid-token` },
    });
    const result = await requireUser(req, kv, db);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns the UserRow when session is valid and user exists in D1", async () => {
    const { kv } = createKVMock();

    const user = await getOrCreateUser(db, {
      github_id: 9001,
      login: "testuser",
      name: "Test User",
      avatar_url: "https://example.com/avatar.png",
    });

    const token = await mintSession(kv, user.id);
    const req = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    const result = await requireUser(req, kv, db);

    expect(result).not.toBeInstanceOf(Response);
    const row = result as Awaited<ReturnType<typeof getOrCreateUser>>;
    expect(row.id).toBe(user.id);
    expect(row.login).toBe("testuser");
    expect(row.github_id).toBe(9001);
  });
});
