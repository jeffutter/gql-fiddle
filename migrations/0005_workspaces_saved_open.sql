-- Migration 0005: saved/open flags on workspaces (TASK-126.1)
--
-- `saved`: whether the workspace is marked to persist past tab close.
--   Defaults to 0 (false) for pre-existing rows, which have no saved
--   concept today — closing their tab keeps today's immediate-delete
--   behavior unchanged.
-- `open`: whether the workspace currently appears as a tab. This is
--   shared/synced state (not per-device local UI state). Defaults to 1
--   (true) so every pre-existing non-deleted workspace keeps appearing as
--   a tab on every device, exactly as today.
--
-- SQLite has no native boolean type; these columns are stored as
-- INTEGER 0/1. functions/_lib/db.ts owns the encoding and is the only
-- place (besides the PUT handler's narrow ownership-check query) that
-- should know about it.

ALTER TABLE workspaces ADD COLUMN saved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN open INTEGER NOT NULL DEFAULT 1;
