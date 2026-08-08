export interface UserRow {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: number;
}

export interface WorkspaceRow {
  id: string;
  user_id: string;
  name: string;
  payload: string;
  version: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface GithubProfile {
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface WorkspaceUpsert {
  id: string;
  user_id: string;
  name: string;
  payload: string;
  version: number;
}

export async function getOrCreateUser(
  db: D1Database,
  github: GithubProfile,
): Promise<UserRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, github_id, login, name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         login      = excluded.login,
         name       = excluded.name,
         avatar_url = excluded.avatar_url`,
    )
    .bind(
      id,
      github.github_id,
      github.login,
      github.name,
      github.avatar_url,
      Date.now(),
    )
    .run();

  const row = await db
    .prepare(`SELECT * FROM users WHERE github_id = ?`)
    .bind(github.github_id)
    .first<UserRow>();
  if (!row)
    throw new Error(
      `User not found after upsert (github_id=${github.github_id})`,
    );
  return row;
}

/**
 * List a user's workspaces.
 *
 * Without `since`: returns only live (non-deleted) rows, ordered by updated_at DESC.
 * With `since` (a cursor previously issued by this endpoint — see
 * functions/api/workspaces/index.ts): returns all rows updated at-or-after
 * `since`, including soft-deleted ones, so clients can learn about deletions
 * on the next delta pull.
 *
 * The boundary is inclusive (`>=`, not `>`) by design: the cursor is captured
 * on the server immediately before this query runs, so a write racing that
 * exact instant could land with `updated_at` equal to the previously issued
 * cursor. An exclusive `>` would silently drop that row from every future
 * delta pull. `>=` trades a small amount of duplicate row re-delivery for
 * closing that race — safe because `mergeWorkspaces` on the client compares
 * `version` per row and treats re-receiving an already-applied version as a
 * no-op.
 */
export async function listWorkspaces(
  db: D1Database,
  userId: string,
  since?: number,
): Promise<WorkspaceRow[]> {
  if (since !== undefined) {
    const result = await db
      .prepare(
        `SELECT * FROM workspaces
         WHERE user_id = ? AND updated_at >= ?
         ORDER BY updated_at DESC`,
      )
      .bind(userId, since)
      .all<WorkspaceRow>();
    return result.results;
  }
  const result = await db
    .prepare(
      `SELECT * FROM workspaces
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<WorkspaceRow>();
  return result.results;
}

/**
 * Upsert a workspace row using last-write-wins semantics.
 *
 * Returns `{ accepted: true, row }` when the write was accepted (incoming
 * version >= stored version). Returns `{ accepted: false, row }` with the
 * current server row when the incoming version is stale — the caller should
 * return a 409 so the client can adopt the server row.
 *
 * Enforces user ownership: if a row with the given id already exists and
 * belongs to a different user, the ON CONFLICT clause rejects the write
 * (user_id guard) and `accepted` will be false. The post-upsert re-read is
 * scoped to `id AND user_id` so it can never return another user's row: in
 * the cross-user-collision case the scoped read matches nothing and this
 * returns `{ accepted: false, row: null }` — the caller should treat that as
 * not-found (404), never as a conflict body to echo back.
 */
export async function upsertWorkspace(
  db: D1Database,
  row: WorkspaceUpsert,
): Promise<{ accepted: boolean; row: WorkspaceRow | null }> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO workspaces (id, user_id, name, payload, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name       = excluded.name,
         payload    = excluded.payload,
         version    = excluded.version,
         updated_at = excluded.updated_at
       WHERE excluded.version >= workspaces.version
         AND workspaces.user_id = excluded.user_id`,
    )
    .bind(row.id, row.user_id, row.name, row.payload, row.version, now)
    .run();

  const current = await db
    .prepare(`SELECT * FROM workspaces WHERE id = ? AND user_id = ?`)
    .bind(row.id, row.user_id)
    .first<WorkspaceRow>();
  if (!current) {
    // Either the id collided with another user's row (the ON CONFLICT guard
    // rejected the write) or some other unexpected state. Both are treated
    // identically as "not accepted, nothing to return" — no cross-user data
    // ever crosses the function boundary.
    return { accepted: false, row: null };
  }

  // If the stored version is higher than what we sent, the WHERE clause
  // rejected the update — the write was not accepted.
  const accepted = current.version <= row.version;
  return { accepted, row: current };
}

export async function getWrappedDek(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT wrapped_dek FROM users WHERE id = ?")
    .bind(userId)
    .first<{ wrapped_dek: string | null }>();
  return row?.wrapped_dek ?? null;
}

/**
 * Store a wrapped DEK the first time a user sets one, and otherwise leave the
 * existing value untouched. This makes first-login races between two devices
 * safe: whichever device's UPDATE reaches the row first "wins" (the
 * `wrapped_dek IS NULL` guard turns the loser's UPDATE into a no-op), and
 * both callers read back the same winning value via the trailing SELECT.
 * Correctness relies on D1/SQLite serializing individual statements, the same
 * assumption `upsertWorkspace`'s conditional `ON CONFLICT ... WHERE` above
 * relies on.
 *
 * Returns the wrapped DEK now stored for this user (which may be the
 * caller's own value, or another device's if it won the race).
 */
export async function setWrappedDekIfAbsent(
  db: D1Database,
  userId: string,
  wrappedDek: string,
): Promise<string> {
  await db
    .prepare(
      "UPDATE users SET wrapped_dek = ? WHERE id = ? AND wrapped_dek IS NULL",
    )
    .bind(wrappedDek, userId)
    .run();

  const current = await getWrappedDek(db, userId);
  if (current === null) {
    throw new Error(
      `wrapped_dek missing after setWrappedDekIfAbsent (user_id=${userId})`,
    );
  }
  return current;
}

export async function getKwk(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT kwk FROM users WHERE id = ?")
    .bind(userId)
    .first<{ kwk: string | null }>();
  return row?.kwk ?? null;
}

/**
 * Store a KWK the first time a user needs one, and otherwise leave the
 * existing value untouched. Same race-safe contract as
 * `setWrappedDekIfAbsent`: whichever caller's UPDATE reaches the row first
 * wins (the `kwk IS NULL` guard turns a racing second UPDATE into a no-op),
 * and every caller reads back the same winning value via the trailing
 * SELECT. This closes the first-login KWK race described in TASK-118 — two
 * devices calling this concurrently with different freshly-generated KWKs
 * converge on one value instead of each keeping its own.
 *
 * Returns the KWK now stored for this user (which may be the caller's own
 * value, or another device's if it won the race).
 */
export async function setKwkIfAbsent(
  db: D1Database,
  userId: string,
  kwk: string,
): Promise<string> {
  await db
    .prepare("UPDATE users SET kwk = ? WHERE id = ? AND kwk IS NULL")
    .bind(kwk, userId)
    .run();

  const current = await getKwk(db, userId);
  if (current === null) {
    throw new Error(`kwk missing after setKwkIfAbsent (user_id=${userId})`);
  }
  return current;
}

/**
 * Unconditionally overwrite the stored KWK for a user. Unlike
 * setKwkIfAbsent, this has no `IS NULL` guard — it is used only to persist
 * a legacy KWK the client has already cryptographically proven correct by
 * successfully unwrapping the account's wrapped_dek with it (see TASK-128
 * / the `confirm_kwk` flow in enc-meta.ts). Never called on the normal
 * first-login path, where setKwkIfAbsent's conditional write is what keeps
 * concurrent first logins race-safe.
 */
export async function setKwk(
  db: D1Database,
  userId: string,
  kwk: string,
): Promise<void> {
  await db.prepare("UPDATE users SET kwk = ? WHERE id = ?").bind(kwk, userId).run();
}

/**
 * Soft-delete a workspace: set deleted_at, bump version, and update updated_at
 * so the deletion appears in delta pulls (?since=).
 *
 * Returns true if a row was updated, false if the id was not found or belongs
 * to a different user.
 */
export async function softDeleteWorkspace(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE workspaces
       SET deleted_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(now, now, id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
