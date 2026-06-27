// GET /api/ws — WebSocket upgrade endpoint (TASK-88.8)
//
// Authenticates the caller via the existing session cookie, then forwards the
// WebSocket upgrade to the user's per-user UserSyncDO instance.  The DO holds
// all open WebSocket connections for that user and broadcasts lightweight
// invalidation signals when workspaces are written from any device.
//
// Re-exporting UserSyncDO at the module level is required so wrangler discovers
// the class and registers it in the Pages Functions bundle.
import { requireUser } from "../../_lib/auth";
export { UserSyncDO } from "../../_lib/UserSyncDO";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  USER_SYNC?: DurableObjectNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
  if (result instanceof Response) return result;
  const user = result;

  if (!ctx.env.USER_SYNC) {
    return new Response("WebSocket sync unavailable", { status: 503 });
  }
  const doId = ctx.env.USER_SYNC.idFromName(user.id);
  const stub = ctx.env.USER_SYNC.get(doId);

  // Forward the WebSocket upgrade to the DO's /connect handler.
  // The DO runtime handles the WebSocket handoff transparently.
  const doUrl = new URL(ctx.request.url);
  doUrl.pathname = "/connect";
  return stub.fetch(new Request(doUrl, ctx.request));
};
