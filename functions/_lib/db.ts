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
 * With `since` (epoch ms): returns all rows updated after `since`, including
 * soft-deleted ones, so clients can learn about deletions on the next delta pull.
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
         WHERE user_id = ? AND updated_at > ?
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
 * (user_id guard) and `accepted` will be false.
 */
export async function upsertWorkspace(
  db: D1Database,
  row: WorkspaceUpsert,
): Promise<{ accepted: boolean; row: WorkspaceRow }> {
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
    .prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(row.id)
    .first<WorkspaceRow>();
  if (!current)
    throw new Error(`Workspace not found after upsert (id=${row.id})`);

  // If the stored version is higher than what we sent, the WHERE clause
  // rejected the update — the write was not accepted.
  const accepted =
    current.version <= row.version && current.user_id === row.user_id;
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

export async function setWrappedDek(
  db: D1Database,
  userId: string,
  wrappedDek: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET wrapped_dek = ? WHERE id = ?")
    .bind(wrappedDek, userId)
    .run();
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
