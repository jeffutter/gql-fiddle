// Unit tests for UserSyncDO (TASK-88.8).
//
// Mocks DurableObjectState with a minimal implementation that records
// acceptWebSocket calls and maintains a getWebSockets() list.  No wrangler
// runtime or miniflare is required — the DO class is pure TypeScript logic.
import { describe, expect, it, vi } from "vitest";
import { UserSyncDO } from "../_lib/UserSyncDO";

// ---------------------------------------------------------------------------
// Minimal DurableObjectState mock
// ---------------------------------------------------------------------------

interface MockWS {
  send: ReturnType<typeof vi.fn>;
  readyState: number;
}

function makeMockState(sockets: MockWS[] = []): DurableObjectState {
  const accepted: MockWS[] = [...sockets];
  return {
    acceptWebSocket(ws: MockWS) {
      accepted.push(ws);
    },
    getWebSockets() {
      return accepted as unknown as WebSocket[];
    },
    // Minimal stubs — not used by UserSyncDO but required by the type.
    id: {} as DurableObjectId,
    storage: {} as DurableObjectStorage,
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: () => {},
    abort: () => {},
  } as unknown as DurableObjectState;
}

function makeMockWS(opts: { throws?: boolean } = {}): MockWS {
  return {
    send: opts.throws
      ? vi.fn().mockImplementation(() => {
          throw new Error("socket error");
        })
      : vi.fn(),
    readyState: 1, // WebSocket.OPEN
  };
}

// ---------------------------------------------------------------------------
// Helper — create a DO instance with the given state
// ---------------------------------------------------------------------------

function makeDO(state: DurableObjectState): UserSyncDO {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new UserSyncDO(state, {} as any);
}

// ---------------------------------------------------------------------------
// /connect tests
// ---------------------------------------------------------------------------

describe("UserSyncDO /connect", () => {
  it("returns 400 when the request is not a WebSocket upgrade", async () => {
    const state = makeMockState();
    const do_ = makeDO(state);

    const req = new Request("https://do.internal/connect", { method: "GET" });
    const res = await do_.fetch(req);

    expect(res.status).toBe(400);
  });

  it("calls state.acceptWebSocket for a WebSocket upgrade request", async () => {
    const state = makeMockState();
    const acceptSpy = vi.spyOn(state, "acceptWebSocket");
    const do_ = makeDO(state);

    // Mock WebSocketPair — not available in Node.js test environment.
    // Must use a class so `new WebSocketPair()` works as a constructor call.
    const mockServer = makeMockWS();
    const mockClient = makeMockWS();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocketPair = class {
      constructor() {
        // Returning an array (an object) from a constructor causes `new` to
        // return the array rather than `this`.
        return [mockClient, mockServer];
      }
    };

    const req = new Request("https://do.internal/connect", {
      headers: { Upgrade: "websocket" },
    });

    // `new Response(null, { status: 101 })` throws a RangeError in the
    // Node.js fetch API (status 101 is a Cloudflare Workers extension).
    // We verify that acceptWebSocket was called (which happens before the
    // response is constructed) and that the correct server socket was used.
    try {
      await do_.fetch(req);
    } catch {
      // Expected in the Node.js test environment for status 101.
    }

    // The important invariant: the server socket must have been accepted.
    expect(acceptSpy).toHaveBeenCalledOnce();
    expect(acceptSpy).toHaveBeenCalledWith(mockServer);
  });
});

// ---------------------------------------------------------------------------
// /broadcast tests
// ---------------------------------------------------------------------------

describe("UserSyncDO /broadcast", () => {
  it("sends the payload to a single open socket", async () => {
    const ws = makeMockWS();
    const state = makeMockState([ws]);
    const do_ = makeDO(state);

    const payload = JSON.stringify({ changedId: "ws-1", version: 3 });
    const req = new Request("https://do.internal/broadcast", {
      method: "POST",
      body: payload,
    });
    const res = await do_.fetch(req);

    expect(res.status).toBe(200);
    expect(ws.send).toHaveBeenCalledOnce();
    expect(ws.send).toHaveBeenCalledWith(payload);
  });

  it("sends the payload to multiple open sockets", async () => {
    const ws1 = makeMockWS();
    const ws2 = makeMockWS();
    const state = makeMockState([ws1, ws2]);
    const do_ = makeDO(state);

    const payload = JSON.stringify({ changedId: "ws-2", version: 5 });
    const req = new Request("https://do.internal/broadcast", {
      method: "POST",
      body: payload,
    });
    await do_.fetch(req);

    expect(ws1.send).toHaveBeenCalledWith(payload);
    expect(ws2.send).toHaveBeenCalledWith(payload);
  });

  it("swallows an error from one socket and still delivers to the rest", async () => {
    const bad = makeMockWS({ throws: true });
    const good = makeMockWS();
    const state = makeMockState([bad, good]);
    const do_ = makeDO(state);

    const payload = JSON.stringify({ changedId: "ws-3", version: 1 });
    const req = new Request("https://do.internal/broadcast", {
      method: "POST",
      body: payload,
    });
    const res = await do_.fetch(req);

    // Should not throw; response is still ok.
    expect(res.status).toBe(200);
    // The healthy socket still received the message.
    expect(good.send).toHaveBeenCalledWith(payload);
  });
});

// ---------------------------------------------------------------------------
// Unrecognised paths
// ---------------------------------------------------------------------------

describe("UserSyncDO unknown paths", () => {
  it("returns 404 for unrecognised sub-paths", async () => {
    const state = makeMockState();
    const do_ = makeDO(state);

    const req = new Request("https://do.internal/unknown");
    const res = await do_.fetch(req);

    expect(res.status).toBe(404);
  });
});
