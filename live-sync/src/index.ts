// Live sync worker — standalone Cloudflare Worker with Durable Object.
//
// Routes:
//   GET  /ws/:sessionId  — WebSocket upgrade for joining a session
//   GET  /health         — Liveness probe
//
// Session CRUD lives in the Pages Function at /api/live-session
// (functions/api/live-session/index.ts). That function creates sessions via D1
// and returns this worker's WebSocket URL. Clients connect directly here for
// the WebSocket relay.
import { LiveSession } from "./session";

// Durable Object classes must be exported from the Worker's entrypoint module
// for the runtime to bind them — importing alone isn't enough.
export { LiveSession };

interface Env {
  LiveSession: DurableObjectNamespace;
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === "/health") {
      return Response.json({ ok: true });
    }

    // GET /ws/:sessionId — WebSocket upgrade
    if (path.startsWith("/ws/")) {
      const sessionId = path.slice(4); // strip "/ws/"
      if (!sessionId) {
        return new Response("Missing session ID", { status: 400 });
      }
      const doId = env.LiveSession.idFromName(sessionId);
      const doInstance = env.LiveSession.get(doId);
      return doInstance.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;