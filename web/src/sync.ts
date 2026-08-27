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
//     GET ?since=<syncCursor>, where syncCursor is a server-issued
//     high-water-mark (never a client wall-clock value — see the cursor
//     contract in AGENTS.md); polling every 20 s while tab is visible.
//   - Offline: edits and deletes queued in memory and flushed on "online"
//     event / login.
//   - Anonymous / logged-out: store subscription short-circuits, no API calls.
import { create } from "zustand";
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
  saved: boolean;
  open: boolean;
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

// Session-only state (activeSubgraph selection) is not part of the
// synced WorkspacePayload, so a server row carries no value for it. Preserve it
// from the existing local entry when we have one; otherwise fall back to
// defaults. Without this, rebuilding an entry from a server row (on autosave
// echo, delta poll, or login) would snap the user's active subgraph back to 0.
function rowToEntry(row: WorkspaceRow, local?: WorkspaceEntry): WorkspaceEntry {
  const p = JSON.parse(row.payload) as WorkspacePayload;
  return {
    name: row.name,
    id: row.id,
    version: row.version,
    subgraphs: p.subgraphs,
    // Clamp in case a remote edit removed subgraphs the local index pointed at.
    activeSubgraph: Math.min(local?.activeSubgraph ?? 0, Math.max(0, p.subgraphs.length - 1)),
    queryTabs: p.queryTabs,
    activeQueryTab: p.activeQueryTab ?? 0,
    seed: p.seed,
    mockConfig: p.mockConfig ?? "",
    saved: row.saved,
    open: row.open,
  };
}

// ---------------------------------------------------------------------------
// Merge functions — exported for unit tests
//
// Reconciles local WorkspaceEntry[] with remote WorkspaceRow[] using
// last-write-wins per workspace id:
//   - remote delete (deleted_at != null) → remove from local
//   - remote version > local version → adopt remote
//   - local version >= remote version → keep local
//   - local-only (no matching remote row) → keep local (will be pushed up)
//
// mergeWorkspaces (the tab bar) and mergeSavedLibrary (the closed-saved-
// workspace library) are two halves of one partition over every pulled row:
// a saved-and-closed workspace belongs in the library, everything else
// belongs in the tab bar, and a row never belongs in both. Both share this
// generic by-id reducer, parameterized by which rows this merge target
// excludes.
// ---------------------------------------------------------------------------

function mergeById(
  local: WorkspaceEntry[],
  remote: WorkspaceRow[],
  excludeRow: (row: WorkspaceRow) => boolean,
): WorkspaceEntry[] {
  const byId = new Map<string, WorkspaceEntry>();
  for (const ws of local) {
    if (ws.id) byId.set(ws.id, ws);
  }
  for (const row of remote) {
    const loc = byId.get(row.id);
    if (row.deleted_at !== null) {
      byId.delete(row.id); // remote delete wins
      continue;
    }
    const remoteWins = !loc || row.version > (loc.version ?? 0);
    if (excludeRow(row)) {
      // Remote says this row doesn't belong in this merge target. Only
      // remove an existing entry when the remote row actually wins the LWW
      // race — a not-yet-pushed local change (e.g. just opened/closed here)
      // must survive until it's had a chance to reach the server.
      if (remoteWins) byId.delete(row.id);
      continue;
    }
    if (remoteWins) byId.set(row.id, rowToEntry(row, loc)); // remote is newer
    // else: local is same version or newer → local wins
  }
  return Array.from(byId.values());
}

/** Tab bar: every remote row except a closed saved workspace. */
export function mergeWorkspaces(local: WorkspaceEntry[], remote: WorkspaceRow[]): WorkspaceEntry[] {
  return mergeById(local, remote, (row) => row.saved && !row.open);
}

/** Saved-workspace library: exactly the complement — only closed saved workspaces. */
export function mergeSavedLibrary(
  local: WorkspaceEntry[],
  remote: WorkspaceRow[],
): WorkspaceEntry[] {
  return mergeById(local, remote, (row) => !row.saved || row.open);
}

/**
 * Closed-but-saved workspaces: tracked separately from the tab bar
 * (`useWorkspace.workspaces`) so a saved workspace lives in exactly one of
 * the two stores at a time. Populated alongside every `mergeWorkspaces` call
 * against a pull's rows (onLogin, deltaRefresh) and cleared on logout.
 */
export const useSavedWorkspaceLibrary = create<{ entries: WorkspaceEntry[] }>(() => ({
  entries: [],
}));

/**
 * Resolves the active workspace by identity across a merge, not position.
 * If the workspace that was active before the merge still exists in the
 * merged array (by id), stays active regardless of where it moved to. Falls
 * back to positional clamping only when that workspace is genuinely gone
 * from `merged` (deleted, or excluded into the saved library) — matching
 * the pre-existing empty-result fallback behavior.
 */
function resolveActiveIndex(
  prevWorkspaces: WorkspaceEntry[],
  prevActiveIndex: number,
  merged: WorkspaceEntry[],
): number {
  const activeId = prevWorkspaces[prevActiveIndex]?.id;
  if (activeId) {
    const idx = merged.findIndex((w) => w.id === activeId);
    if (idx !== -1) return idx;
  }
  return Math.min(prevActiveIndex, merged.length - 1);
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

// `since` must be either 0 (initial pull — returns all rows including
// soft-deleted ones) or a cursor previously returned by this same endpoint.
// Never pass a client-derived timestamp: the server owns the cursor value.
//
// Returns `skippedIds` — IDs of rows that existed on the server but failed
// to decrypt (wrong key / tampering). Callers must include these in any
// "remote" ID set to avoid re-pushing stale local copies that would clobber
// the valid server-side encrypted data.
async function pullWorkspaces(
  since: number,
): Promise<{ rows: WorkspaceRow[]; cursor: number; skippedIds: Set<string> }> {
  const res = await fetch(`/api/workspaces?since=${since}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const data = (await res.json()) as { workspaces: WorkspaceRow[]; cursor: number };
  const key = await getOrCreateKey();
  const settled = await Promise.allSettled(data.workspaces.map((row) => decryptRow(key, row)));
  const rows: WorkspaceRow[] = [];
  const skippedIds = new Set<string>();
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      rows.push(result.value);
    } else {
      // Never surface ciphertext as plaintext: skip rows whose decryption
      // failed (wrong key / tampering) instead of aborting the whole pull.
      console.error(
        `Sync: skipping workspace ${data.workspaces[i].id} — decryption failed`,
        result.reason,
      );
      skippedIds.add(data.workspaces[i].id);
    }
  }
  return { rows, cursor: data.cursor, skippedIds };
}

/**
 * Push one workspace to the server.
 * Returns `{ row, conflict: false }` on 200 (accepted) — `row` is just an
 * echo of what was sent, not new information. Returns `{ row, conflict:
 * true }` on 409 (stale — the server's row may hold content this client
 * doesn't have and the caller must adopt it). Returns null only on auth
 * errors (401/403), which are expected when logged out mid-session.
 */
async function pushWorkspace(
  ws: WorkspaceEntry,
): Promise<{ row: WorkspaceRow; conflict: boolean } | null> {
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
      saved: ws.saved ?? false,
      open: ws.open ?? true,
    }),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (res.status === 409) {
    const data = (await res.json()) as { current: WorkspaceRow };
    return { row: await decryptRow(key, data.current), conflict: true };
  }
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);
  const data = (await res.json()) as { workspace: WorkspaceRow };
  return { row: await decryptRow(key, data.workspace), conflict: false };
}

/**
 * Soft-delete one workspace on the server.
 * Resolves normally on 204 (deleted) and on 404 (already gone — e.g. a
 * retried delete after an earlier attempt succeeded but the client didn't
 * see the response, or the row was already reaped). Throws on any other
 * status or network failure so the caller can queue it for retry — mirrors
 * pushWorkspace's error contract just above.
 */
async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetch(`/api/workspaces/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (res.ok || res.status === 404) return;
  throw new Error(`Delete failed: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Decryption failure warning (TASK-128.2)
//
// pullWorkspaces reports skippedIds for rows that failed to decrypt (wrong
// key / tampering). Every caller must surface this via decryptWarning
// instead of silently proceeding as if nothing happened — otherwise a fully
// failed decrypt (e.g. every row on the account) leaves the user looking at
// an empty/default workspace with no indication data was dropped.
// ---------------------------------------------------------------------------

function decryptWarningMessage(skippedCount: number): string {
  return (
    `${skippedCount} workspace${skippedCount === 1 ? "" : "s"} could not be ` +
    `loaded because ${skippedCount === 1 ? "it" : "they"} failed to decrypt ` +
    `on this device. This can happen when a workspace was saved with a ` +
    `different encryption key (e.g. from another device). Your data has ` +
    `not been deleted — it may still be recoverable from the device it was ` +
    `saved on.`
  );
}

// Always set (never conditionally skipped) so a resolved failure clears a
// stale warning on the next pull that has no skipped rows.
function applyDecryptWarning(skippedIds: Set<string>): void {
  useAuth
    .getState()
    .setDecryptWarning(skippedIds.size > 0 ? decryptWarningMessage(skippedIds.size) : null);
}

// ---------------------------------------------------------------------------
// Delta refresh (TASK-88.7) — exported so tests can trigger it directly
// ---------------------------------------------------------------------------

// syncCursor is the server-provided high-water-mark, echoed back verbatim as
// `since` on the next pull. It is only ever assigned from a server
// response's `cursor` field — never from Date.now() — so client/server clock
// skew cannot cause deltas to be skipped (see AGENTS.md's cursor contract).
export let syncCursor = 0;
// lastPullAttemptTs is pure client-side wall-clock bookkeeping used only to
// throttle how often deltaRefresh fires; unlike syncCursor it never crosses
// the network as data, so wall-clock time is fine here.
export let lastPullAttemptTs = 0;
const THROTTLE_MS = 15_000; // at most one delta pull per 15 s (dampen focus/visibility bursts)

// isSyncing is module-level so both initSync and deltaRefresh can check it.
let isSyncing = false;

// Module-level (not closure-local to initSync) so both autoSave and the
// top-level openSavedWorkspace/closeSavedWorkspace/renameSavedWorkspace/
// deleteSavedWorkspace functions below can queue into the same queues via
// pushEntry/requestDelete. debounceTimers stays closure-local to initSync()
// — only the push/delete tails are shared.
const offlineQueue = new Map<string, WorkspaceEntry>(); // keyed by id
const offlineDeleteQueue = new Set<string>(); // ids pending soft-delete

/**
 * Push one workspace entry to the server, handling the offline queue, sync
 * status, and the LWW adoption of the server's response — the shared tail
 * of autoSave and the open/close actions below.
 */
async function pushEntry(ws: WorkspaceEntry): Promise<void> {
  if (!ws.id) return;
  if (!navigator.onLine) {
    offlineQueue.set(ws.id, ws);
    useAuth.getState().setSyncStatus("offline");
    return;
  }
  useAuth.getState().setSyncStatus("saving");
  try {
    const result = await pushWorkspace(ws);
    // A 200 is just an echo of what this call just sent — never adopt it.
    // Doing so would race any edit made while the request was in flight:
    // the local version doesn't bump again until the *next* debounced
    // autoSave, so a same-version echo landing after further typing would
    // silently overwrite that newer content with the stale payload just
    // pushed. Only a 409 carries content this client doesn't already have.
    if (result?.conflict) {
      isSyncing = true;
      try {
        const workspaces = useWorkspace.getState().workspaces.map((w) => {
          if (w.id !== ws.id) return w;
          // A late-arriving response for an older in-flight request must not
          // roll back a newer edit/version the store has already advanced
          // past (mirrors autoSave's stale-response guard).
          if (result.row.version < (w.version ?? 0)) return w;
          return rowToEntry(result.row, w);
        });
        useWorkspace.setState({ workspaces });
      } finally {
        isSyncing = false;
      }
    }
    useAuth.getState().setSyncStatus("synced");
  } catch (err) {
    console.error("Sync: push failed", err);
    offlineQueue.set(ws.id, useWorkspace.getState().workspaces.find((w) => w.id === ws.id) ?? ws);
    useAuth.getState().setSyncStatus(navigator.onLine ? "error" : "offline");
  }
}

// Mirrors autoSave's offline/error handling (same navigator.onLine check,
// same setSyncStatus calls, same catch-all) so a delete that can't reach
// the server — whether offline or due to a transient failure — is queued
// for retry instead of silently dropped. Module-level (not closure-local to
// initSync) for the same reason pushEntry/offlineQueue are: renameSaved
// Workspace/deleteSavedWorkspace's closed-library branch needs to issue a
// queued/retried delete without initSync() in scope.
async function requestDelete(id: string): Promise<void> {
  if (!navigator.onLine) {
    offlineDeleteQueue.add(id);
    useAuth.getState().setSyncStatus("offline");
    return;
  }
  try {
    await deleteWorkspace(id);
    useAuth.getState().setSyncStatus("synced");
  } catch (err) {
    console.error("Sync: delete failed", err);
    offlineDeleteQueue.add(id);
    useAuth.getState().setSyncStatus(navigator.onLine ? "error" : "offline");
  }
}

export async function deltaRefresh(force = false): Promise<void> {
  if (useAuth.getState().status !== "authed") return;
  const now = Date.now();
  if (!force && now - lastPullAttemptTs < THROTTLE_MS) return;
  lastPullAttemptTs = now;
  try {
    const { rows, cursor, skippedIds } = await pullWorkspaces(syncCursor);
    // Advance the cursor unconditionally — even when nothing changed — so a
    // later pull doesn't re-request rows already known not to exist.
    syncCursor = cursor;
    // Set before the empty-rows early return below: a delta pull can skip a
    // row (decryption failure) while pulling zero *new* rows, and the
    // warning must still surface in that case.
    applyDecryptWarning(skippedIds);
    if (rows.length === 0) return;
    const local = useWorkspace.getState().workspaces;
    const merged = mergeWorkspaces(local, rows);
    const library = mergeSavedLibrary(useSavedWorkspaceLibrary.getState().entries, rows);
    useSavedWorkspaceLibrary.setState({ entries: library });
    // Guard against an empty result (all remote workspaces deleted); clamp index.
    const safeMerged = merged.length > 0 ? merged : [makeDefaultWorkspace("Workspace 1")];
    const currIdx = useWorkspace.getState().activeWorkspaceIndex;
    const safeIdx = resolveActiveIndex(local, currIdx, safeMerged);
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
// Saved-workspace open/close/rename/delete actions (TASK-126.2, TASK-126.4)
//
// The mechanism 126.3/126.4's UI calls into to move a saved workspace
// between the tab bar and the closed library. Both wrap only the *local*
// state mutation in isSyncing (matching every other mutator in this file) so
// unsubStore's change-detection subscriber — which would otherwise treat the
// tab-bar change as a delete-worthy event — never fires for these calls. The
// network push happens outside that guard, same as autoSave.
// ---------------------------------------------------------------------------

/**
 * Opens a saved workspace: adds it to the tab bar (or just focuses it if
 * it's already open there — no duplicate tabs) and marks it open so it
 * appears on the user's other devices on their next sync. No-op (and logs)
 * if `id` isn't a known saved workspace.
 */
export function openSavedWorkspace(id: string): void {
  const workspaces = useWorkspace.getState().workspaces;
  const existingIndex = workspaces.findIndex((w) => w.id === id);
  if (existingIndex !== -1) {
    useWorkspace.setState({ activeWorkspaceIndex: existingIndex });
    return;
  }
  const entry = useSavedWorkspaceLibrary.getState().entries.find((w) => w.id === id);
  if (!entry) {
    console.error(`Sync: openSavedWorkspace(${id}) — not found in saved library`);
    return;
  }
  const opened: WorkspaceEntry = { ...entry, open: true, version: (entry.version ?? 0) + 1 };
  isSyncing = true;
  try {
    const next = [...workspaces, opened];
    useWorkspace.setState({ workspaces: next, activeWorkspaceIndex: next.length - 1 });
    useSavedWorkspaceLibrary.setState({
      entries: useSavedWorkspaceLibrary.getState().entries.filter((w) => w.id !== id),
    });
  } finally {
    isSyncing = false;
  }
  void pushEntry(opened);
}

/**
 * Closes a saved workspace's tab: removes it from the tab bar and marks it
 * closed so it disappears from the tab bar on the user's other devices too
 * — the workspace itself is not deleted, it moves into the saved library.
 * No-op (and logs) if `id` isn't currently an open, saved workspace — this
 * function must never be called for a non-saved workspace, whose close path
 * is the existing immediate-delete behavior in store.ts/App.tsx.
 */
export function closeSavedWorkspace(id: string): void {
  const workspaces = useWorkspace.getState().workspaces;
  const index = workspaces.findIndex((w) => w.id === id);
  const ws = workspaces[index];
  if (!ws || !ws.saved) {
    console.error(`Sync: closeSavedWorkspace(${id}) — not an open saved workspace`);
    return;
  }
  const closed: WorkspaceEntry = { ...ws, open: false, version: (ws.version ?? 0) + 1 };
  isSyncing = true;
  try {
    useWorkspace.getState().removeWorkspace(index); // reuses store.ts's tested index-clamping / empty-tab-bar fallback
    useSavedWorkspaceLibrary.setState({
      entries: [...useSavedWorkspaceLibrary.getState().entries, closed],
    });
  } finally {
    isSyncing = false;
  }
  void pushEntry(closed);
}

/**
 * Renames a saved workspace by id, whether it's currently open (in the tab
 * bar) or closed (in the saved library) — the Saved Workspaces menu doesn't
 * know or care which. An open workspace is renamed through the store's own
 * renameWorkspace action so the edit flows through the same generic
 * change-detection/autosave path every other tab-strip edit uses (no
 * explicit push here — mirrors setWorkspaceSaved from TASK-126.3). A closed
 * library entry isn't watched by that subscriber, so it's renamed in place
 * and pushed explicitly, the same shape as openSavedWorkspace/
 * closeSavedWorkspace above.
 */
export function renameSavedWorkspace(id: string, name: string): void {
  const openIndex = useWorkspace.getState().workspaces.findIndex((w) => w.id === id);
  if (openIndex !== -1) {
    useWorkspace.getState().renameWorkspace(openIndex, name);
    return;
  }
  const entry = useSavedWorkspaceLibrary.getState().entries.find((w) => w.id === id);
  if (!entry) {
    console.error(`Sync: renameSavedWorkspace(${id}) — not found`);
    return;
  }
  const renamed: WorkspaceEntry = { ...entry, name, version: (entry.version ?? 0) + 1 };
  useSavedWorkspaceLibrary.setState({
    entries: useSavedWorkspaceLibrary.getState().entries.map((w) => (w.id === id ? renamed : w)),
  });
  void pushEntry(renamed);
}

/**
 * Permanently deletes a saved workspace by id, whether open or closed —
 * unlike closeSavedWorkspace, this removes it for good and issues a
 * server-side delete. An open workspace reuses the store's plain
 * removeWorkspace with NO isSyncing guard (unlike closeSavedWorkspace) so
 * unsubStore's existing change-detection treats the missing id exactly like
 * closing a non-saved workspace's tab — same DELETE request, same
 * offline-queue/retry behavior, zero new delete logic. A closed library
 * entry has no such subscriber watching it, so it's removed from the
 * library here and the delete requested directly via the module-level
 * requestDelete.
 */
export function deleteSavedWorkspace(id: string): void {
  const openIndex = useWorkspace.getState().workspaces.findIndex((w) => w.id === id);
  if (openIndex !== -1) {
    useWorkspace.getState().removeWorkspace(openIndex);
    return;
  }
  const entry = useSavedWorkspaceLibrary.getState().entries.find((w) => w.id === id);
  if (!entry) {
    console.error(`Sync: deleteSavedWorkspace(${id}) — not found`);
    return;
  }
  useSavedWorkspaceLibrary.setState({
    entries: useSavedWorkspaceLibrary.getState().entries.filter((w) => w.id !== id),
  });
  void requestDelete(id);
}

// ---------------------------------------------------------------------------
// Sync engine initialization
// ---------------------------------------------------------------------------

const AUTOSAVE_DEBOUNCE_MS = 2_000; // 2 s — balance responsiveness vs. push frequency

export function initSync(): () => void {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function onLogin() {
    isSyncing = true;
    try {
      useAuth.getState().setSyncStatus("saving");
      await initEncryption(useAuth.getState().user!.id);
      // Use since=0 so the delta endpoint returns all rows (including
      // soft-deleted ones) — since=0 always matches the inclusive `>=`
      // filter, whereas the full-snapshot branch (no `since`) filters
      // deleted_at IS NULL, which would cause deleted workspaces to be
      // re-created locally.
      const { rows, cursor, skippedIds } = await pullWorkspaces(0);
      syncCursor = cursor;
      lastPullAttemptTs = Date.now();
      applyDecryptWarning(skippedIds);
      const local = useWorkspace.getState().workspaces;
      const merged = mergeWorkspaces(local, rows);
      const library = mergeSavedLibrary(useSavedWorkspaceLibrary.getState().entries, rows);
      useSavedWorkspaceLibrary.setState({ entries: library });

      // Push workspaces that exist locally but not on the server; adopt the
      // server row on success so local versions are authoritative from login.
      // Include skippedIds so we don't re-push workspaces that exist on the
      // server but failed to decrypt (wrong key) — pushing those would
      // clobber the valid server-side encrypted data.
      const remoteIds = new Set([...rows.map((r) => r.id), ...skippedIds]);
      const finalMerged = [...merged];
      for (let i = 0; i < finalMerged.length; i++) {
        const ws = finalMerged[i];
        if (ws.id && !remoteIds.has(ws.id)) {
          const bumped = { ...ws, version: ws.version ?? 1 };
          const result = await pushWorkspace(bumped);
          if (result) {
            finalMerged[i] = rowToEntry(result.row, ws);
          }
        }
      }

      // Guard against an empty result (all workspaces deleted remotely); clamp index.
      const safeMerged =
        finalMerged.length > 0 ? finalMerged : [makeDefaultWorkspace("Workspace 1")];
      const currIdx = useWorkspace.getState().activeWorkspaceIndex;
      const safeIdx = resolveActiveIndex(local, currIdx, safeMerged);
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

  // The Zustand store is the single source of truth for each workspace's
  // monotonic version counter — autoSave never trusts a version snapshot
  // passed in by a caller, only whatever is currently committed to the
  // store. It bumps that version synchronously (before the network request
  // is even sent) so two overlapping autoSave calls for the same workspace
  // (e.g. a fired-and-in-flight request plus a subsequent debounce firing)
  // can never compute the same "next" version: each bump is atomic against
  // the last committed store state. Without this, both calls would read the
  // same stale version, send equal version numbers, and the server (which
  // accepts version >= stored, not just >) would let the second push
  // silently clobber the first with no conflict signal.
  async function autoSave(id: string) {
    const ws = useWorkspace.getState().workspaces.find((w) => w.id === id);
    if (!ws) return; // deleted concurrently — nothing to save

    if (!navigator.onLine) {
      offlineQueue.set(id, ws);
      useAuth.getState().setSyncStatus("offline");
      return;
    }

    let bumped: WorkspaceEntry | undefined;
    isSyncing = true;
    try {
      const workspaces = useWorkspace.getState().workspaces.map((w) => {
        if (w.id !== id) return w;
        bumped = { ...w, version: (w.version ?? 0) + 1 };
        return bumped;
      });
      useWorkspace.setState({ workspaces });
    } finally {
      isSyncing = false;
    }
    if (!bumped) return; // deleted concurrently between lookup and bump

    await pushEntry(bumped);
  }

  async function flushOfflineQueue() {
    if (useAuth.getState().status !== "authed") return;
    // Deletes first: a queued delete should win over ever re-pushing a
    // since-deleted workspace (in practice the two queues are already
    // disjoint per id — see the unsubStore handler below).
    const deleteIds = Array.from(offlineDeleteQueue);
    offlineDeleteQueue.clear();
    for (const id of deleteIds) {
      await requestDelete(id);
    }
    const entries = Array.from(offlineQueue.values());
    offlineQueue.clear();
    for (const ws of entries) {
      // A queued entry for a workspace that's since been closed (removed
      // from the tab bar, not deleted — e.g. closeSavedWorkspace ran while
      // offline) has nothing fresher to re-read: autoSave's "deleted
      // concurrently" guard would silently drop it, since it can no longer
      // distinguish "closed" from "deleted" by absence alone. Push the
      // queued snapshot directly instead.
      const stillOpen = useWorkspace.getState().workspaces.some((w) => w.id === ws.id);
      if (stillOpen) {
        // Re-reads live content — preserves the existing "flush pushes
        // latest, not stale snapshot" guarantee.
        await autoSave(ws.id!);
      } else {
        await pushEntry(ws); // the queued snapshot IS the final state
      }
    }
  }

  // Subscribe to auth state changes — trigger pull-on-login.
  const unsubAuth = useAuth.subscribe((auth, prevAuth) => {
    if (auth.status === "authed" && prevAuth.status !== "authed") {
      void onLogin();
    } else if (auth.status !== "authed" && prevAuth.status === "authed") {
      // Saved-workspace names/content must not leak across an account switch
      // on a shared device — mirrors how logout() in auth.ts already clears
      // decryptWarning and the cached encryption key.
      useSavedWorkspaceLibrary.setState({ entries: [] });
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
        void requestDelete(ws.id);
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
            // autoSave re-reads the current store entry itself, so it always
            // sees the latest content/version, not a snapshot captured when
            // the timer was last (re)set.
            void autoSave(id);
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
