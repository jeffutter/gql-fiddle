import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createD1Mock } from "./d1-mock";
import {
  getKwk,
  getOrCreateUser,
  getWrappedDek,
  listWorkspaces,
  setKwkIfAbsent,
  setWrappedDekIfAbsent,
  softDeleteWorkspace,
  upsertWorkspace,
} from "../_lib/db";

const migrationSql = [
  readFileSync(join(__dirname, "../../migrations/0001_initial.sql"), "utf-8"),
  readFileSync(
    join(__dirname, "../../migrations/0002_users_wrapped_dek.sql"),
    "utf-8",
  ),
  readFileSync(join(__dirname, "../../migrations/0003_users_kwk.sql"), "utf-8"),
].join("\n");

let db: D1Database;

beforeEach(() => {
  // Fresh in-memory SQLite for each test — isolation without teardown.
  db = createD1Mock(migrationSql);
});

describe("schema", () => {
  it("creates users and workspaces tables", async () => {
    const tables = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all<{ name: string }>();
    const names = tables.results.map((r) => r.name);
    expect(names).toContain("users");
    expect(names).toContain("workspaces");
  });

  it("creates idx_workspaces_user index", async () => {
    const idx = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_workspaces_user'`,
      )
      .first<{ name: string }>();
    expect(idx?.name).toBe("idx_workspaces_user");
  });
});

describe("getOrCreateUser", () => {
  it("creates a user and returns a row with a uuid id", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 1001,
      login: "alice",
      name: "Alice",
      avatar_url: "https://example.com/alice.png",
    });
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(user.login).toBe("alice");
    expect(user.github_id).toBe(1001);
  });

  it("is idempotent — same github_id returns same uuid", async () => {
    const first = await getOrCreateUser(db, {
      github_id: 1002,
      login: "bob",
      name: "Bob",
      avatar_url: null,
    });
    const second = await getOrCreateUser(db, {
      github_id: 1002,
      login: "bob-renamed",
      name: "Bob Renamed",
      avatar_url: null,
    });
    expect(second.id).toBe(first.id);
    expect(second.login).toBe("bob-renamed");
  });
});

describe("upsertWorkspace and listWorkspaces", () => {
  it("inserts a workspace and lists it", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 2001,
      login: "carol",
      name: null,
      avatar_url: null,
    });

    const { accepted, row: ws } = await upsertWorkspace(db, {
      id: "ws-aaaa-0001",
      user_id: user.id,
      name: "My Workspace",
      payload: JSON.stringify({ subgraphs: [] }),
      version: 1,
    });

    expect(accepted).toBe(true);
    expect(ws).not.toBeNull();
    expect(ws?.id).toBe("ws-aaaa-0001");
    expect(ws?.name).toBe("My Workspace");
    expect(ws?.deleted_at).toBeNull();

    const list = await listWorkspaces(db, user.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(ws?.id);
  });

  it("last-write-wins: lower version does not overwrite", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 2002,
      login: "dave",
      name: null,
      avatar_url: null,
    });

    await upsertWorkspace(db, {
      id: "ws-bbbb-0002",
      user_id: user.id,
      name: "v2 name",
      payload: "{}",
      version: 2,
    });

    // Lower version — must not overwrite
    const { accepted, row } = await upsertWorkspace(db, {
      id: "ws-bbbb-0002",
      user_id: user.id,
      name: "v1 name (stale)",
      payload: "{}",
      version: 1,
    });

    // Same-user stale-version conflict must still return the caller's own
    // current row (non-null) so the 409 body can echo it back.
    expect(accepted).toBe(false);
    expect(row).not.toBeNull();
    expect(row?.name).toBe("v2 name");
    expect(row?.version).toBe(2);

    const list = await listWorkspaces(db, user.id);
    expect(list[0].name).toBe("v2 name");
    expect(list[0].version).toBe(2);
  });

  it("cross-user id collision: never returns another user's row", async () => {
    const userA = await getOrCreateUser(db, {
      github_id: 2010,
      login: "alice",
      name: null,
      avatar_url: null,
    });
    const userB = await getOrCreateUser(db, {
      github_id: 2011,
      login: "bob",
      name: null,
      avatar_url: null,
    });

    await upsertWorkspace(db, {
      id: "ws-ffff-0006",
      user_id: userA.id,
      name: "Alice's Workspace",
      payload: JSON.stringify({ secret: "alice-only" }),
      version: 1,
    });

    // Same id, different user — the ON CONFLICT owner guard rejects the
    // write, and the scoped re-read must find nothing to leak.
    const { accepted, row } = await upsertWorkspace(db, {
      id: "ws-ffff-0006",
      user_id: userB.id,
      name: "Bob's attempt",
      payload: JSON.stringify({ secret: "bob-payload" }),
      version: 1,
    });

    expect(accepted).toBe(false);
    expect(row).toBeNull();
  });

  it("delta filter is inclusive: since === row.updated_at still returns the row", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 2003,
      login: "grace",
      name: null,
      avatar_url: null,
    });

    const { row } = await upsertWorkspace(db, {
      id: "ws-eeee-0005",
      user_id: user.id,
      name: "Boundary",
      payload: "{}",
      version: 1,
    });
    expect(row).not.toBeNull();

    // Under the old exclusive `>` comparison this row would be excluded.
    const list = await listWorkspaces(db, user.id, row!.updated_at);
    expect(list.map((r) => r.id)).toContain(row!.id);
  });
});

describe("softDeleteWorkspace", () => {
  it("hides the workspace from listWorkspaces but keeps the row", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 3001,
      login: "eve",
      name: null,
      avatar_url: null,
    });

    await upsertWorkspace(db, {
      id: "ws-cccc-0003",
      user_id: user.id,
      name: "To Delete",
      payload: "{}",
      version: 1,
    });

    const deleted = await softDeleteWorkspace(db, "ws-cccc-0003", user.id);
    expect(deleted).toBe(true);

    // No longer in live list
    const list = await listWorkspaces(db, user.id);
    expect(list).toHaveLength(0);

    // Row still exists with deleted_at set
    const raw = await db
      .prepare(`SELECT deleted_at FROM workspaces WHERE id = ?`)
      .bind("ws-cccc-0003")
      .first<{ deleted_at: number | null }>();
    expect(raw?.deleted_at).not.toBeNull();
  });

  it("returns false for wrong owner", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 3002,
      login: "frank",
      name: null,
      avatar_url: null,
    });

    await upsertWorkspace(db, {
      id: "ws-dddd-0004",
      user_id: user.id,
      name: "Protected",
      payload: "{}",
      version: 1,
    });

    const deleted = await softDeleteWorkspace(
      db,
      "ws-dddd-0004",
      "wrong-user-id",
    );
    expect(deleted).toBe(false);
  });
});

describe("getWrappedDek / setWrappedDekIfAbsent", () => {
  it("returns null when no wrapped_dek has been set", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 4001,
      login: "grace",
      name: null,
      avatar_url: null,
    });
    expect(await getWrappedDek(db, user.id)).toBeNull();
  });

  it("stores and retrieves wrapped_dek", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 4002,
      login: "henry",
      name: null,
      avatar_url: null,
    });
    const stored = await setWrappedDekIfAbsent(db, user.id, "E1:abc123==");
    expect(stored).toBe("E1:abc123==");
    expect(await getWrappedDek(db, user.id)).toBe("E1:abc123==");
  });

  it("ignores a second call and returns the first-stored wrapped_dek", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 4003,
      login: "isla",
      name: null,
      avatar_url: null,
    });
    const first = await setWrappedDekIfAbsent(db, user.id, "E1:first==");
    const second = await setWrappedDekIfAbsent(db, user.id, "E1:second==");
    expect(first).toBe("E1:first==");
    expect(second).toBe("E1:first==");
    expect(await getWrappedDek(db, user.id)).toBe("E1:first==");
  });
});

describe("getKwk / setKwkIfAbsent", () => {
  it("returns null when no kwk has been set", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 5001,
      login: "jack",
      name: null,
      avatar_url: null,
    });
    expect(await getKwk(db, user.id)).toBeNull();
  });

  it("stores and retrieves kwk", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 5002,
      login: "kate",
      name: null,
      avatar_url: null,
    });
    const stored = await setKwkIfAbsent(db, user.id, "kwk-abc123==");
    expect(stored).toBe("kwk-abc123==");
    expect(await getKwk(db, user.id)).toBe("kwk-abc123==");
  });

  it("ignores a second call and returns the first-stored kwk — the TASK-118 race regression test", async () => {
    const user = await getOrCreateUser(db, {
      github_id: 5003,
      login: "liam",
      name: null,
      avatar_url: null,
    });
    // Simulates two devices racing the first GET /api/auth/enc-meta: both
    // generate a different KWK and both call setKwkIfAbsent concurrently.
    // Only the first write should stick; both callers must converge on it.
    const first = await setKwkIfAbsent(db, user.id, "kwk-first==");
    const second = await setKwkIfAbsent(db, user.id, "kwk-second==");
    expect(first).toBe("kwk-first==");
    expect(second).toBe("kwk-first==");
    expect(await getKwk(db, user.id)).toBe("kwk-first==");
  });
});
