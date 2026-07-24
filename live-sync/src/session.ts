// Durable Object that manages a single live collaboration session.
//
// Each DO instance owns one session id and handles:
//   - WebSocket connections from multiple clients
//   - A Yjs document with allegro-physics engine for CRDT sync
//   - Periodic persistence of encoded state to D1
//   - Idle cleanup (auto-delete after 24h with no connections)
//
// Clients connect via WebSocket at /ws/:sessionId on this worker.
// The Pages Function at /api/live-session creates sessions and returns
// the connection URL to the client.

import * as Y from "yjs";
import { encodeStateAsUpdate, encodeStateVector } from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  encoded_state: Uint8Array | null;
  created_at: number;
  last_active_at: number;
}

export interface Env {
  LiveSession: DurableObjectNamespace;
  DB: D1Database;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long with no active connections before a session is auto-cleaned. */
const IDLE_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

/** How often to persist the document state to D1 (debounce interval). */
const PERSIST_INTERVAL_MS = 5_000; // 5 seconds

/** Alarm check interval — how often the DO wakes up to scan for idle sessions. */
const ALARM_INTERVAL_MS = 3600 * 1_000; // 1 hour

// ---------------------------------------------------------------------------
// Yjs protocol constants (matches y-protocols/sync.js from yjs ecosystem)
// ---------------------------------------------------------------------------

const Y_SYNC = 0x00;
const Y_SYNC_ACK = 0x01;
const Y_UPDATE = 0x02;
const Y_SYNC_QUERY_AWARENESS = 0x03;
const Y_AUTH = 0x20;

// ---------------------------------------------------------------------------
// Durable Object class
// ---------------------------------------------------------------------------

export class LiveSession {
  private db: D1Database;
  private state: DurableObjectState;
  private doc: Y.Doc;
  private clients: Set<{ ws: WebSocket; clientId: string }>;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private awareness: Awareness;
  /**
   * Which numeric Yjs awareness client IDs a given WebSocket connection has introduced.
   * The awareness protocol identifies clients by a number embedded in each update
   * (borrowed from the browser's `doc.clientID`), unrelated to our own per-connection
   * `clientId` string — this map is how we know which awareness entries to remove when a
   * specific connection disconnects, without guessing or touching entries owned by others.
   */
  private connAwarenessIds: Map<WebSocket, Set<number>>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.db = env.DB;
    this.doc = new Y.Doc();
    this.clients = new Set();
    this.connAwarenessIds = new Map();
    this.awareness = new Awareness(this.doc);
    this.awareness.on(
      "update",
      (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        // Every call site in this file passes either the originating connection's
        // WebSocket or `null` (for removals we trigger ourselves, e.g. on disconnect) —
        // `null` is the only origin that isn't a connection to track.
        if (origin === null) return;
        const conn = origin as WebSocket;
        let ids = this.connAwarenessIds.get(conn);
        if (!ids) {
          ids = new Set();
          this.connAwarenessIds.set(conn, ids);
        }
        for (const id of [...changes.added, ...changes.updated]) ids.add(id);
        for (const id of changes.removed) ids.delete(id);
      },
    );
    this.persistTimer = null;
    this.sessionId = state.id.toString();

    // Load persisted state on startup
    state.blockConcurrencyWhile(async () => {
      await this.load();
    });
  }

  // ── WebSocket upgrade handler ────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === "/health") {
      return Response.json({ ok: true, session: this.sessionId });
    }

    // WebSocket endpoint
    if (path.startsWith("/ws")) {
      const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();
      return this.handleWebSocketUpgrade(request, clientId);
    }

    // GET /state — return current session metadata (for debugging/testing)
    if (path === "/state") {
      const row = await this.getSessionRow();
      return Response.json({
        sessionId: this.sessionId,
        clientCount: this.clients.size,
        hasEncodedState: row?.encoded_state !== null && row?.encoded_state !== undefined,
        createdAt: row?.created_at ?? null,
        lastActiveAt: row?.last_active_at ?? null,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleWebSocketUpgrade(
    request: Request,
    clientId: string,
  ): Promise<Response> {
    if (
      !request.headers.get("Upgrade")?.toLowerCase().includes("websocket")
    ) {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }

    const { 0: clientWs, 1: serverWs } = new WebSocketPair();
    serverWs.accept();

    // Track this client
    const client = { ws: serverWs, clientId };
    this.clients.add(client);

    // Schedule idle cleanup alarm on first connection
    void this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);

    // Send initial sync message: SYNC + state vector query
    // This tells the client "send me your full state"
    const syncMessage = new Uint8Array([Y_SYNC, 0x00]); // type=SYNC, step=0 (sync init)
    sendWebSocketMessage(serverWs, syncMessage);

    // Handle incoming messages from this client
    serverWs.addEventListener("message", async (event) => {
      try {
        const data = event.data;
        if (typeof data === "string") {
          // Ping/pong handling
          if (data === "ping") {
            sendWebSocketMessage(serverWs, "pong");
            return;
          }
          // Ignore other text messages
          return;
        }

        // Binary message — parse as Yjs TTY-encoded message
        const view = new DataView(data);
        if (data.byteLength < 1) return;

        const type = view.getUint8(0);

        switch (type) {
          case Y_SYNC: {
            if (data.byteLength < 2) return;
            const step = view.getUint8(1);

            if (step === 0x00) {
              // SYNC init — client wants our state vector
              // Respond with SYNC_ACK + our state vector
              const sv = encodeStateVector(this.doc);
              const header = new Uint8Array([Y_SYNC, 0x01]); // SYNC_ACK
              const msg = concatArrays(header, sv);
              sendWebSocketMessage(serverWs, msg);
            } else if (step === 0x01) {
              // SYNC_ACK — client sent their state vector
              // Compute diff update and send it
              const stateVectorStart = 2; // skip type + step bytes
              const clientSV = new Uint8Array(data, stateVectorStart);
              const update = this.diffUpdate(clientSV);
              if (update.byteLength > 0) {
                const header = new Uint8Array([Y_SYNC, 0x02]); // UPDATE
                const msg = concatArrays(header, update);
                sendWebSocketMessage(serverWs, msg);
              }
            } else if (step === 0x02) {
              // UPDATE — client sent a document update
              const updateStart = 2; // skip type + step bytes
              const update = new Uint8Array(data, updateStart);
              this.applyUpdate(update, serverWs);
            }
            break;
          }

          case Y_UPDATE: {
            // Standalone update message (alternative format)
            const updateStart = 1; // skip type byte
            const update = new Uint8Array(data, updateStart);
            this.applyUpdate(update, serverWs);
            break;
          }

          case Y_SYNC_QUERY_AWARENESS: {
            // Client requests our current awareness state.
            // Respond with merged awareness for all connected clients.
            const states = this.awareness.getStates();
            const encoded = encodeAwarenessUpdate(
              this.awareness,
              [...states.keys()],
            );
            if (encoded.byteLength > 0) {
              sendWebSocketMessage(serverWs, encoded);
            }
            break;
          }

          default: {
            // Awareness update (tag 0x01 by convention in y-protocols).
            this.applyIncomingAwarenessUpdate(data, serverWs);
            // Fan-cast to others
            for (const c of this.clients) {
              if (c.ws !== serverWs && c.ws.readyState === WebSocket.OPEN) {
                sendWebSocketMessage(c.ws, data);
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error(`[LiveSession ${this.sessionId}] Message error:`, err);
      }
    });

    // Handle disconnect
    serverWs.addEventListener("close", () => {
      this.clients.delete(client);
      const removalMsg = this.disconnectAwareness(serverWs);
      if (removalMsg) {
        for (const c of this.clients) {
          if (c.ws.readyState === WebSocket.OPEN) {
            sendWebSocketMessage(c.ws, removalMsg);
          }
        }
      }
      void this.updateLastActive();
    });

    // Update last active timestamp
    void this.updateLastActive();

    return new Response(null, {
      status: 101,
      webSocket: clientWs,
    });
  }

  // ── Awareness ─────────────────────────────────────────────────────────────

  /**
   * Apply an incoming awareness update, attributing any client IDs it introduces to
   * `origin` via the "update" listener registered in the constructor.
   */
  private applyIncomingAwarenessUpdate(data: Uint8Array, origin: WebSocket): void {
    applyAwarenessUpdate(this.awareness, data, origin);
  }

  /**
   * Removes the awareness client IDs owned by a disconnecting connection and returns
   * the encoded removal message to broadcast, or null if there was nothing to remove.
   */
  private disconnectAwareness(ws: WebSocket): Uint8Array | null {
    const ownedIds = this.connAwarenessIds.get(ws);
    this.connAwarenessIds.delete(ws);
    if (!ownedIds || ownedIds.size === 0) return null;

    const idsArray = [...ownedIds];
    removeAwarenessStates(this.awareness, idsArray, null);
    const removalMsg = encodeAwarenessUpdate(this.awareness, idsArray);
    return removalMsg.byteLength > 0 ? removalMsg : null;
  }

  // ── Yjs document operations ──────────────────────────────────────────────

  /**
   * Apply an update received from a client to our document, then broadcast
   * the resulting update to all *other* connected clients.
   */
  private applyUpdate(update: Uint8Array, sender: WebSocket): void {
    try {
      Y.applyUpdate(this.doc, update);

      // Re-encode the update (may differ slightly after merge) and broadcast
      // to all other clients
      const broadcastUpdate = new Uint8Array(update);
      const header = new Uint8Array([Y_UPDATE]);
      const msg = concatArrays(header, broadcastUpdate);

      for (const client of this.clients) {
        if (client.ws !== sender && client.ws.readyState === WebSocket.OPEN) {
          sendWebSocketMessage(client.ws, msg);
        }
      }

      // Debounced persist to D1
      this.schedulePersist();
    } catch (err) {
      console.error(`[LiveSession ${this.sessionId}] Update error:`, err);
    }
  }

  /**
   * Compute the diff update needed to bring a client with the given state
   * vector up to date with our current document state.
   */
  private diffUpdate(clientSV: Uint8Array): Uint8Array {
    // encodeStateAsUpdate compares our doc's state against the provided
    // state vector and returns only the missing updates.
    return encodeStateAsUpdate(this.doc, clientSV);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(async () => {
      this.persistTimer = null;
      await this.save();
    }, PERSIST_INTERVAL_MS);
  }

  private async save(): Promise<void> {
    try {
      const encoded = encodeStateAsUpdate(this.doc);
      if (encoded.byteLength === 0) return; // nothing to save

      const now = Date.now();
      await this.db
        .prepare(
          `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             encoded_state = excluded.encoded_state,
             last_active_at = excluded.last_active_at`,
        )
        .bind(this.sessionId, encoded, now, now)
        .run();
    } catch (err) {
      console.error(`[LiveSession ${this.sessionId}] Persist error:`, err);
    }
  }

  private async load(): Promise<void> {
    try {
      const row = await this.getSessionRow();
      if (row && row.encoded_state && row.encoded_state.byteLength > 0) {
        Y.applyUpdate(this.doc, row.encoded_state);
      }
    } catch (err) {
      console.error(`[LiveSession ${this.sessionId}] Load error:`, err);
    }
  }

  private async getSessionRow(): Promise<SessionRow | null> {
    const row = await this.db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(this.sessionId)
      .first<SessionRow>();
    return row;
  }

  private async updateLastActive(): Promise<void> {
    try {
      await this.db
        .prepare(
          `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
           VALUES (?, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             last_active_at = excluded.last_active_at`,
        )
        .bind(this.sessionId, Date.now(), Date.now())
        .run();
    } catch (err) {
      console.error(
        `[LiveSession ${this.sessionId}] updateLastActive error:`,
        err,
      );
    }
  }

  // ── Idle cleanup ─────────────────────────────────────────────────────────

  /** Called by the alarm to check if this session should be cleaned up. */
  async alarm(): Promise<void> {
    try {
      const row = await this.getSessionRow();
      if (!row) return; // already deleted

      const idleMs = Date.now() - row.last_active_at;
      if (this.clients.size === 0 && idleMs > IDLE_TTL_MS) {
        // Truly abandoned — no active connections and stale.
        // Clean up: delete persisted state.
        await this.db
          .prepare("DELETE FROM live_sessions WHERE id = ?")
          .bind(this.sessionId)
          .run();

        // Notify connected clients that the session is ending
        // (defensive — this.clients.size === 0 here, so the loop is a no-op,
        //  but keeping it is harmless and documents the intent).
        const msg = JSON.stringify({ type: "session-ended" });
        for (const client of this.clients) {
          if (client.ws.readyState === WebSocket.OPEN) {
            sendWebSocketMessage(client.ws, msg);
          }
        }
        this.clients.clear();
      } else {
        // Still has active connections, or not yet idle — reschedule.
        await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    } catch (err) {
      console.error(`[LiveSession ${this.sessionId}] Alarm error:`, err);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    // Cancel pending persist timer
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    // Final persist before shutdown
    await this.save();

    // Remove awareness state for all clients and broadcast removals
    const clientIds = [...this.awareness.getStates().keys()];
    if (clientIds.length > 0) {
      removeAwarenessStates(this.awareness, clientIds, null);
      const removalMsg = encodeAwarenessUpdate(this.awareness, clientIds);
      if (removalMsg.byteLength > 0) {
        for (const client of this.clients) {
          if (client.ws.readyState === WebSocket.OPEN) {
            sendWebSocketMessage(client.ws, removalMsg);
          }
        }
      }
    }

    // Close all client connections
    for (const client of this.clients) {
      client.ws.close(1000, "Session closing");
    }
    this.clients.clear();
    this.connAwarenessIds.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendWebSocketMessage(ws: WebSocket, data: string | Uint8Array): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  } catch (err) {
    console.error("sendWebSocketMessage error:", err);
  }
}

function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  return result;
}