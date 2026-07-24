/**
 * Unit tests for LiveSyncProvider — mocked WebSocket transport.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { encodeStateVector, encodeStateAsUpdate, applyUpdate } from "yjs";
import { LiveSyncProviderImpl, SyncStatus } from "./liveSyncProvider";

// ── Mock WebSocket ─────────────────────────────────────────────────────────

class MockWebSocket {
  // Static constants must match the real WebSocket API so that
  // comparisons like `ws.readyState === WebSocket.OPEN` work.
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  url: string;
  binaryType = "arraybuffer";
  readyState: number = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private listeners: Map<string, Set<(e?: Event | MessageEvent | CloseEvent) => void>> = new Map();
  public sentMessages: Uint8Array[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening after a tick
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen(new Event("open"));
      this.listeners.get("open")?.forEach((cb) => cb(new Event("open")));
    }, 0);
  }

  send(data: ArrayBuffer | Uint8Array): void {
    this.sentMessages.push(new Uint8Array(data));
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3; // CLOSED
    const event = new CloseEvent("close", { code, reason });
    if (this.onclose) this.onclose(event);
    this.listeners.get("close")?.forEach((cb) => cb(event));
  }

  addEventListener(type: string, handler: (e?: Event | MessageEvent | CloseEvent) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(
    type: string,
    handler: (e?: Event | MessageEvent | CloseEvent) => void,
  ): void {
    this.listeners.get(type)?.delete(handler);
  }

  /** Simulate receiving a message from the server */
  receive(data: Uint8Array): void {
    // Real WebSocket sends ArrayBuffer when binaryType = "arraybuffer"
    const event = new MessageEvent("message", { data: data.buffer as ArrayBuffer });
    if (this.onmessage) this.onmessage(event);
    this.listeners.get("message")?.forEach((cb) => cb(event));
  }

  /** Simulate server closing the connection */
  simulateClose(): void {
    this.close(1000, "Server closed");
  }
}

// Override global WebSocket for tests
const OriginalWebSocket = globalThis.WebSocket;

function setupMockWs() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = MockWebSocket;
}

function restoreWs() {
  globalThis.WebSocket = OriginalWebSocket;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("LiveSyncProvider", () => {
  beforeEach(() => {
    setupMockWs();
  });

  it("starts in connecting status", async () => {
    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test");
    expect(provider.status).toBe("connecting");
    provider.destroy();
    restoreWs();
  });

  it("transitions to connected on WebSocket open", async () => {
    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test");

    // Wait for connect + open
    await new Promise((r) => setTimeout(r, 50));

    expect(provider.status).toBe("connected");

    provider.destroy();
    restoreWs();
  });

  it("sends state vector after receiving SYNC init from server", async () => {
    const doc = new Y.Doc();
    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test", doc);

    // Wait for connection
    await new Promise((r) => setTimeout(r, 50));

    const mockWs = provider.ws as unknown as MockWebSocket;
    expect(mockWs.readyState).toBe(1); // OPEN

    // Server sends SYNC init: [0x00, 0x00]
    mockWs.receive(new Uint8Array([0x00, 0x00]));

    // Give time for async processing (multiple microtasks)
    await new Promise((r) => setTimeout(r, 100));

    // Client should have sent SYNC_ACK + state vector
    expect(mockWs.sentMessages.length).toBeGreaterThan(0);
    const msg = mockWs.sentMessages[0];
    expect(msg[0]).toBe(0x00); // Y_SYNC
    expect(msg[1]).toBe(0x01); // step = SV response

    provider.destroy();
    doc.destroy();
    restoreWs();
  });

  it("applies incoming updates and syncs bidirectionally", async () => {
    // Start with a shared base document
    const baseDoc = new Y.Doc();
    baseDoc.getText("content").insert(0, "Hello");
    const baseUpdate = encodeStateAsUpdate(baseDoc);

    // Client A gets the base
    const docA = new Y.Doc();
    applyUpdate(docA, baseUpdate);
    const textA = docA.getText("content");

    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test", docA);

    await new Promise((r) => setTimeout(r, 50));

    const mockWs = provider.ws as unknown as MockWebSocket;

    // Client B also gets the base, then adds " World"
    const docB = new Y.Doc();
    applyUpdate(docB, baseUpdate);
    docB.getText("content").insert(5, " World");

    // Compute only B's additional edit (relative to base)
    const baseSV = encodeStateVector(baseDoc);
    const updateB = encodeStateAsUpdate(docB, baseSV);

    // Send as Y_UPDATE message
    const header = new Uint8Array([0x02]); // Y_UPDATE
    const msg = concatArrays(header, updateB);
    mockWs.receive(msg);

    // Give time for async processing
    await new Promise((r) => setTimeout(r, 100));

    // docA should now contain "Hello World"
    expect(textA.toString()).toBe("Hello World");

    provider.destroy();
    docA.destroy();
    docB.destroy();
    restoreWs();
  });

  it("emits status events on state changes", async () => {
    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test");
    const statuses: SyncStatus[] = [];

    provider.on("status", ({ status }) => {
      statuses.push(status);
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(statuses).toContain("connected");

    provider.destroy();
    restoreWs();
  });

  it("setLocalStateField sets awareness state", async () => {
    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test");

    await new Promise((r) => setTimeout(r, 50));

    provider.setLocalStateField({ name: "Alice", color: "#ff0000" });

    const states = provider.awareness.getStates();
    expect(states.has(provider.awareness.clientID)).toBe(true);
    expect(states.get(provider.awareness.clientID)).toEqual({ name: "Alice", color: "#ff0000" });

    provider.destroy();
    restoreWs();
  });

  it("disconnects cleanly on destroy", async () => {
    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test");

    await new Promise((r) => setTimeout(r, 50));

    provider.destroy();

    expect(provider.status).toBe("disconnected");
    expect(provider.ws).toBeNull();

    restoreWs();
  });

  it("does not reconnect after destroy", async () => {
    const provider = new LiveSyncProviderImpl("ws://localhost:8788/ws/test");

    await new Promise((r) => setTimeout(r, 50));

    const mockWs = provider.ws as unknown as MockWebSocket;
    mockWs.simulateClose();

    provider.destroy();

    // Wait longer than the reconnect delay
    await new Promise((r) => setTimeout(r, 150));

    // Should still be disconnected with no reconnection attempt
    expect(provider.status).toBe("disconnected");
    expect(provider.ws).toBeNull();

    restoreWs();
  });
});

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
