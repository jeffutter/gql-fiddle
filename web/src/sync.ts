// Cloud sync engine (TASK-88.6) + cross-device auto-refresh (TASK-88.7)
// + optional real-time WebSocket sync (TASK-88.8).
//
// Lifecycle:
//   - Bootstrapped once in App.tsx via useEffect(() => initSync(), []).
//   - On login (auth status → "authed"): full snapshot pull → merge → push
//     local-only workspaces up; also opens a WebSocket to /api/ws.
//   - Auto-save: debounced 300 ms PUT per changed workspace; version bumped
//     before each push; 409 causes client to adopt server row (LWW).
//   - Delete while logged in: soft-delete via DELETE /api/workspaces/:id.
//   - Cross-device refresh: window focus / visibilitychange → throttled delta
//     GET ?since=<lastPullTs>; optional 60 s polling while tab is visible.
//     When the WebSocket is connected, a received invalidation signal triggers
//     an immediate (force=true) delta pull that bypasses the throttle.
//   - Offline: edits queued in memory and flushed on "online" event / login.
//   - Anonymous / logged-out: store subscription short-circuits, no API calls.
//   - WebSocket unavailability degrades gracefully: focus/visibility pulls and
//     60 s polling continue exactly as in TASK-88.7.
import type { WorkspaceEntry, WorkspacePayload } from "./share";
import { useWorkspace } from "./store";
import { useAuth } from "./auth";

// ---------------------------------------------------------------------------
// Server-side row shape (mirrors WorkspaceRow from functions/_lib/db.ts)
// ---------------------------------------------------------------------------

interface WorkspaceRow {
  id: string;
  name: string;
  payload: string; // JSON WorkspacePayload
  version: number;
  updated_at: number;
  deleted_at: number | null;
}

// ---------------------------------------------------------------------------
// Serialization — only synced fields, not session-only state
// ---------------------------------------------------------------------------

function entryToPayload(ws: WorkspaceEntry): string {
  const p: WorkspacePayload = {
    subgraphs: ws.subgraphs,
    queryTabs: ws.queryTabs,
    activeQueryTab: ws.activeQueryTab,
    seed: ws.seed,
    mockConfig: ws.mockConfig,
  };
  return JSON.stringify(p);
}

function rowToEntry(row: WorkspaceRow): WorkspaceEntry {
  const p = JSON.parse(row.payload) as WorkspacePayload;
  return {
    name: row.name,
    id: row.id,
    version: row.version,
    subgraphs: p.subgraphs,
    activeSubgraph: 0,
    queryTabs: p.queryTabs,
    activeQueryTab: p.activeQueryTab ?? 0,
    seed: p.seed,
    mockConfig: p.mockConfig ?? "",
    tourDraft: null, // tours are URL-shareable (#t=); not synced to cloud
  };
}

// ---------------------------------------------------------------------------
// Merge function — exported for unit tests
//
// Reconciles local WorkspaceEntry[] with remote WorkspaceRow[] using
// last-write-wins per workspace id:
//   - remote delete (deleted_at != null) → remove from local
//   - remote version > local version → adopt remote
//   - local version >= remote version → keep local
//   - local-only (no matching remote row) → keep local (will be pushed up)
// ---------------------------------------------------------------------------

export function mergeWorkspaces(local: WorkspaceEntry[], remote: WorkspaceRow[]): WorkspaceEntry[] {
  const byId = new Map<string, WorkspaceEntry>();
  for (const ws of local) {
    if (ws.id) byId.set(ws.id, ws);
  }
  for (const row of remote) {
    if (row.deleted_at !== null) {
      byId.delete(row.id); // remote delete wins
      continue;
    }
    const loc = byId.get(row.id);
    if (!loc || row.version > (loc.version ?? 0)) {
      byId.set(row.id, rowToEntry(row)); // remote is newer
    }
    // else: local is same version or newer → local wins
  }
  return Array.from(byId.values());
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function pullWorkspaces(since?: number): Promise<WorkspaceRow[]> {
  const url = since !== undefined ? `/api/workspaces?since=${since}` : "/api/workspaces";
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const data = (await res.json()) as { workspaces: WorkspaceRow[] };
  return data.workspaces;
}

/**
 * Push one workspace to the server.
 * Returns the server row on both 200 (accepted) and 409 (stale — caller
 * should adopt the server row). Returns null only on auth errors (401/403),
 * which are expected when logged out mid-session.
 */
async function pushWorkspace(ws: WorkspaceEntry): Promise<WorkspaceRow | null> {
  if (!ws.id) return null;
  const res = await fetch(`/api/workspaces/${ws.id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: ws.name,
      payload: entryToPayload(ws),
      version: ws.version ?? 1,
    }),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (res.status === 409) {
    const data = (await res.json()) as { current: WorkspaceRow };
    return data.current;
  }
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);
  const data = (await res.json()) as { workspace: WorkspaceRow };
  return data.workspace;
}

async function deleteWorkspace(id: string): Promise<void> {
  await fetch(`/api/workspaces/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}

// ---------------------------------------------------------------------------
// Delta refresh (TASK-88.7) — exported so tests can trigger it directly
// ---------------------------------------------------------------------------

export let lastPullTs = 0;
const THROTTLE_MS = 30_000; // at most one delta pull per 30 s

// isSyncing is module-level so both initSync and deltaRefresh can check it.
let isSyncing = false;

export async function deltaRefresh(force = false): Promise<void> {
  if (useAuth.getState().status !== "authed") return;
  const now = Date.now();
  if (!force && now - lastPullTs < THROTTLE_MS) return;
  const since = lastPullTs;
  lastPullTs = now;
  try {
    const rows = await pullWorkspaces(since);
    if (rows.length === 0) return;
    const local = useWorkspace.getState().workspaces;
    const merged = mergeWorkspaces(local, rows);
    isSyncing = true;
    try {
      useWorkspace.setState({ workspaces: merged });
    } finally {
      isSyncing = false;
    }
  } catch (err) {
    console.error("Sync: delta refresh failed", err);
  }
}

// ---------------------------------------------------------------------------
// WebSocket client for real-time invalidation signals (TASK-88.8)
//
// Opens a persistent WebSocket to /api/ws (the UserSyncDO upgrade endpoint).
// On receiving a valid { changedId, version } message, immediately runs a
// delta refresh bypassing the throttle — the server just committed a write.
// Reconnects with exponential backoff (1 s → 60 s cap) on unexpected close.
// Gracefully degrades: if the socket is unavailable the 88.7 pull-based
// strategy (focus/visibility pulls + 60 s polling) continues uninterrupted.
// ---------------------------------------------------------------------------

const WS_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
const WS_MAX_ATTEMPTS = 3; // give up after 3 failures and fall back to polling

interface InvalidationMsg {
  changedId: string;
  version: number | null;
}

export function connectWs(): { close: () => void } {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  function connect() {
    if (stopped || useAuth.getState().status !== "authed") return;
    ws = new WebSocket("/api/ws");

    ws.addEventListener("open", () => {
      attempt = 0; // reset backoff on successful connection
    });

    ws.addEventListener("message", (ev) => {
      try {
        // Validate message shape; ignore anything that doesn't parse.
        const msg = JSON.parse(ev.data as string) as InvalidationMsg;
        if (typeof msg.changedId !== "string") return;
        void deltaRefresh(true); // bypass throttle — server just wrote
      } catch {
        // Ignore malformed frames.
      }
    });

    ws.addEventListener("close", (ev) => {
      ws = null;
      if (stopped || ev.code === 1000) return; // clean close — don't reconnect
      if (attempt >= WS_MAX_ATTEMPTS) return; // endpoint unavailable — fall back to polling
      const delay = WS_RECONNECT_DELAYS_MS[Math.min(attempt, WS_RECONNECT_DELAYS_MS.length - 1)];
      attempt++;
      reconnectTimer = setTimeout(connect, delay);
    });

    ws.addEventListener("error", () => {
      // The "close" event always fires after "error"; reconnect logic lives there.
    });
  }

  connect();

  return {
    close() {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws?.readyState === WebSocket.OPEN) ws.close(1000, "logout");
      ws = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Sync engine initialization
// ---------------------------------------------------------------------------

export function initSync(): () => void {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const offlineQueue = new Map<string, WorkspaceEntry>(); // keyed by id

  async function onLogin() {
    isSyncing = true;
    try {
      useAuth.getState().setSyncStatus("saving");
      const rows = await pullWorkspaces();
      lastPullTs = Date.now();
      const local = useWorkspace.getState().workspaces;
      const merged = mergeWorkspaces(local, rows);

      // Push workspaces that exist locally but not on the server
      const remoteIds = new Set(rows.map((r) => r.id));
      for (const ws of merged) {
        if (ws.id && !remoteIds.has(ws.id)) {
          const bumped = { ...ws, version: ws.version ?? 1 };
          await pushWorkspace(bumped);
        }
      }

      useWorkspace.setState({ workspaces: merged });
      useAuth.getState().setSyncStatus("synced");

      // Flush anything queued before login resolved
      await flushOfflineQueue();
    } catch (err) {
      console.error("Sync: pull-on-login failed", err);
      useAuth.getState().setSyncStatus("error");
    } finally {
      isSyncing = false;
    }
  }

  async function autoSave(ws: WorkspaceEntry) {
    if (!navigator.onLine) {
      offlineQueue.set(ws.id!, ws);
      useAuth.getState().setSyncStatus("offline");
      return;
    }
    // Bump version locally before sending
    const bumped = { ...ws, version: (ws.version ?? 0) + 1 };
    useAuth.getState().setSyncStatus("saving");
    try {
      const serverRow = await pushWorkspace(bumped);
      if (serverRow) {
        // Update local entry to match server row (handles both 200 and 409)
        isSyncing = true;
        try {
          const workspaces = useWorkspace
            .getState()
            .workspaces.map((w) =>
              w.id === ws.id ? { ...rowToEntry(serverRow), tourDraft: w.tourDraft } : w,
            );
          useWorkspace.setState({ workspaces });
        } finally {
          isSyncing = false;
        }
      }
      useAuth.getState().setSyncStatus("synced");
    } catch (err) {
      console.error("Sync: auto-save failed", err);
      offlineQueue.set(ws.id!, ws);
      useAuth.getState().setSyncStatus(navigator.onLine ? "error" : "offline");
    }
  }

  async function flushOfflineQueue() {
    if (useAuth.getState().status !== "authed") return;
    const entries = Array.from(offlineQueue.values());
    offlineQueue.clear();
    for (const ws of entries) {
      await autoSave(ws);
    }
  }

  // Subscribe to auth state changes — trigger pull-on-login and manage WS.
  let wsConn: { close: () => void } | null = null;

  const unsubAuth = useAuth.subscribe((auth, prevAuth) => {
    if (auth.status === "authed" && prevAuth.status !== "authed") {
      void onLogin();
      wsConn = connectWs(); // open WebSocket alongside the pull-on-login
    }
    if (auth.status !== "authed" && prevAuth.status === "authed") {
      wsConn?.close();
      wsConn = null; // close WebSocket on logout
    }
  });

  // Subscribe to workspace changes — trigger debounced save or delete.
  const unsubStore = useWorkspace.subscribe((state, prevState) => {
    if (isSyncing) return; // ignore pull-triggered updates (no feedback loop)
    if (useAuth.getState().status !== "authed") return;

    const curr = state.workspaces;
    const prev = prevState.workspaces;

    // Detect deleted workspaces → soft-delete on server
    const currIds = new Set(curr.map((w) => w.id).filter(Boolean));
    for (const ws of prev) {
      if (ws.id && !currIds.has(ws.id)) {
        void deleteWorkspace(ws.id);
        offlineQueue.delete(ws.id);
      }
    }

    // Detect changed or new workspaces → debounced PUT
    for (const ws of curr) {
      if (!ws.id) continue;
      const was = prev.find((w) => w.id === ws.id);
      const changed = !was || JSON.stringify(ws) !== JSON.stringify(was);
      if (changed) {
        const id = ws.id;
        const existing = debounceTimers.get(id);
        if (existing) clearTimeout(existing);
        debounceTimers.set(
          id,
          setTimeout(() => {
            debounceTimers.delete(id);
            void autoSave(ws);
          }, 300),
        );
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Cross-device refresh: focus + visibilitychange + optional polling (88.7)
  // ---------------------------------------------------------------------------

  function onFocus() {
    void deltaRefresh();
  }
  function onVisibility() {
    if (document.visibilityState === "visible") void deltaRefresh();
  }

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);

  // Conservative polling — only while tab is visible. Every 60 s.
  const POLL_MS = 20_000;
  const pollId = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void deltaRefresh();
  }, POLL_MS);

  // Flush offline queue on network reconnect
  function onOnline() {
    useAuth.getState().setSyncStatus("synced");
    void flushOfflineQueue();
  }
  window.addEventListener("online", onOnline);

  return () => {
    wsConn?.close();
    wsConn = null;
    unsubAuth();
    unsubStore();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    clearInterval(pollId);
    for (const t of debounceTimers.values()) clearTimeout(t);
  };
}
