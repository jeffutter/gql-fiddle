---
id: TASK-119.1
title: Live sync backend for collaborative sessions
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-23 01:59'
updated_date: '2026-07-23 06:00'
labels: []
dependencies: []
parent_task_id: TASK-119
type: feature
ordinal: 155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Provide a server-side real-time channel that relays and persists document updates for a live collaboration session, so multiple connected clients converge on the same workspace state. This is a new, separate concern from the existing account-based cross-device sync (D1 + KV, in `functions/`) — live sessions are ephemeral and not tied to a user account.

Part of TASK-119 (real-time collaborative editing). This subtask covers only the server-side sync channel; editor wiring is TASK-120 and the share-link/join flow is TASK-121.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A live session can be created and connected to over WebSocket, identified by a unique session id
- [x] #2 Concurrent edits from multiple connections converge to the same state with no data loss (conflict-free merge, not last-write-wins)
- [x] #3 A client that briefly disconnects and reconnects within the session's lifetime resumes with the current session state rather than a stale copy
- [x] #4 Automated tests cover multi-client convergence and reconnect behavior
- [x] #5 No changes to the existing account-based cross-device sync (D1/KV) data model or API
- [x] #6 A session with no active connections for an extended idle period (e.g. 24-48h) automatically cleans up its own stored state, so abandoned sessions don't accumulate indefinitely
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete. All 6 acceptance criteria met:

1. Session creation via POST /api/live-session (Pages Function) + WebSocket at /ws/:sessionId (Worker DO)
2. Yjs CRDT for conflict-free convergence — tested with 2 and 3 concurrent clients
3. Reconnect recovery via Yjs sync protocol (state vector + diff update) — tested with missed updates and offline edits scenarios
4. 15 automated tests covering convergence, persistence, encoding, and reconnect behavior
5. Separate live_sessions table — no changes to existing workspaces/users/auth APIs
6. Idle cleanup via Durable Object alarm handler (24h TTL, hourly checks)

Bug fixes during execution:
- Fixed tsconfig.json types path (@cloudflare/workers-types/2023-07-01 → @cloudflare/workers-types)
- Fixed Env interface (DurableObject → DurableObjectNamespace)
- Fixed storage_alarm → state.storage.setAlarm() (alarms set on first client connection since stubs can't set alarms directly)
- Removed unused EncodeFn import from yjs
- Fixed null/undefined type mismatches in getSessionRow return type
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Live-sync backend implemented as a standalone Cloudflare Worker with Durable Object (live-sync/). Yjs CRDT provides conflict-free convergence over WebSocket. Sessions persisted to shared D1 (migrations/0004_live_sessions.sql) with 24h idle cleanup via DO alarms. Pages Function at functions/api/live-session/ coordinates session creation. 15 tests pass covering multi-client convergence, reconnect recovery, and D1 persistence. TypeScript issues fixed (workers-types path, DurableObjectNamespace typing, alarm API).
<!-- SECTION:FINAL_SUMMARY:END -->

## Architecture

### Technology choices

**Yjs as CRDT engine.** Yjs is the industry-standard CRDT library with a well-defined binary protocol (`y-protocols`). It provides deterministic convergence without server-side conflict resolution — the server is purely a relay.

**Custom relay on Cloudflare Durable Objects.** Rather than adopting `y-websocket` (which requires Node.js) or Hocuspocus (overkill with persistence hooks), we hand-roll a minimal relay (~50 lines of message routing logic). The DO guarantees single-instance-per-session with native WebSocket support.

**Separate Worker deployment.** Cloudflare Pages does not support co-locating Durable Object classes within a Pages project (noted in the existing `wrangler.jsonc` TODO). The relay DO must live in a separate Worker deployed alongside the Pages project, accessed via a service binding.

**No persistence.** Sessions are ephemeral. Document state lives only in connected clients' Y.Doc replicas. The DO holds only active WebSocket references, evicted when all peers disconnect.

### Protocol

The relay speaks Yjs's binary wire format directly:

```
Client ──WebSocket──→ DO (reads varUint tag: 0=Sync, 1=Awareness)
                      ↓ broadcasts payload to all other peers in room
DO ──WebSocket──→ Client
```

Two Yjs protocol tags:
- **Tag 0 (Sync):** State reconciliation between peers. Three-phase handshake — SyncStep1 (known vector clock) → SyncStep2 (missing ops request) → Update (delta). Server forwards each message; clients handle the state machine.
- **Tag 1 (Awareness):** Cursor/selection presence. Broadcast to all peers.

The DO never parses document content — it reads the varUint dispatch tag and fan-casts the raw `ArrayBuffer` to all other connected WebSockets in the session.

### Session lifecycle

```
Client connects → GET <live-worker>/ws?room=<sessionId>
                  │
             Worker fetch handler routes to DO
                  │
             LiveSessionDO.idFromName(sessionId)
                  │
             DO accepts WebSocket, adds peer to in-memory map
                  │
             Any peer sends y.update → DO broadcasts to other peers
                  │
             Peer disconnects → DO removes peer from map
             Last peer leaves → DO schedules alarm (48h cleanup)
             Alarm fires → DO drops all state, self-evicts
```

### Reconnect behavior (AC#3)

Yjs sync protocol is designed for this: a reconnecting peer sends SyncStep1 with its known state vector. Current peers respond with SyncStep2 + only the missing deltas. Because every connected client holds a full Y.Doc replica, the reconnecting peer syncs against **live peers**, not a persisted log. If all previous peers have disconnected before reconnect, the incoming peer gets whatever state remains (empty if the session fully drained).

### Idle cleanup (AC#6)

When the last WebSocket disconnects, the DO schedules a Durable Object alarm for 48 hours later. On alarm fire, any remaining state is dropped. The DO auto-evicts from memory per Cloudflare's default hibernation policy (5-minute gapless window for WS connections). This ensures abandoned sessions do not accumulate.

### Constraints vs. existing codebase

- **Zero changes to `sync.ts`** (AC#5): the existing `PUT /api/workspaces/:id` pipeline is untouched. Live sessions are a parallel channel.
- **No auth required:** sessions identified by UUID only, no `__session` cookie check.
- **Payload size:** GraphQL SDL + queries are KB-range. In-memory per-session overhead is trivial (< 1 MB even with update history).
- **Free tier impact:** Each concurrent live session = one DO instance. Free tier allows 100K billed CPU seconds/day and 1M stateful operations/day — sufficient for personal/demo use.

## Plan

### Step 1: Create separate Worker project for the relay DO

Create `live-sync/` directory with its own `wrangler.jsonc` for the standalone Worker:

```
live-sync/
  wrangler.jsonc       Worker config (durable_objects namespace, compatibility_date)
  src/
    index.ts            Worker entry point — routes HTTP → DO dispatch
    relay.ts            DurableObject class — WebSocket accept, broadcast, alarm cleanup
  __tests__/
    relay.test.ts       Unit tests for relay logic (mocked WebSocket)
  tsconfig.json         TypeScript config
```

Key files:

- **`live-sync/wrangler.jsonc`**: Defines `LiveSessionDO` durable object class. Sets `compatibility_date` ≥ `2026-04-07` for WebSocket hibernation support. No bindings needed (ephemeral, no DB/KV).
- **`live-sync/src/index.ts`**: Thin fetch handler. Routes:
  - `GET /ws?room=<sessionId>` → upgrades to WebSocket, dispatches to `LiveSessionDO.idFromName(sessionId)`
  - `POST /session/:sessionId` → returns `{ sessionId }` JSON (no-op creation; DO is lazily instantiated on first WS connection)
  - All other paths → 404
- **`live-sync/src/relay.ts`**: The `LiveSessionDO` class:
  - `fetch()` handler: calls `this.acceptWebSocket(ws, sessionId)` on `/ws` requests
  - `webSocketMessage(ws, message)`: reads varUint tag, broadcasts `ArrayBuffer` to all other peers in the map
  - `webSocketClose(ws, ...)`: removes peer from map; if empty, schedules alarm
  - `alarm()`: cleanup handler — drops all state
  - Internal state: `Map<WebSocket, string>` (ws → peerId) tracked in JS, not DO storage (storage is persistent; we want in-memory-only)

```typescript
// relay.ts — core broadcast loop (~30 lines)
class LiveSessionDO {
  private peers = new Map<WebSocket, string>();

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer) {
    const view = new DataView(message);
    // Skip varUint tag (first byte(s)), forward raw payload to other peers
    for (const [peer] of this.peers) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        peer.send(message);
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.peers.delete(ws);
    if (this.peers.size === 0) {
      // Schedule 48h cleanup alarm
      this.storage.setAlarm(Date.now() + 48 * 60 * 60 * 1000);
    }
  }

  async alarm() {
    this.peers.clear();
  }
}
```

### Step 2: Routing strategy

**No Pages function proxy needed.** Cloudflare Pages Functions cannot directly upgrade HTTP→WebSocket through a service binding to another Worker. Instead, the live-sync Worker handles its own routing entirely:

- `GET /ws?room=<id>` → WebSocket upgrade, dispatches to `LiveSessionDO.idFromName(id)`
- `POST /session/:sessionId` → returns `{ sessionId }` JSON (no-op creation; DO is lazily instantiated on first WS connection)
- All other paths → 404

In production, the Worker is routed via a Cloudflare route rule (e.g., `live.<origin>/*` or a path-based route). In local dev, `wrangler dev` runs on its own port alongside `wrangler pages dev`. The frontend detects the environment and connects to the appropriate origin.

### Step 3: Wire up local development

Update project tooling:

- **`package.json` scripts** (add to root or `web/`):
  ```json
  "dev:live": "cd live-sync && wrangler dev --local",
  "dev:full": "concurrently --kill-others-on-fail \"pnpm dev\" \"pnpm dev:live\"
  ```
- **`.dev.vars` example** updated with note about live-sync Worker port
- Frontend will connect to `localhost:<live-port>/ws?room=<id>` during local dev

### Step 4: Write unit tests

`live-sync/__tests__/relay.test.ts`:

Test the relay logic in isolation using mocked WebSockets:

1. **Single peer, no broadcast:** Message from sole peer is not echoed back to itself
2. **Two peers, bidirectional relay:** Messages flow both ways
3. **Three peers, fan-out:** One peer's message reaches both others
4. **Disconnect cleanup:** Removing a peer stops delivery to that peer
5. **Idle alarm scheduling:** Last peer disconnect triggers `setAlarm` call
6. **Alarm fires, state cleared:** After alarm, no peers remain

Use vitest with a mock `DurableObjectState` that captures `acceptWebSocket`, `setAlarm`, and `getWebSockets` calls.

### Step 5: Write integration test for Yjs convergence

`live-sync/__tests__/convergence.test.ts`:

Use Yjs's built-in `TestConnector` and `applyRandomTests` utilities:

1. Create two `TestConnector` instances connected through a simulated relay
2. Run `applyRandomTests(doc, [connectorA, connectorB], options)` which performs random insert/delete/move operations across both docs with simulated network delays and reordering
3. Assert `Y.compare(docA, docB) === true` after test completes

This is the gold-standard CRDT convergence test used by Yjs itself.

### Step 6: Update wrangler configuration

- Add `live-sync/wrangler.jsonc` with DO definition
- Note in AGENTS.md how to deploy both Workers
- CI: add step to publish `live-sync` Worker alongside Pages deploy

### Step 7: Update documentation

- **AGENTS.md:** Add section on live-sync Worker layout, local dev commands, deployment
- **README** (if exists): Mention live collaboration capability

## Files to create/modify

| File | Action | Purpose |
|------|--------|---------|
| `live-sync/wrangler.jsonc` | Create | Worker config with DO definition |
| `live-sync/src/index.ts` | Create | Worker entry point, HTTP routing |
| `live-sync/src/relay.ts` | Create | `LiveSessionDO` class |
| `live-sync/__tests__/relay.test.ts` | Create | Unit tests for relay logic |
| `live-sync/__tests__/convergence.test.ts` | Create | Yjs convergence integration test |
| `live-sync/tsconfig.json` | Create | TypeScript config |
| `live-sync/package.json` | Create | Dependencies (`yjs` for tests) |
| `wrangler.jsonc` | Modify | Note about companion Worker (or remove DO TODO) |
| `web/package.json` | Modify | Add `dev:live` script |
| `AGENTS.md` | Modify | Document live-sync Worker layout & dev commands |

## AC-to-step mapping

| AC | Covered by |
|----|------------|
| #1 (WS connect by session id) | Step 1 (DO dispatch by `idFromName(sessionId)` via Worker fetch handler) |
| #2 (CRDT convergence) | Step 1 (Yjs binary relay) + Step 5 (convergence test) |
| #3 (reconnect) | Inherent to Yjs sync protocol (Step 1 relay forwards Sync messages); verified by Step 5 test |
| #4 (automated tests) | Steps 4–5 (unit + convergence tests) |
| #5 (no sync.ts changes) | No files in `functions/_lib/db.ts` or `web/src/sync.ts` are modified |
| #6 (idle cleanup) | Step 1 (alarm on last-peer disconnect) + Step 4 (alarm test) |
