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

export async function getOrCreateUser(db: D1Database, github: GithubProfile): Promise<UserRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, github_id, login, name, avatar_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         login      = excluded.login,
         name       = excluded.name,
         avatar_url = excluded.avatar_url`
    )
    .bind(id, github.github_id, github.login, github.name, github.avatar_url, Date.now())
    .run();

  const row = await db
    .prepare(`SELECT * FROM users WHERE github_id = ?`)
    .bind(github.github_id)
    .first<UserRow>();
  if (!row) throw new Error(`User not found after upsert (github_id=${github.github_id})`);
  return row;
}

export async function listWorkspaces(db: D1Database, userId: string): Promise<WorkspaceRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM workspaces
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`
    )
    .bind(userId)
    .all<WorkspaceRow>();
  return result.results;
}

export async function upsertWorkspace(db: D1Database, row: WorkspaceUpsert): Promise<WorkspaceRow> {
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
       WHERE excluded.version >= workspaces.version`
    )
    .bind(row.id, row.user_id, row.name, row.payload, row.version, now)
    .run();

  const updated = await db
    .prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(row.id)
    .first<WorkspaceRow>();
  if (!updated) throw new Error(`Workspace not found after upsert (id=${row.id})`);
  return updated;
}

export async function softDeleteWorkspace(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE workspaces SET deleted_at = ? WHERE id = ? AND user_id = ?`)
    .bind(Date.now(), id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
