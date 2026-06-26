// Durable Object: UserSyncDO (TASK-88.8)
//
// One per user (keyed by user.id).  Holds all open WebSocket connections for
// that user's devices using the hibernatable WebSocket API — no CPU is billed
// while sockets are idle, keeping the implementation within the free tier.
//
// Two sub-paths:
//   POST /connect  — upgrades the request to a WebSocket and accepts it
//   POST /broadcast — fans the request body (invalidation JSON) to all open sockets

// Durable Objects need no D1 or KV access; the Env type is empty.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Env {}

export class UserSyncDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ------------------------------------------------------------------
    // /connect — upgrade to WebSocket and register with hibernatable API
    // ------------------------------------------------------------------
    if (url.pathname.endsWith("/connect")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 400 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // acceptWebSocket registers the server socket with the runtime so the
      // DO can hibernate between messages — no CPU billed while idle.
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // ------------------------------------------------------------------
    // /broadcast — fan-out the body payload to every registered socket
    // ------------------------------------------------------------------
    if (url.pathname.endsWith("/broadcast") && request.method === "POST") {
      const payload = await request.text();
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(payload);
        } catch {
          // Skip sockets that have closed or errored since the last getWebSockets() call.
        }
      }
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }

  // Called by the hibernatable WebSocket runtime when a client sends a frame.
  // Clients only receive invalidation signals — they never send anything — so
  // this handler intentionally does nothing.
  webSocketMessage(_ws: WebSocket, _msg: string | ArrayBuffer): void {}

  // Called when a WebSocket closes.  Hibernatable sockets are auto-cleaned by
  // the runtime; no manual bookkeeping is needed.
  webSocketClose(_ws: WebSocket, _code: number, _reason: string): void {}
}
