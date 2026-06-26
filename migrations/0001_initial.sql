CREATE TABLE users (
  id           TEXT PRIMARY KEY,        -- internal uuid
  github_id    INTEGER UNIQUE NOT NULL,
  login        TEXT NOT NULL,
  name         TEXT,
  avatar_url   TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE workspaces (
  id           TEXT PRIMARY KEY,        -- client-generated uuid (stable across devices)
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  payload      TEXT NOT NULL,           -- JSON of WorkspaceEntry (subgraphs, queryTabs, seed, mockConfig, tourDraft)
  version      INTEGER NOT NULL DEFAULT 1,  -- monotonic, for last-write-wins
  updated_at   INTEGER NOT NULL,        -- epoch ms, set server-side
  deleted_at   INTEGER                  -- soft delete (null = live); lets other devices learn about deletions
);
CREATE INDEX idx_workspaces_user ON workspaces(user_id);
