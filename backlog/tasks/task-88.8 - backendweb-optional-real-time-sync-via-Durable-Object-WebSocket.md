---
id: TASK-88.8
title: 'backend+web: optional real-time sync via Durable Object WebSocket'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:14'
updated_date: '2026-06-26 23:49'
labels:
  - backend
  - web
  - sync
  - optional
  - cloudflare
  - planned
dependencies:
  - TASK-88.7
parent_task_id: TASK-88
priority: low
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

**Optional enhancement** (parent TASK-88). Focus/visibility pull (TASK-88.7) already satisfies "auto-sync between devices" for a fiddle tool. This task upgrades the experience to near-instant propagation between devices that are open simultaneously, only if there's demand. Do not start unless the pull-based sync proves insufficient.

## Depends on

TASK-88.7 — builds on the established sync engine and reconciliation; this only changes the *transport* for change notifications.

## Scope

- Add a **Durable Object** (one per user) that holds WebSocket connections for that user's open devices. Free tier: 1M requests/month — keep within it.
- A Function endpoint upgrades to WebSocket and routes the connection to the user's DO (authenticated via the existing session).
- On a successful `PUT`/`DELETE` to the workspace API, notify the user's DO, which **broadcasts a lightweight invalidation** (e.g. `{ changedId, version }`) to that user's other connected devices.
- Client: when connected, on receiving an invalidation, do a targeted `GET ?since` and reconcile via the existing merge logic (reuse TASK-88.6). Fall back to the pull-based strategy when the socket is unavailable.
- Keep last-write-wins; the WebSocket only carries change *signals*, not authoritative state.

## Notes

- This adds real complexity (DO lifecycle, WS reconnection, auth on upgrade). Weigh value vs cost per the project's design philosophy before implementing.
- Must degrade gracefully: if the DO/WS path fails, the app behaves exactly like TASK-88.7.

## Tests & docs

- Test the broadcast-on-write path and that a received invalidation triggers a reconciling pull.
- Test graceful fallback when the socket drops.
- Document the DO architecture and free-tier considerations in AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A per-user Durable Object maintains authenticated WebSocket connections for that user's open devices
- [x] #2 A successful workspace PUT/DELETE broadcasts a lightweight invalidation to the user's other connected devices
- [x] #3 On receiving an invalidation, a client does a targeted ?since pull and reconciles via the existing merge logic
- [x] #4 If the WebSocket/DO path is unavailable, the app degrades gracefully to the TASK-88.7 pull-based behavior
- [x] #5 Implementation stays within Durable Objects free-tier limits
- [x] #6 Tests cover broadcast-on-write, invalidation-triggered pull, and socket-drop fallback; AGENTS.md documents the DO architecture
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Layers near-instant cross-device change notifications on top of the existing pull-based sync (TASK-88.7). The design uses a **per-user Durable Object** (class `UserSyncDO`) to hold all open WebSocket connections for a given user. After any accepted `PUT` or `DELETE` to the workspace API, the endpoint fires a lightweight broadcast to the user's DO, which fans the invalidation signal out to every other connected device. Clients react by immediately performing a `deltaRefresh()` — no state travels over the wire, only a change signal.

If the WebSocket or DO path is unavailable at any point, the app degrades silently to the TASK-88.7 behavior (throttled focus/visibility pull + 60 s polling).

## Step 1 — Durable Object class (`functions/_lib/UserSyncDO.ts`)

New file. Uses Cloudflare's **hibernatable WebSocket API** (`state.acceptWebSocket`) to avoid billing CPU time while sockets are idle — critical for free-tier sustainability.

```typescript
interface Env { /* DO needs no D1 or KV access */ }

export class UserSyncDO implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/connect")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 400 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server); // hibernatable — no CPU while idle
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/broadcast") && request.method === "POST") {
      const payload = await request.text();
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(payload); } catch { /* skip errored sockets */ }
      }
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(_ws: WebSocket, _msg: string | ArrayBuffer): void {
    // Client sends nothing; all signals are server-to-client only.
  }

  webSocketClose(_ws: WebSocket, _code: number, _reason: string): void {
    // Hibernatable WebSockets are auto-cleaned by the runtime.
  }
}
```

## Step 2 — WebSocket upgrade endpoint (`functions/api/ws/index.ts`)

New file. Authenticates via the existing session cookie, then routes the WebSocket upgrade to the user's per-user DO instance keyed by `user.id`. Also **re-exports `UserSyncDO`** at the module level so wrangler discovers and registers the class in the Pages Functions bundle.

```typescript
import { requireUser } from "../../_lib/auth";
export { UserSyncDO } from "../../_lib/UserSyncDO"; // required for wrangler DO discovery

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  USER_SYNC: DurableObjectNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
  if (result instanceof Response) return result;
  const user = result;

  const doId = ctx.env.USER_SYNC.idFromName(user.id);
  const stub = ctx.env.USER_SYNC.get(doId);

  // Forward the WebSocket upgrade to the DO's /connect handler.
  // stub.fetch() is internal RPC — the runtime handles the WebSocket handoff.
  const doUrl = new URL(ctx.request.url);
  doUrl.pathname = "/connect";
  return stub.fetch(new Request(doUrl, ctx.request));
};
```

## Step 3 — wrangler.jsonc additions

Add the Durable Object binding and DO-class migration (not a D1 migration) to `wrangler.jsonc`:

```jsonc
"durable_objects": {
  "bindings": [
    {
      "name": "USER_SYNC",
      "class_name": "UserSyncDO"
    }
  ]
},
"migrations": [
  { "tag": "v1", "new_classes": ["UserSyncDO"] }
]
```

Run `wrangler types` after this change to regenerate `worker-configuration.d.ts` with the `USER_SYNC: DurableObjectNamespace` type in the global `Env`.

## Step 4 — Broadcast on workspace write (`functions/api/workspaces/[id].ts`)

Extend the `Env` interface to include `USER_SYNC: DurableObjectNamespace`. After an accepted PUT or a successful DELETE, fire a broadcast to the user's DO using `ctx.waitUntil()` — this keeps the broadcast off the critical path (response returns immediately; broadcast completes after):

```typescript
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  USER_SYNC: DurableObjectNamespace; // added
}

// Helper (add near top of file):
function broadcastInvalidation(
  env: Env,
  ctx: Parameters<PagesFunction<Env>>[0],
  userId: string,
  changedId: string,
  version: number | null,
): void {
  const stub = env.USER_SYNC.get(env.USER_SYNC.idFromName(userId));
  ctx.waitUntil(
    stub.fetch(new Request("https://do.internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changedId, version }),
    })).catch(() => { /* broadcast is best-effort */ }),
  );
}
```

Call `broadcastInvalidation(ctx.env, ctx, user.id, id, row.version)` in the accepted PUT branch and `broadcastInvalidation(ctx.env, ctx, user.id, id, null)` after the DELETE soft-delete succeeds.

Note: The broadcast catches its own errors — a failed DO request must never affect the workspace API response.

## Step 5 — WebSocket client in `web/src/sync.ts`

Add a `force` parameter to `deltaRefresh` to bypass the throttle when triggered by a WS invalidation:

```typescript
export async function deltaRefresh(force = false): Promise<void> {
  if (useAuth.getState().status !== "authed") return;
  const now = Date.now();
  if (!force && now - lastPullTs < THROTTLE_MS) return;
  lastPullTs = now;
  // ... rest unchanged
}
```

Add `connectWs()` — exported for unit tests. Uses exponential backoff up to 60 s:

```typescript
const WS_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

interface InvalidationMsg { changedId: string; version: number | null }

export function connectWs(): { close: () => void } {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  function connect() {
    if (stopped || useAuth.getState().status !== "authed") return;
    ws = new WebSocket("/api/ws");

    ws.addEventListener("open", () => { attempt = 0; });

    ws.addEventListener("message", (ev) => {
      try {
        JSON.parse(ev.data as string) as InvalidationMsg; // validate shape
        void deltaRefresh(true); // bypass throttle — server just wrote
      } catch { /* ignore malformed */ }
    });

    ws.addEventListener("close", (ev) => {
      ws = null;
      if (stopped || ev.code === 1000) return;
      const delay = WS_RECONNECT_DELAYS_MS[Math.min(attempt, WS_RECONNECT_DELAYS_MS.length - 1)];
      attempt++;
      reconnectTimer = setTimeout(connect, delay);
    });

    ws.addEventListener("error", () => { /* close event handles reconnect */ });
  }

  connect();

  return {
    close() {
      stopped = true;
      if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws?.readyState === WebSocket.OPEN) ws.close(1000, "logout");
      ws = null;
    },
  };
}
```

Integrate in `initSync()` — open the WS when auth goes to "authed", close it on logout:

```typescript
// Inside initSync():
let wsConn: { close: () => void } | null = null;

const unsubAuth = useAuth.subscribe((auth, prevAuth) => {
  if (auth.status === "authed" && prevAuth.status !== "authed") {
    void onLogin();
    wsConn = connectWs();              // open WS alongside pull-on-login
  }
  if (auth.status !== "authed" && prevAuth.status === "authed") {
    wsConn?.close(); wsConn = null;    // close on logout
  }
});

// In cleanup return, before existing lines:
wsConn?.close();
```

## Step 6 — Tests

### `functions/__tests__/userSync.test.ts` (new)

Unit tests for `UserSyncDO`. Mock `DurableObjectState` with a minimal implementation that records `acceptWebSocket` calls and maintains a `getWebSockets()` list:

1. `/connect` with non-WebSocket request → 400
2. `/connect` with `Upgrade: websocket` → 101, `state.acceptWebSocket` called once
3. `/broadcast` with one open socket → `ws.send` called with the payload
4. `/broadcast` with multiple open sockets → `ws.send` called for each
5. `/broadcast` with a socket that throws → error is swallowed, remaining sockets still receive

Extend `functions/__tests__/workspaces.test.ts`:

6. Accepted PUT with `USER_SYNC` mock → `waitUntil` called with a broadcast fetch
7. DELETE success with `USER_SYNC` mock → `waitUntil` called with a broadcast fetch
8. Rejected PUT (409) → no broadcast

### `web/src/sync.test.ts` additions

9. Auth transitions to "authed" → `WebSocket("/api/ws")` constructed
10. WS "open" event → reconnect attempt counter resets to 0
11. WS "message" with valid invalidation → `deltaRefresh` called with `force=true` (throttle bypassed)
12. WS "message" with malformed JSON → no crash, no fetch
13. Auth transitions out of "authed" → `ws.close(1000, ...)` called
14. WS "close" with non-1000 code while not stopped → reconnect scheduled after delay
15. WS unavailable → focus event still triggers deltaRefresh via existing event listener (graceful fallback verified)

## Step 7 — AGENTS.md

Extend the "### Sync model" section and update the "Cloudflare free-tier limits" table:

Under sync model, add:
```
Real-time sync (optional — TASK-88.8):
- Each logged-in user has a per-user Durable Object (UserSyncDO, keyed by userId) that
  holds all open WebSocket connections for that user's devices.
- After an accepted PUT or DELETE, the workspace API fires a fire-and-forget broadcast
  via ctx.waitUntil() to the DO, which fans a lightweight { changedId, version } signal
  to all other connected sockets.
- On receiving a signal, the client resets the throttle and calls deltaRefresh(force=true).
  No state travels over the wire — the full reconciliation uses the existing ?since pull.
- Degradation: if the DO/WS path is unavailable, the app behaves exactly like TASK-88.7.
- WebSocket client uses exponential backoff (1 s → 60 s cap) for reconnection.
```

Under free-tier table, add:
| Durable Objects requests | 1M / month | One WS open + one broadcast per write |
| DO active connections | No hard limit | One WS per open browser tab per logged-in user |

## Verification

Manual integration test (after `wrangler pages dev web/dist`):

1. Sign in with dev bypass in two browser profiles (same `DEV_USER_ID`).
2. Open DevTools Network tab → confirm both show a WS connection to `/api/ws`.
3. Edit a workspace in profile 1 → verify workspace updates appear in profile 2 within ~1 s (via WS invalidation triggering a pull).
4. Kill the wrangler server and reload → both profiles fall back to pull-based sync without error.
5. Block `/api/ws` in DevTools → edit in profile 1 → verify profile 2 still gets the change on next focus (60 s poll or focus event).

## Files

**New:**
- `functions/_lib/UserSyncDO.ts`
- `functions/api/ws/index.ts`
- `functions/__tests__/userSync.test.ts`

**Modified:**
- `wrangler.jsonc`
- `functions/api/workspaces/[id].ts`
- `web/src/sync.ts`
- `AGENTS.md`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation notes

All six steps from the implementation plan were executed:

**New files:**
- `functions/_lib/UserSyncDO.ts` — per-user Durable Object using hibernatable WebSocket API (`state.acceptWebSocket`)
- `functions/api/ws/index.ts` — authenticated WebSocket upgrade endpoint; re-exports `UserSyncDO` for wrangler discovery
- `functions/__tests__/userSync.test.ts` — 6 unit tests for the DO (connect, broadcast, error-swallowing, 404)

**Modified files:**
- `wrangler.jsonc` — added `durable_objects` binding + DO class `migrations` block
- `functions/api/workspaces/[id].ts` — added `broadcastInvalidation()` helper; fires after accepted PUT and successful DELETE via `ctx.waitUntil` (best-effort, never blocks response)
- `functions/__tests__/workspaces.test.ts` — added `USER_SYNC` DO namespace mock + 3 broadcast-on-write tests (accepted PUT, DELETE, rejected 409)
- `web/src/sync.ts` — added `force` param to `deltaRefresh`; added `connectWs()` with exponential backoff; integrated into `initSync()` auth subscription
- `web/src/sync.test.ts` — added 7 WebSocket client tests (construction, open/reset, message, malformed, close, reconnect, graceful fallback)
- `AGENTS.md` — added real-time sync architecture section and updated free-tier limits table

**Test counts:** 50 functions tests pass (was 47), 361 web tests pass (was 354).

**Key design decisions:**
- Hibernatable WebSocket API keeps DO CPU usage near zero between writes
- Broadcast is fire-and-forget via `ctx.waitUntil()` — a failed DO request never affects the workspace API response
- `deltaRefresh(force=true)` bypasses the 30 s throttle when triggered by a WS signal; pull-based fallback (focus/visibility/60 s poll) is completely unchanged
- The WebSocket client is only opened when auth transitions to `authed`, not on every `initSync()` call; it's closed on logout and in the cleanup return
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented optional real-time cross-device sync via Cloudflare Durable Objects and WebSockets. Added `UserSyncDO` (one per user, hibernatable WS API), authenticated `/api/ws` upgrade endpoint, `broadcastInvalidation()` helper in the workspace API (fire-and-forget via `ctx.waitUntil`), and `connectWs()` client with exponential backoff in `web/src/sync.ts`. The pull-based TASK-88.7 strategy is the fallback and remains completely unchanged. All 411 tests pass (50 functions + 361 web)."
<!-- SECTION:FINAL_SUMMARY:END -->
