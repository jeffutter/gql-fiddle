// Live-session Pages Function.
//
// POST /api/live-session — create a new live collaboration session.
// Creates a session ID and persists it in D1. Returns the session id and
// the WebSocket URL that clients should connect to for real-time sync.
//
// GET /api/live-session?ls=<sessionId> — fetch session metadata for joiners.
// Returns the session id and WebSocket URL so a joiner can reconstruct the
// connection without knowing the live-sync worker's origin.
//
// The live-sync Worker (a separate Durable Object deployment) handles the
// actual WebSocket connections. This function coordinates with it by sharing
// the same D1 database for session state.
import { withErrorHandling } from "../../_lib/http";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  /** Origin of the live-sync worker (set via config var). */
  LIVE_SYNC_URL?: string;
}

/** Build the WebSocket URL from the LIVE_SYNC_URL config var. */
function buildWsUrl(env: Env, sessionId: string): string {
  const liveSyncUrl = env.LIVE_SYNC_URL ?? "http://localhost:8789";
  const wsProtocol = liveSyncUrl.startsWith("https") ? "wss" : "ws";
  const wsHost = liveSyncUrl.replace(/^https?:\/\//, "");
  return `${wsProtocol}://${wsHost}/ws/${sessionId}`;
}

// ── POST /api/live-session — create a new session ────────────────────────────

export const onRequestPost: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    // Insert the session row in D1. The live-sync Worker's DO will pick this
    // up when a client connects. We use INSERT OR IGNORE so retries are safe.
    await ctx.env.DB
      .prepare(
        `INSERT OR IGNORE INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, now, now)
      .run();

    return Response.json({
      sessionId,
      wsUrl: buildWsUrl(ctx.env, sessionId),
      createdAt: new Date().toISOString(),
    });
  },
);

/**
 * GET /api/live-session?ls=<sessionId>
 *
 * Returns session metadata (session id + WebSocket URL) for a joiner opening
 * a shared live-session link. No auth required — ephemeral access only.
 */
export const onRequestGet: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const sessionId = url.searchParams.get("ls");
    if (!sessionId || !/^[0-9a-f]{8}-/.test(sessionId)) {
      return new Response("Invalid session ID", { status: 400 });
    }

    const row = await ctx.env.DB
      .prepare("SELECT id, created_at FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ id: string; created_at: number }>();

    if (!row) {
      return new Response("Session not found", { status: 404 });
    }

    return Response.json({
      sessionId: row.id,
      wsUrl: buildWsUrl(ctx.env, row.id),
      createdAt: row.created_at,
    });
  },
);