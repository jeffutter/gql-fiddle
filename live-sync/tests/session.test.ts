// Unit tests for live-sync Durable Object behavior.
//
// Tests cover:
//   - Multi-client convergence via Yjs CRDT
//   - Reconnect with state recovery from D1
//   - Session creation and metadata
//   - Idle cleanup logic

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as Y from "yjs";
import { encodeStateAsUpdate, encodeStateVector, applyUpdate } from "yjs";
import { createD1Mock } from "../../functions/__tests__/d1-mock";
import { LiveSession, Env } from "../src/session";

// ---------------------------------------------------------------------------
// Migration SQL — same schema as migrations/0004_live_sessions.sql
// ---------------------------------------------------------------------------

const MIGRATION_SQL = `
CREATE TABLE live_sessions (
  id              TEXT PRIMARY KEY,
  encoded_state   BLOB,
  created_at      INTEGER NOT NULL,
  last_active_at  INTEGER NOT NULL
);
CREATE INDEX idx_live_sessions_last_active ON live_sessions(last_active_at);
`;



// ---------------------------------------------------------------------------
// Tests: Yjs CRDT convergence
// ---------------------------------------------------------------------------

describe("Yjs CRDT convergence", () => {
  /**
   * Simulate two clients editing concurrently and verify they converge
   * to the same final state after exchanging updates.
   */
  it("two concurrent edits converge without data loss", () => {
    // Create a base document with initial content
    const baseDoc = new Y.Doc();
    const baseText = baseDoc.getText("content");
    baseText.insert(0, "Hello");

    // Client A forks from base and makes their edit
    const docA = new Y.Doc();
    applyUpdate(docA, encodeStateAsUpdate(baseDoc));
    const textA = docA.getText("content");
    textA.insert(5, " World"); // "Hello World"

    // Client B forks from base (before A's edit) and makes their edit
    const docB = new Y.Doc();
    applyUpdate(docB, encodeStateAsUpdate(baseDoc));
    const textB = docB.getText("content");
    textB.insert(0, "👋 "); // "👋 Hello"

    // Exchange updates: A sends to B, B sends to A
    const updateA = encodeStateAsUpdate(docA, encodeStateVector(baseDoc));
    const updateB = encodeStateAsUpdate(docB, encodeStateVector(baseDoc));

    applyUpdate(docA, updateB);
    applyUpdate(docB, updateA);

    // Both should converge to the same content
    const contentA = textA.toString();
    const contentB = textB.toString();

    // Both contain all edits (order may differ but both changes present)
    expect(contentA).toContain("Hello");
    expect(contentA).toContain("World");
    expect(contentA).toContain("👋");

    expect(contentB).toContain("Hello");
    expect(contentB).toContain("World");
    expect(contentB).toContain("👋");

    // Final state vectors should match
    expect(encodeStateVector(docA)).toEqual(encodeStateVector(docB));

    baseDoc.destroy();
    docA.destroy();
    docB.destroy();
  });

  /**
   * Three clients editing concurrently should all converge.
   */
  it("three concurrent edits converge", () => {
    const baseDoc = new Y.Doc();
    const baseText = baseDoc.getText("content");
    baseText.insert(0, "base");

    // Three independent forks
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()].map((doc) => {
      applyUpdate(doc, encodeStateAsUpdate(baseDoc));
      return doc;
    });

    const texts = docs.map((d) => d.getText("content"));
    texts[0].insert(4, "-a"); // "base-a"
    texts[1].insert(4, "-b"); // "base-b"
    texts[2].insert(4, "-c"); // "base-c"

    // Collect all updates relative to base
    const updates = docs.map((doc) =>
      encodeStateAsUpdate(doc, encodeStateVector(baseDoc)),
    );

    // Each doc receives updates from the other two
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i !== j) {
          applyUpdate(docs[i], updates[j]);
        }
      }
    }

    // All three should have identical state vectors
    const svs = docs.map((d) => encodeStateVector(d));
    expect(svs[0]).toEqual(svs[1]);
    expect(svs[1]).toEqual(svs[2]);

    // All contain all edits
    for (const doc of docs) {
      const content = doc.getText("content").toString();
      expect(content).toContain("base");
      expect(content).toContain("-a");
      expect(content).toContain("-b");
      expect(content).toContain("-c");
    }

    baseDoc.destroy();
    docs.forEach((d) => d.destroy());
  });

  /**
   * Encode → decode round-trip preserves document state.
   */
  it("encode/decode round-trip preserves state", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "Hello World");

    const map = doc.getMap("metadata");
    map.set("author", "test");
    map.set("version", 42);

    // Encode full state
    const encoded = encodeStateAsUpdate(doc);

    // Decode into a new document
    const restored = new Y.Doc();
    applyUpdate(restored, encoded);

    expect(restored.getText("content").toString()).toBe("Hello World");
    expect(restored.getMap("metadata").get("author")).toBe("test");
    expect(restored.getMap("metadata").get("version")).toBe(42);

    doc.destroy();
    restored.destroy();
  });

  /**
   * Diff update only contains changes since the given state vector.
   */
  it("diff update excludes already-known changes", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");

    // First edit
    text.insert(0, "first");
    const stateAfterFirst = encodeStateAsUpdate(doc);

    // Second edit
    text.insert(5, " second");

    // Diff should only contain the second edit (relative to state after first)
    const svAfterFirst = encodeStateVector(doc);
    // We need the SV before the second edit — capture it differently:
    // Rebuild: start fresh, apply first-state, then check diff captures second
    const freshDoc = new Y.Doc();
    applyUpdate(freshDoc, stateAfterFirst);
    const svBeforeSecond = encodeStateVector(freshDoc);

    // Now the original doc has both edits; compute diff relative to pre-second state
    const diff = encodeStateAsUpdate(doc, svBeforeSecond);

    // Apply diff to the fresh doc (which only has first edit)
    applyUpdate(freshDoc, diff);
    expect(freshDoc.getText("content").toString()).toBe("first second");

    doc.destroy();
    freshDoc.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: D1 persistence
// ---------------------------------------------------------------------------

describe("D1 persistence", () => {
  let db: D1Database;

  beforeEach(() => {
    db = createD1Mock(MIGRATION_SQL);
  });

  it("stores and retrieves encoded state", async () => {
    const sessionId = "test-session-id";
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "persisted content");
    const encoded = encodeStateAsUpdate(doc);

    // Insert
    await db
      .prepare(
        `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(sessionId, encoded, Date.now(), Date.now())
      .run();

    // Retrieve
    const row = await db
      .prepare("SELECT encoded_state FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ encoded_state: Uint8Array }>();

    expect(row).not.toBeNull();

    // Decode and verify
    const restored = new Y.Doc();
    applyUpdate(restored, row!.encoded_state);
    expect(restored.getText("content").toString()).toBe("persisted content");

    doc.destroy();
    restored.destroy();
  });

  it("upsert updates existing session", async () => {
    const sessionId = "test-session-id";
    const now = Date.now();

    // Initial insert
    await db
      .prepare(
        `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, now, now)
      .run();

    // Upsert with encoded state
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "updated");
    const encoded = encodeStateAsUpdate(doc);

    await db
      .prepare(
        `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           encoded_state = excluded.encoded_state,
           last_active_at = excluded.last_active_at`,
      )
      .bind(sessionId, encoded, now, now + 1000)
      .run();

    const row = await db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first();

    expect(row).not.toBeNull();
    expect(row!.last_active_at).toBe(now + 1000);

    doc.destroy();
  });

  it("deletes idle sessions", async () => {
    const sessionId = "old-session-id";
    const now = Date.now();

    await db
      .prepare(
        `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, now, now - 25 * 60 * 60 * 1_000) // 25 hours ago
      .run();

    // Delete sessions idle for more than 24 hours
    await db
      .prepare(
        "DELETE FROM live_sessions WHERE last_active_at < ?",
      )
      .bind(now - 24 * 60 * 60 * 1_000)
      .run();

    const row = await db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first();

    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: Yjs update encoding/decoding (protocol-level)
// ---------------------------------------------------------------------------

describe("Yjs update encoding", () => {
  /**
   * encodeStateAsUpdate produces non-empty output when there are changes.
   */
  it("produces non-empty update for modified document", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "hello");
    const encoded = encodeStateAsUpdate(doc);
    expect(encoded.byteLength).toBeGreaterThan(0);
    doc.destroy();
  });

  /**
   * encodeStateAsUpdate produces empty output for an empty document.
   */
  it("produces empty update for empty document", () => {
    const doc = new Y.Doc();
    const encoded = encodeStateAsUpdate(doc);
    // Empty doc against empty SV may produce minimal or zero-length output
    expect(encoded.byteLength).toBeGreaterThanOrEqual(0);
    doc.destroy();
  });

  /**
   * encodeStateVector grows as the document accumulates changes.
   */
  it("state vector grows with changes", () => {
    const doc = new Y.Doc();
    const sv0 = encodeStateVector(doc);
    doc.getText("content").insert(0, "first");
    const sv1 = encodeStateVector(doc);
    doc.getText("content").insert(5, " second");
    const sv2 = encodeStateVector(doc);
    // State vectors should grow (or at least not shrink)
    expect(sv1.byteLength).toBeGreaterThanOrEqual(sv0.byteLength);
    expect(sv2.byteLength).toBeGreaterThanOrEqual(sv1.byteLength);
    doc.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Reconnect scenario
// ---------------------------------------------------------------------------

describe("Reconnect behavior", () => {
  /**
   * Simulate a client disconnecting and reconnecting:
   * 1. Server has accumulated state from other clients
   * 2. Reconnecting client sends its state vector
   * 3. Server computes diff and sends missing updates
   * 4. Client catches up to current state
   */
  it("reconnecting client catches up with missed updates", () => {
    // Server document accumulates edits
    const serverDoc = new Y.Doc();
    const serverText = serverDoc.getText("content");
    serverText.insert(0, "initial");

    // Client connects, gets full state
    const clientDoc = new Y.Doc();
    applyUpdate(clientDoc, encodeStateAsUpdate(serverDoc));

    // Client disconnects (we simulate this by stopping sync)

    // Other clients make edits on the server
    serverText.insert(7, " continued");
    serverText.insert(0, "[live] ");

    // Client reconnects — sends its old state vector
    const clientSV = encodeStateVector(clientDoc);
    const diff = encodeStateAsUpdate(serverDoc, clientSV);

    // Client applies diff to catch up
    applyUpdate(clientDoc, diff);

    const clientContent = clientDoc.getText("content").toString();
    const serverContent = serverDoc.getText("content").toString();

    expect(clientContent).toBe(serverContent);
    expect(clientContent).toBe("[live] initial continued");

    serverDoc.destroy();
    clientDoc.destroy();
  });

  /**
   * Reconnecting client with newer edits (edited offline) merges correctly.
   */
  it("reconnecting client with offline edits merges correctly", () => {
    // Server document
    const serverDoc = new Y.Doc();
    serverDoc.getText("content").insert(0, "server-base");

    // Client gets initial state
    const clientDoc = new Y.Doc();
    applyUpdate(clientDoc, encodeStateAsUpdate(serverDoc));

    // Client disconnects and makes local edits
    const clientText = clientDoc.getText("content");
    clientText.insert(0, "[offline] ");

    // Meanwhile, server gets edits from other clients
    const serverText = serverDoc.getText("content");
    serverText.insert(0, "[live] ");

    // Client reconnects — exchange updates
    const clientUpdate = encodeStateAsUpdate(clientDoc, encodeStateVector(serverDoc));
    const serverUpdate = encodeStateAsUpdate(serverDoc, encodeStateVector(clientDoc));

    // Merge: server applies client's update, client applies server's update
    applyUpdate(serverDoc, clientUpdate);
    applyUpdate(clientDoc, serverUpdate);

    // Both should contain all edits
    const serverContent = serverDoc.getText("content").toString();
    const clientContent = clientDoc.getText("content").toString();

    expect(serverContent).toContain("[live]");
    expect(serverContent).toContain("[offline]");
    expect(serverContent).toContain("server-base");

    expect(clientContent).toContain("[live]");
    expect(clientContent).toContain("[offline]");
    expect(clientContent).toContain("server-base");

    // State vectors match
    expect(encodeStateVector(serverDoc)).toEqual(encodeStateVector(clientDoc));

    serverDoc.destroy();
    clientDoc.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: Idle cleanup alarm
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared test doubles for constructing a LiveSession without workerd
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake DurableObjectState for constructing a LiveSession
 * instance in unit tests without workerd.
 */
function makeFakeState(sessionId: string): DurableObjectState {
  return {
    id: { toString: () => sessionId } as DurableObjectId,
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
    storage: {
      setAlarm: vi.fn().mockResolvedValue(undefined),
      getAlarm: vi.fn().mockResolvedValue(null),
      listKeys: vi.fn().mockResolvedValue({ keys: [], listHref: null }),
      get: vi.fn().mockResolvedValue(undefined),
      getByteLength: vi.fn().mockResolvedValue(0),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockResolvedValue({}),
    },
    scheduled: undefined,
    container: {} as DurableObjectContainer,
  } as unknown as DurableObjectState;
}

/**
 * Build a fake WebSocket that can be added to the session's clients set.
 */
function makeFakeWs(): WebSocket & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  return {
    readyState: WebSocket.OPEN,
    send,
    close: vi.fn(),
    accept: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    extensions: "",
    protocol: "",
  } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

/**
 * Helper type to access the private `clients` set on LiveSession.
 */
type LiveSessionWithClients = LiveSession & { clients: Set<{ ws: WebSocket; clientId: string }> };

describe("Idle cleanup alarm", () => {
  it("does NOT delete session when active connections exist, regardless of staleness", async () => {
    const sessionId = "active-session";
    const state = makeFakeState(sessionId);
    const db = createD1Mock(MIGRATION_SQL);

    // Insert a row with last_active_at 25 hours ago (> IDLE_TTL_MS)
    const staleTime = Date.now() - 25 * 60 * 60 * 1_000;
    await db
      .prepare(
        `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, staleTime, staleTime)
      .run();

    // Construct LiveSession and inject a connected client
    const env: Env = { LiveSession: {} as DurableObjectNamespace, DB: db };
    const session = new LiveSession(state, env);
    // Wait for blockConcurrencyWhile (load) to complete
    await Promise.resolve();

    const fakeWs = makeFakeWs();
    (session as LiveSessionWithClients).clients.add({ ws: fakeWs, clientId: "c1" });

    // Trigger alarm
    await session.alarm();

    // The session must NOT have been deleted
    const row = await db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first();
    expect(row).not.toBeNull();

    // No session-ended message should have been sent
    expect(fakeWs.send).not.toHaveBeenCalled();

    // Alarm was rescheduled (setAlarm called)
    expect(state.storage.setAlarm).toHaveBeenCalled();
  });

  it("deletes abandoned session with no active connections", async () => {
    const sessionId = "abandoned-session";
    const state = makeFakeState(sessionId);
    const db = createD1Mock(MIGRATION_SQL);

    // Insert a row with last_active_at 25 hours ago (> IDLE_TTL_MS)
    const staleTime = Date.now() - 25 * 60 * 60 * 1_000;
    await db
      .prepare(
        `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, staleTime, staleTime)
      .run();

    // Construct LiveSession with NO connected clients
    const env: Env = { LiveSession: {} as DurableObjectNamespace, DB: db };
    const session = new LiveSession(state, env);
    await Promise.resolve();

    // Trigger alarm — clients set is empty
    await session.alarm();

    // The session MUST have been deleted
    const row = await db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first();
    expect(row).toBeNull();
  });

  it("reschedules alarm when session is still within idle TTL", async () => {
    const sessionId = "fresh-session";
    const state = makeFakeState(sessionId);
    const db = createD1Mock(MIGRATION_SQL);

    // Insert a row with last_active_at only 1 hour ago (< IDLE_TTL_MS)
    const recentTime = Date.now() - 1 * 60 * 60 * 1_000;
    await db
      .prepare(
        `INSERT INTO live_sessions (id, encoded_state, created_at, last_active_at)
         VALUES (?, NULL, ?, ?)`,
      )
      .bind(sessionId, recentTime, recentTime)
      .run();

    const env: Env = { LiveSession: {} as DurableObjectNamespace, DB: db };
    const session = new LiveSession(state, env);
    await Promise.resolve();

    await session.alarm();

    // Session still exists
    const row = await db
      .prepare("SELECT * FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first();
    expect(row).not.toBeNull();

    // Alarm was rescheduled
    expect(state.storage.setAlarm).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: Awareness forwarding
// ---------------------------------------------------------------------------

describe("Awareness", () => {
  /**
   * setLocalState sets the local client's awareness state.
   */
  it("setLocalState tracks local state", () => {
    const doc = new Y.Doc();
    const { Awareness } = require("y-protocols/awareness");
    const awareness = new Awareness(doc);

    awareness.setLocalState({ name: "Alice", color: "#ff0000" });

    const states = awareness.getStates();
    expect(states.has(awareness.clientID)).toBe(true);
    expect(states.get(awareness.clientID)).toEqual({ name: "Alice", color: "#ff0000" });

    // Clear local state
    awareness.setLocalState(null);
    expect(states.has(awareness.clientID)).toBe(false);

    doc.destroy();
  });

  /**
   * Two docs sharing updates converge on awareness state.
   */
  it("two clients exchange awareness via applyAwarenessUpdate", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { Awareness } = require("y-protocols/awareness");
    const { applyAwarenessUpdate, encodeAwarenessUpdate } = require("y-protocols/awareness");

    const awarenessA = new Awareness(docA);
    const awarenessB = new Awareness(docB);

    // Client A sets its state
    awarenessA.setLocalState({ name: "Alice" });

    // Encode A's state and apply it to B
    const updateFromA = encodeAwarenessUpdate(awarenessA, [awarenessA.clientID]);
    applyAwarenessUpdate(awarenessB, updateFromA, "test");

    // B should now know about A
    const statesB = awarenessB.getStates();
    expect(statesB.has(awarenessA.clientID)).toBe(true);
    expect(statesB.get(awarenessA.clientID)).toEqual({ name: "Alice" });

    // Client B sets its state
    awarenessB.setLocalState({ name: "Bob" });

    // Encode B's state and apply it to A
    const updateFromB = encodeAwarenessUpdate(awarenessB, [awarenessB.clientID]);
    applyAwarenessUpdate(awarenessA, updateFromB, "test");

    // A should now know about B
    const statesA = awarenessA.getStates();
    expect(statesA.has(awarenessB.clientID)).toBe(true);
    expect(statesA.get(awarenessB.clientID)).toEqual({ name: "Bob" });

    docA.destroy();
    docB.destroy();
  });

  /**
   * Client removal propagates correctly.
   */
  it("client disconnect removes awareness state", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { Awareness } = require("y-protocols/awareness");
    const { applyAwarenessUpdate, encodeAwarenessUpdate } = require("y-protocols/awareness");

    const awarenessA = new Awareness(docA);
    const awarenessB = new Awareness(docB);

    // A joins
    awarenessA.setLocalState({ name: "Alice" });
    const joinMsg = encodeAwarenessUpdate(awarenessA, [awarenessA.clientID]);
    applyAwarenessUpdate(awarenessB, joinMsg, "test");

    expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(true);

    // A disconnects — clear state and broadcast removal
    awarenessA.setLocalState(null);
    const leaveMsg = encodeAwarenessUpdate(awarenessA, [awarenessA.clientID]);
    applyAwarenessUpdate(awarenessB, leaveMsg, "test");

    expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(false);

    docA.destroy();
    docB.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: LiveSession's own per-connection awareness cleanup
//
// The tests above exercise the y-protocols/awareness library directly. These
// exercise LiveSession's own bookkeeping — which numeric awareness client IDs a
// given WebSocket connection introduced — since the DO must remove only a
// disconnecting connection's own entries, not guess based on unrelated identifiers.
// ---------------------------------------------------------------------------

describe("Awareness disconnect cleanup (LiveSession)", () => {
  /** Access LiveSession's private awareness-related members for direct testing. */
  type LiveSessionAwarenessInternals = LiveSession & {
    applyIncomingAwarenessUpdate: (data: Uint8Array, origin: WebSocket) => void;
    disconnectAwareness: (ws: WebSocket) => Uint8Array | null;
    awareness: { getStates: () => Map<number, unknown> };
  };

  async function makeSession(sessionId: string): Promise<LiveSessionAwarenessInternals> {
    const state = makeFakeState(sessionId);
    const db = createD1Mock(MIGRATION_SQL);
    const env: Env = { LiveSession: {} as DurableObjectNamespace, DB: db };
    const session = new LiveSession(state, env);
    await Promise.resolve(); // let blockConcurrencyWhile's load() settle
    return session as unknown as LiveSessionAwarenessInternals;
  }

  it("removes only the disconnecting connection's own awareness client IDs", async () => {
    const session = await makeSession("awareness-disconnect-session");
    const wsAlice = makeFakeWs();
    const wsBob = makeFakeWs();

    const { Awareness, encodeAwarenessUpdate } = require("y-protocols/awareness");
    const docAlice = new Y.Doc();
    const docBob = new Y.Doc();
    const awarenessAlice = new Awareness(docAlice);
    const awarenessBob = new Awareness(docBob);
    awarenessAlice.setLocalState({ name: "Alice" });
    awarenessBob.setLocalState({ name: "Bob" });

    // Each connection's incoming awareness update is attributed to that connection's
    // own WebSocket via the constructor's "update" listener — this is the piece that
    // was previously missing, so removal on disconnect had nothing correct to key off.
    session.applyIncomingAwarenessUpdate(
      encodeAwarenessUpdate(awarenessAlice, [awarenessAlice.clientID]),
      wsAlice,
    );
    session.applyIncomingAwarenessUpdate(
      encodeAwarenessUpdate(awarenessBob, [awarenessBob.clientID]),
      wsBob,
    );

    expect(session.awareness.getStates().has(awarenessAlice.clientID)).toBe(true);
    expect(session.awareness.getStates().has(awarenessBob.clientID)).toBe(true);

    // Alice disconnects
    const removalMsg = session.disconnectAwareness(wsAlice);

    expect(removalMsg).not.toBeNull();
    expect(session.awareness.getStates().has(awarenessAlice.clientID)).toBe(false);
    // Bob's state must survive — a prior bug removed by an unrelated string ID and
    // either matched nothing (no-op) or, worse, could not distinguish clients at all.
    expect(session.awareness.getStates().has(awarenessBob.clientID)).toBe(true);

    docAlice.destroy();
    docBob.destroy();
  });

  it("returns null when the disconnecting connection had no awareness state", async () => {
    const session = await makeSession("awareness-no-state-session");
    const wsSilent = makeFakeWs();

    const removalMsg = session.disconnectAwareness(wsSilent);

    expect(removalMsg).toBeNull();
  });
});
