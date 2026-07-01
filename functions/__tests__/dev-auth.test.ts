// Unit tests for the dev-mode auth bypass endpoints (TASK-88.9).
// Uses the D1 mock and inline KV mock from existing test helpers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet as loginHandler } from "../api/auth/login";
import { onRequestGet as devLoginHandler } from "../api/auth/dev-login";
import { onRequestGet as callbackHandler } from "../api/auth/github/callback";
import { SESSION_COOKIE_NAME } from "../_lib/auth";
import { createD1Mock } from "./d1-mock";

const migrationSql = readFileSync(
  join(__dirname, "../../migrations/0001_initial.sql"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// KV mock (same pattern as auth.test.ts)
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
// Helper: build a minimal PagesFunction context
// ---------------------------------------------------------------------------

function makeCtx<E>(
  env: E,
  url = "http://localhost:8788",
): Parameters<PagesFunction<E>>[0] {
  return {
    request: new Request(url),
    env,
    params: {},
    waitUntil: () => {},
    passThroughOnException: () => {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
    pluginArgs: {},
    functionPath: "",
  } as unknown as Parameters<PagesFunction<E>>[0];
}

// ---------------------------------------------------------------------------
// GET /api/auth/login
// ---------------------------------------------------------------------------

describe("GET /api/auth/login", () => {
  it("redirects to /api/auth/github when ENVIRONMENT=production", async () => {
    const ctx = makeCtx({ ENVIRONMENT: "production" });
    const res = await loginHandler(ctx);

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.pathname).toBe("/api/auth/github");
  });

  it("redirects to /api/auth/github when ENVIRONMENT is unset (fail-closed, e.g. previews)", async () => {
    const ctx = makeCtx<{ ENVIRONMENT?: string }>({});
    const res = await loginHandler(ctx);

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.pathname).toBe("/api/auth/github");
  });

  it("redirects to /api/auth/dev-login when ENVIRONMENT=development", async () => {
    const ctx = makeCtx({ ENVIRONMENT: "development" });
    const res = await loginHandler(ctx);

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.pathname).toBe("/api/auth/dev-login");
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/dev-login
// ---------------------------------------------------------------------------

describe("GET /api/auth/dev-login", () => {
  let db: D1Database;
  let kv: KVNamespace;

  beforeEach(() => {
    db = createD1Mock(migrationSql);
    kv = createKVMock();
  });

  it("returns 404 when ENVIRONMENT=production", async () => {
    const ctx = makeCtx({ DB: db, SESSIONS: kv, ENVIRONMENT: "production" });
    const res = await devLoginHandler(ctx);
    expect(res.status).toBe(404);
  });

  it("returns 404 when ENVIRONMENT is unset (fail-closed, e.g. previews)", async () => {
    const ctx = makeCtx<{
      DB: D1Database;
      SESSIONS: KVNamespace;
      ENVIRONMENT?: string;
    }>({
      DB: db,
      SESSIONS: kv,
    });
    const res = await devLoginHandler(ctx);
    expect(res.status).toBe(404);
  });

  it("returns 302 to / and sets session cookie when ENVIRONMENT=development", async () => {
    const ctx = makeCtx({
      DB: db,
      SESSIONS: kv,
      ENVIRONMENT: "development",
      DEV_USER_ID: "dev-user-1",
    });
    const res = await devLoginHandler(ctx);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");

    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("defaults DEV_USER_ID to dev-user-1 when env var is unset", async () => {
    const ctx = makeCtx({ DB: db, SESSIONS: kv, ENVIRONMENT: "development" });
    const res = await devLoginHandler(ctx);
    expect(res.status).toBe(302);
    // Second call should return the same user (idempotent via github_id=0 + login)
    const res2 = await devLoginHandler(
      makeCtx({ DB: db, SESSIONS: kv, ENVIRONMENT: "development" }),
    );
    expect(res2.status).toBe(302);
  });

  it("is idempotent — second call returns the same user.id", async () => {
    const env = {
      DB: db,
      SESSIONS: kv,
      ENVIRONMENT: "development",
      DEV_USER_ID: "dev-user-1",
    };
    await devLoginHandler(makeCtx(env));

    // Read the user row created by the first call
    const row1 = await db
      .prepare("SELECT id FROM users WHERE login = ?")
      .bind("dev-user-1")
      .first<{ id: string }>();
    expect(row1).not.toBeNull();

    await devLoginHandler(makeCtx(env));

    const row2 = await db
      .prepare("SELECT id FROM users WHERE login = ?")
      .bind("dev-user-1")
      .first<{ id: string }>();
    expect(row2).not.toBeNull();

    // getOrCreateUser is idempotent — same id on second call
    expect(row1!.id).toBe(row2!.id);
  });

  it("emits an auth.login_success log event with the user_id and provider, with no session token leaked", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const ctx = makeCtx({
        DB: db,
        SESSIONS: kv,
        ENVIRONMENT: "development",
        DEV_USER_ID: "dev-user-1",
      });
      const res = await devLoginHandler(ctx);
      const cookie = res.headers.get("Set-Cookie") ?? "";
      const token = cookie.match(/__session=([^;]+)/)?.[1];
      expect(token).toBeTruthy();

      const lines = logSpy.mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      const loginLine = lines.find((line) =>
        line.includes("auth.login_success"),
      );
      expect(loginLine).toBeDefined();
      const record = JSON.parse(loginLine!);
      expect(record.provider).toBe("dev");
      expect(typeof record.user_id).toBe("string");

      // No log line anywhere should contain the session token.
      for (const line of lines) {
        expect(line).not.toContain(token);
      }
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/github/callback
// ---------------------------------------------------------------------------

describe("GET /api/auth/github/callback", () => {
  let db: D1Database;
  let kv: KVNamespace;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createD1Mock(migrationSql);
    kv = createKVMock();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  function stubGithubFetch(accessToken = "gh-access-token-secret") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("login/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: accessToken }), {
            status: 200,
          });
        }
        if (url.includes("api.github.com/user")) {
          return new Response(
            JSON.stringify({
              id: 4242,
              login: "octocat",
              name: "Octo Cat",
              avatar_url: null,
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    return accessToken;
  }

  async function withValidState() {
    const state = await import("../_lib/auth").then((m) => m.generateState(kv));
    return state;
  }

  it("mints a session, redirects to /, and emits auth.login_success without leaking the GitHub access token", async () => {
    const accessToken = stubGithubFetch();
    const state = await withValidState();

    const ctx = {
      request: new Request(
        `http://localhost/api/auth/github/callback?code=abc123&state=${state}`,
      ),
      env: {
        DB: db,
        SESSIONS: kv,
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
      },
      params: {},
      waitUntil: () => {},
      passThroughOnException: () => {},
      next: async () => new Response(null, { status: 404 }),
      data: {},
      pluginArgs: {},
      functionPath: "",
    } as unknown as Parameters<typeof callbackHandler>[0];

    const res = await callbackHandler(ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");

    const lines: string[] = logSpy.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    const loginLine = lines.find((line: string) =>
      line.includes("auth.login_success"),
    );
    expect(loginLine).toBeDefined();
    const record = JSON.parse(loginLine!);
    expect(record.provider).toBe("github");
    expect(typeof record.user_id).toBe("string");

    for (const line of lines) {
      expect(line).not.toContain(accessToken);
    }
  });

  it("returns a generic JSON error (not plain text) when state is invalid", async () => {
    const ctx = {
      request: new Request(
        `http://localhost/api/auth/github/callback?code=abc123&state=bogus`,
      ),
      env: {
        DB: db,
        SESSIONS: kv,
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
      },
      params: {},
      waitUntil: () => {},
      passThroughOnException: () => {},
      next: async () => new Response(null, { status: 404 }),
      data: {},
      pluginArgs: {},
      functionPath: "",
    } as unknown as Parameters<typeof callbackHandler>[0];

    const res = await callbackHandler(ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();

    const lines: string[] = logSpy.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    const stateLine = lines.find((line: string) =>
      line.includes("auth.state_invalid"),
    );
    expect(stateLine).toBeDefined();
  });
});
