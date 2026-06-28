// Cloud sync engine (TASK-88.6) + cross-device auto-refresh (TASK-88.7).
//
// Lifecycle:
//   - Bootstrapped once in App.tsx via useEffect(() => initSync(), []).
//   - On login (auth status → "authed"): full snapshot pull → merge → push
//     local-only workspaces up.
//   - Auto-save: debounced 300 ms PUT per changed workspace; version bumped
//     before each push; 409 causes client to adopt server row (LWW).
//   - Delete while logged in: soft-delete via DELETE /api/workspaces/:id.
//   - Cross-device refresh: window focus / visibilitychange → throttled delta
//     GET ?since=<lastPullTs>; polling every 20 s while tab is visible.
//   - Offline: edits queued in memory and flushed on "online" event / login.
//   - Anonymous / logged-out: store subscription short-circuits, no API calls.
import type { WorkspaceEntry, WorkspacePayload } from "./share";
import { useWorkspace, makeDefaultWorkspace } from "./store";
import { useAuth } from "./auth";
import { getOrCreateKey, encrypt, decrypt, initEncryption } from "./encryption";

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

async function decryptRow(key: CryptoKey, row: WorkspaceRow): Promise<WorkspaceRow> {
  return {
    ...row,
    name: await decrypt(key, row.name),
    payload: await decrypt(key, row.payload),
  };
}

async function pullWorkspaces(since?: number): Promise<WorkspaceRow[]> {
  const url = since !== undefined ? `/api/workspaces?since=${since}` : "/api/workspaces";
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const data = (await res.json()) as { workspaces: WorkspaceRow[] };
  const key = await getOrCreateKey();
  return Promise.all(data.workspaces.map((row) => decryptRow(key, row)));
}

/**
 * Push one workspace to the server.
 * Returns the server row on both 200 (accepted) and 409 (stale — caller
 * should adopt the server row). Returns null only on auth errors (401/403),
 * which are expected when logged out mid-session.
 */
async function pushWorkspace(ws: WorkspaceEntry): Promise<WorkspaceRow | null> {
  if (!ws.id) return null;
  const key = await getOrCreateKey();
  const encName = await encrypt(key, ws.name);
  const encPayload = await encrypt(key, entryToPayload(ws));
  const res = await fetch(`/api/workspaces/${ws.id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: encName,
      payload: encPayload,
      version: ws.version ?? 1,
    }),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (res.status === 409) {
    const data = (await res.json()) as { current: WorkspaceRow };
    return decryptRow(key, data.current);
  }
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);
  const data = (await res.json()) as { workspace: WorkspaceRow };
  return decryptRow(key, data.workspace);
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
const THROTTLE_MS = 15_000; // at most one delta pull per 15 s (dampen focus/visibility bursts)

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
    // Guard against an empty result (all remote workspaces deleted); clamp index.
    const safeMerged = merged.length > 0 ? merged : [makeDefaultWorkspace("Workspace 1")];
    const currIdx = useWorkspace.getState().activeWorkspaceIndex;
    const safeIdx = Math.min(currIdx, safeMerged.length - 1);
    isSyncing = true;
    try {
      useWorkspace.setState({ workspaces: safeMerged, activeWorkspaceIndex: safeIdx });
    } finally {
      isSyncing = false;
    }
  } catch (err) {
    console.error("Sync: delta refresh failed", err);
  }
}

// ---------------------------------------------------------------------------
// Sync engine initialization
// ---------------------------------------------------------------------------

const AUTOSAVE_DEBOUNCE_MS = 2_000; // 2 s — balance responsiveness vs. push frequency

export function initSync(): () => void {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const offlineQueue = new Map<string, WorkspaceEntry>(); // keyed by id

  async function onLogin() {
    isSyncing = true;
    try {
      useAuth.getState().setSyncStatus("saving");
      await initEncryption();
      // Use since=0 so the delta endpoint returns all rows (including soft-deleted
      // ones). pullWorkspaces() with no arg hits /api/workspaces which filters
      // deleted_at IS NULL, causing deleted workspaces to be re-created locally.
      const rows = await pullWorkspaces(0);
      lastPullTs = Date.now();
      const local = useWorkspace.getState().workspaces;
      const merged = mergeWorkspaces(local, rows);

      // Push workspaces that exist locally but not on the server; adopt the
      // server row on success so local versions are authoritative from login.
      const remoteIds = new Set(rows.map((r) => r.id));
      const finalMerged = [...merged];
      for (let i = 0; i < finalMerged.length; i++) {
        const ws = finalMerged[i];
        if (ws.id && !remoteIds.has(ws.id)) {
          const bumped = { ...ws, version: ws.version ?? 1 };
          const serverRow = await pushWorkspace(bumped);
          if (serverRow) {
            finalMerged[i] = { ...rowToEntry(serverRow), tourDraft: ws.tourDraft };
          }
        }
      }

      // Guard against an empty result (all workspaces deleted remotely); clamp index.
      const safeMerged =
        finalMerged.length > 0 ? finalMerged : [makeDefaultWorkspace("Workspace 1")];
      const currIdx = useWorkspace.getState().activeWorkspaceIndex;
      const safeIdx = Math.min(currIdx, safeMerged.length - 1);
      useWorkspace.setState({ workspaces: safeMerged, activeWorkspaceIndex: safeIdx });
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

  // Subscribe to auth state changes — trigger pull-on-login.
  const unsubAuth = useAuth.subscribe((auth, prevAuth) => {
    if (auth.status === "authed" && prevAuth.status !== "authed") {
      void onLogin();
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
            // Read current state so we always push the latest version, not the
            // snapshot captured when the timer was last (re)set.
            const current = useWorkspace.getState().workspaces.find((w) => w.id === id);
            if (current) void autoSave(current);
          }, AUTOSAVE_DEBOUNCE_MS),
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

  // Conservative polling — only while tab is visible. Every 20 s.
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
    unsubAuth();
    unsubStore();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    clearInterval(pollId);
    for (const t of debounceTimers.values()) clearTimeout(t);
  };
}
