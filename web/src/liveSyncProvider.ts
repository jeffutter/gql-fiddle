/**
 * LiveSyncProvider — thin adapter between the standard Yjs provider contract
 * and the DO relay's custom framing (Uint8Array header prepended to each
 * message). Replaces y-websocket which expects a different wire format.
 *
 * Responsibilities:
 *   - WebSocket lifecycle management
 *   - Three-phase Yjs sync handshake (SYNC → SYNC_ACK + SV → UPDATE diff)
 *   - Bidirectional update exchange
 *   - Awareness protocol forwarding
 *   - Exponential backoff reconnect
 *   - Status events for UI connection indicator
 */

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { applyAwarenessUpdate } from "y-protocols/awareness";
import { encodeStateAsUpdate, encodeStateVector, applyUpdate } from "yjs";

// ── Protocol tags (matches live-sync/src/session.ts) ───────────────────────

const Y_SYNC = 0x00;
const Y_UPDATE = 0x02;

// ── Types ──────────────────────────────────────────────────────────────────

export type SyncStatus = "connecting" | "connected" | "disconnected";

export interface LiveSyncProviderEvents {
  status: (data: { status: SyncStatus }) => void;
  /**
   * Fires once, the first time the server has told us definitively what it
   * already had for this session (even if that was nothing). Seeding
   * default content is only safe to do after this — seeding before it, into
   * a session another client already populated, produces two independent
   * concurrent insertions that Yjs can't recognize as "the same" content and
   * merges as a duplicate instead of a no-op.
   */
  synced: () => void;
}

export interface LiveSyncProvider {
  status: SyncStatus;
  synced: boolean;
  awareness: Awareness;
  doc: Y.Doc;
  on(event: keyof LiveSyncProviderEvents, callback: LiveSyncProviderEvents[typeof event]): void;
  off(event: keyof LiveSyncProviderEvents, callback: LiveSyncProviderEvents[typeof event]): void;
  setLocalStateField(state: Record<string, unknown> | null): void;
  destroy(): void;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class LiveSyncProviderImpl implements LiveSyncProvider {
  status: SyncStatus = "connecting";
  synced = false;
  awareness: Awareness;
  doc: Y.Doc;

  // Exposed for testing
  ws: WebSocket | null = null;
  private wsUrl: string;
  private clientId: string;
  private listeners: Map<
    keyof LiveSyncProviderEvents,
    Set<LiveSyncProviderEvents[keyof LiveSyncProviderEvents]>
  > = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000; // exponential backoff starting at 1s
  private maxReconnectDelay = 10_000;
  private destroyed = false;
  private syncHandler: ((event: MessageEvent) => void) | null = null;

  constructor(wsUrl: string, doc?: Y.Doc) {
    this.wsUrl = wsUrl;
    this.clientId = crypto.randomUUID();
    this.doc = doc ?? new Y.Doc();
    this.awareness = new Awareness(this.doc);

    // Broadcast local edits to the server. Updates applied from an incoming
    // network message (see handleMessage) are tagged with origin = this, so
    // they're recognized here and not immediately echoed back out.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const msg = concatArrays(new Uint8Array([Y_UPDATE]), update);
      this.send(msg);
    });

    // Connect immediately
    this.connect();
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(event: keyof LiveSyncProviderEvents, callback: LiveSyncProviderEvents[typeof event]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: keyof LiveSyncProviderEvents, callback: LiveSyncProviderEvents[typeof event]): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(
    event: keyof LiveSyncProviderEvents,
    data: Parameters<LiveSyncProviderEvents[typeof event]>[0],
  ): void {
    // TS can't correlate `event` with the matching member of the callback
    // union across this Map-based dispatch (a known limitation for this
    // pattern) — the invariant that `data` always matches `event`'s own
    // signature is enforced by every call site being individually typed
    // against LiveSyncProviderEvents.
    this.listeners.get(event)?.forEach((cb) => (cb as (data: unknown) => void)(data));
  }

  // ── Awareness ────────────────────────────────────────────────────────────

  setLocalStateField(state: Record<string, unknown> | null): void {
    this.awareness.setLocalState(state);
  }

  // ── WebSocket lifecycle ──────────────────────────────────────────────────

  private connect(): void {
    if (this.destroyed) return;

    this.setStatus("connecting");

    const url = `${this.wsUrl}?clientId=${encodeURIComponent(this.clientId)}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.addEventListener("open", () => {
      if (this.destroyed) return;
      this.setStatus("connected");
      this.reconnectDelay = 1_000; // reset backoff on success

      // The server sends its own SYNC init (step 0x00) on accept, which our
      // step-0x00 handler below answers with our state vector — that tells
      // the server what WE'RE missing (server → client). To also replicate
      // what the server is missing (e.g. content this client seeded before
      // ever connecting), proactively send the same SYNC init back. The
      // server's own SYNC handler (session.ts) already answers step 0x00
      // with its state vector, our step-0x01 handler computes our diff
      // against it and sends that as an UPDATE — no new message types
      // needed, just triggering the existing reciprocal path from our side.
      this.send(new Uint8Array([Y_SYNC, 0x00]));
    });

    this.syncHandler = async (event: MessageEvent) => {
      await this.handleMessage(event);
    };
    this.ws.addEventListener("message", this.syncHandler!);

    this.ws.addEventListener("close", () => {
      this.setStatus("disconnected");
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener("error", () => {
      // Error typically fires before close; let close handle cleanup
    });
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (this.destroyed || !this.ws) return;

    const data = event.data;
    if (typeof data === "string") {
      if (data === "pong") return;
      return;
    }

    const view = new DataView(data);
    if (data.byteLength < 1) return;

    const type = view.getUint8(0);

    switch (type) {
      case Y_SYNC: {
        if (data.byteLength < 2) return;
        const step = view.getUint8(1);

        if (step === 0x00) {
          // Server SYNC init — send our state vector
          const sv = encodeStateVector(this.doc);
          const header = new Uint8Array([Y_SYNC, 0x01]);
          const msg = concatArrays(header, sv);
          this.send(msg);
        } else if (step === 0x01) {
          // Server sent its state vector (SYNC_ACK)
          // Compute our diff and send it
          const stateVectorStart = 2;
          const serverSV = new Uint8Array(data, stateVectorStart);
          const ourUpdate = encodeStateAsUpdate(this.doc, serverSV);
          if (ourUpdate.byteLength > 0) {
            const header = new Uint8Array([Y_SYNC, 0x02]);
            const msg = concatArrays(header, ourUpdate);
            this.send(msg);
          }
        } else if (step === 0x02) {
          // Server's answer to our step-0x01 reply: whatever it already had
          // that we didn't (possibly nothing). The server always sends this
          // (see session.ts), so its arrival is our deterministic "initial
          // sync done" signal — safe to seed default content after this,
          // since we now know for certain whether the session was empty.
          const updateStart = 2;
          const update = new Uint8Array(data, updateStart);
          if (update.byteLength > 0) {
            applyUpdate(this.doc, update, this);
          }
          if (!this.synced) {
            this.synced = true;
            this.emit("synced", undefined);
          }
        }
        break;
      }

      case Y_UPDATE: {
        const updateStart = 1;
        const update = new Uint8Array(data, updateStart);
        if (update.byteLength > 0) {
          applyUpdate(this.doc, update, this);
        }
        break;
      }

      default: {
        // Awareness update (tag 0x01 by convention)
        applyAwarenessUpdate(this.awareness, new Uint8Array(data), null);
        break;
      }
    }
  }

  private send(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send the view directly (not data.buffer) so only its own
      // byteOffset/byteLength go over the wire, not the whole backing
      // buffer. TS's BufferSource type is overly strict about the backing
      // buffer's generic type (rejects SharedArrayBuffer-backed views, which
      // this never is) — cast, not a runtime concern.
      this.ws.send(data as BufferSource);
    }
  }

  private setStatus(status: SyncStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit("status", { status });
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        this.connect();
      }
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  destroy(): void {
    this.destroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      if (this.syncHandler) {
        this.ws.removeEventListener("message", this.syncHandler);
      }
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
    }

    this.setStatus("disconnected");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
