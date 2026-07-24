-- Migration 0004: live_sessions table for real-time collaborative editing (TASK-119.1)
--
-- Stores encoded Yjs document state for each live collaboration session.
-- Sessions are ephemeral and auto-cleaned after 24h of inactivity by the
-- Durable Object alarm handler. This table is separate from the account-based
-- workspaces table and is not encrypted.

CREATE TABLE IF NOT EXISTS live_sessions (
  id              TEXT PRIMARY KEY,           -- UUID session identifier
  encoded_state   BLOB,                       -- Yjs-encoded document snapshot (null on creation)
  created_at      INTEGER NOT NULL,           -- Unix ms timestamp of session creation
  last_active_at  INTEGER NOT NULL            -- Unix ms timestamp of last client activity
);

-- Index on last_active_at for efficient idle session scanning during cleanup
CREATE INDEX IF NOT EXISTS idx_live_sessions_last_active ON live_sessions(last_active_at);