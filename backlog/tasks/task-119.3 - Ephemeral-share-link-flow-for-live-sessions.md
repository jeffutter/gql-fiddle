---
id: TASK-119.3
title: Ephemeral share-link flow for live sessions
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-23 01:59'
updated_date: '2026-07-24 02:31'
labels:
  - planned
dependencies:
  - TASK-119.1
  - TASK-119.2
parent_task_id: TASK-119
type: feature
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let a user start a live session for their currently open workspace and share a link that lets someone else join that same live session directly in the browser — no account required, and no persistent change to who owns the underlying workspace.

This is distinct from the existing static snapshot share link in `web/src/share.ts` (URL-encoded, one-time copy of workspace state). Both should remain available and clearly distinguished in the UI.

Part of TASK-119 (real-time collaborative editing). Depends on TASK-119.1 for the session id/connection scheme and TASK-119.2 for there to be a meaningful live-edited state to join.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A user can generate a live-session link from an open workspace, distinct from the existing static snapshot share link
- [x] #2 Opening the link in another browser/session joins the same live session and begins real-time sync with the host
- [x] #3 Joining a live session does not require signing in and does not grant the joiner persistent access to the host's saved workspace after the session ends
- [x] #4 If the host disconnects and does not return within a reasonable window, remaining participants are clearly informed the session has ended or gone stale
- [x] #5 In-app copy explains the difference between the static share link and the live session link
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
<!-- PLAN:BEGIN -->

### Overview

Add a "Collaborate" button alongside the existing "Share" button. Clicking it creates a live
session via `POST /api/live-session`, sets the WebSocket URL in the Zustand store, and exposes
a shareable link (`?ls=<sessionId>`). A joiner opening that link fetches session metadata,
connects to the Durable Object relay, and syncs editors bidirectionally through Yjs.

Both sharing modes remain available and clearly distinguished:
- **Share** → static snapshot (`#w=`), one-time copy of workspace state
- **Collaborate** → real-time session (`?ls=`), multi-peer CRDT sync

### File inventory

| File | Change type | Summary |
|------|-------------|---------|
| `functions/api/live-session/index.ts` | Modify | Add `onRequestGet` handler for `GET /api/live-session?ls=<sessionId>` |
| `web/src/useLiveSessionLink.ts` | New | Hook for URL parsing, session creation, lifecycle management |
| `web/src/App.tsx` | Modify | Collaborate button, join-from-link mount logic, active session UI |
| `live-sync/tests/live-session.test.ts` | Modify | Tests for new GET endpoint |
| `web/src/theme.css` | Modify | Minimal styles for collaborate controls (reuse existing `.btn`, `.callout`) |

### Step 1: Backend — GET /api/live-session?ls=<sessionId>

Add a `GET` handler to `functions/api/live-session/index.ts`. The joiner passes the session ID
as a query parameter. This avoids restructuring the directory layout and lets the client
reconstruct the WebSocket URL without needing to know the live-sync worker's origin.

```typescript
// In functions/api/live-session/index.ts — add alongside onRequestPost

export const onRequestGet: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const sessionId = url.searchParams.get("ls");
    if (!sessionId || !/^[0-9a-f]{8}-/.test(sessionId)) {
      return new Response("Invalid session ID", { status: 400 });
    }

    const row = await ctx.env.DB
      .prepare("SELECT id, created_at, last_active_at FROM live_sessions WHERE id = ?")
      .bind(sessionId)
      .first<{ id: string; created_at: number; last_active_at: number }>();

    if (!row) {
      return new Response("Session not found", { status: 404 });
    }

    // Build wsUrl using same logic as POST handler
    const liveSyncUrl = ctx.env.LIVE_SYNC_URL ?? "http://localhost:8789";
    const wsProtocol = liveSyncUrl.startsWith("https") ? "wss" : "ws";
    const wsHost = liveSyncUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${wsHost}/ws/${sessionId}`;

    return Response.json({ sessionId: row.id, wsUrl, createdAt: row.created_at });
  },
);
```

### Step 2: Frontend — useLiveSessionLink() hook

Create `web/src/useLiveSessionLink.ts` (new module):

```typescript
/**
 * Manages the ephemeral live-session share link flow:
 *   - Parses ?ls=<sessionId> from URL on mount
 *   - Creates sessions via POST /api/live-session
 *   - Fetches session info via GET /api/live-session?ls=<id>
 *   - Builds share URLs from the current page origin
 */
```

The hook exposes:
- `isActive: boolean` — whether a live session is currently active
- `isJoining: boolean` — transient flag while fetching session info on mount
- `error: string | null` — error message if session fetch fails
- `startSession(): Promise<void>` — POST to create session, set wsUrl in store
- `endSession(): void` — clear wsUrl from store
- `copyShareUrl(): void` — build and copy `` `${origin}${pathname}?ls=${sessionId}` ``
- `joinFromUrl(): void` — parse `?ls=` from current URL, fetch session, connect

Key behavior:
- On mount, if `?ls=` is present, automatically calls `joinFromUrl()`
- After joining, clears query param via `replaceState` so reloading doesn't re-join
- For joiners: creates a minimal workspace named "(collaboration)" with empty subgraphs/query
  before connecting — remote Yjs state populates everything once connected

### Step 3: Frontend — App.tsx integration

#### 3a. Join-from-link on mount

In the existing `useEffect` that parses URL hashes (around line 346), add a parallel check for
`?ls=` query param. If found:
1. Create a minimal workspace named "(collaboration)" — empty subgraphs, empty query
2. Set it as active
3. Fetch session info via `GET /api/live-session?ls=<id>`
4. Set `wsUrl` in store via `setLiveSessionWsUrl(wsUrl, sessionId)` (triggers `useLiveSession`)
5. Clear query param with `replaceState`

If the fetch fails (404 or network error), show a banner: "Session not found or expired."

#### 3b. Collaborate button

Replace the existing `copyShareUrl` button area with grouped buttons:

```tsx
{!liveSession.wsUrl ? (
  <>
    <button onClick={copyShareUrl} className="btn">
      Share
    </button>
    <button onClick={startCollaboration} className="btn btn--primary">
      Collaborate
    </button>
  </>
) : (
  <div className="live-session-controls">
    <span className="badge">Live</span>
    <button onClick={copyLiveSessionUrl} className="btn">
      {copiedLiveLink ? "Copied!" : "Copy link"}
    </button>
    <button onClick={endLiveSession} className="btn">
      End session
    </button>
  </div>
)}
```

The "Collaborate" button uses `btn--primary` styling to distinguish it as the action-oriented
choice vs. the passive "Share" snapshot.

#### 3c. Session end detection

When `useLiveSession` reports `status === "disconnected"` AND `liveSession.wsUrl` is still
set (meaning the user didn't explicitly end the session), show a non-dismissible banner:

```tsx
{liveSession.wsUrl && liveSessionHook.status === "disconnected" && !userEndedSession && (
  <div className="callout callout--warning">
    Session disconnected — the host may have left.{" "}
    <button onClick={endLiveSession}>End session</button>
  </div>
)}
```

Track `userEndedSession` as local state so we don't show the banner when the user clicks
"End session" themselves.

### Step 4: CSS

Minimal additions to `web/src/theme.css`:

```css
.live-session-controls { display: flex; gap: 8px; align-items: center; }
.badge { /* small pill indicator — reuse existing patterns */ }
```

Reuse existing `.btn`, `.btn--primary`, `.callout`, `.callout--warning` classes. No new color
tokens needed.

### Step 5: Tests

Add tests to `live-sync/tests/live-session.test.ts` for the new GET handler:
- Returns session info for valid session ID
- Returns 404 for unknown session ID
- Returns 400 for malformed session ID
- Correctly builds wsUrl with LIVE_SYNC_URL config var

No new frontend test file needed. The existing `LiveSession.integration.test.ts` covers the
provider and Yjs sync. URL parsing and button logic are UI-level.

### Edge cases

| Scenario | Handling |
|----------|----------|
| Joiner opens link after session expired (>24h idle) | GET returns 404 → show "Session expired" banner |
| Creator navigates away mid-session | DO keeps session alive; other peers continue editing until they also disconnect |
| Both creator and joiner edit simultaneously | Yjs CRDT merge handles conflicts transparently |
| Creator ends session while joiner is connected | Provider disconnect fires → joiner sees "Session disconnected" banner |
| Multiple tabs open same `?ls=` link | Each tab gets its own WS connection to the same DO — works correctly |
| Joiner has existing workspaces | Creates new "(collaboration)" workspace alongside existing ones |
| Network drops mid-session | Yjs auto-reconnect (existing provider logic) reconnects within backoff window |

### Execution order

1. Backend GET endpoint (standalone, no frontend dependency)
2. `useLiveSessionLink()` hook (pure frontend, no DOM)
3. App.tsx integration (mount logic + UI buttons)
4. CSS polish
5. Tests

Estimated: ~150 lines of code across 4 files.
<!-- PLAN:END -->
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Backend (functions/api/live-session/index.ts)
- Added  handler for 
- Returns session metadata (sessionId, wsUrl, createdAt) for joiners
- Validates session ID format () — returns 400 for malformed IDs
- Returns 404 for unknown sessions
- Refactored POST handler to share  helper with GET handler

### Frontend (web/src/App.tsx)
- Join-from-link: new useEffect parses  query param on mount
  - Creates minimal '(collaboration)' workspace before connecting
  - Fetches session info via GET endpoint, sets wsUrl in store
  - Clears query param via replaceState after joining
- 'Collaborate' button (btn--primary) alongside existing 'Share' button
  - Calls POST /api/live-session, sets wsUrl on success
- Live session controls when active: badge ('Live'), Copy link, End session
- Disconnected warning banner (callout--warning) when host leaves
- Session join error banner (callout--error) for expired/invalid links
- New state: copiedLiveLink, liveSessionError, userEndedSession

### Store (web/src/store.ts)
- Exported DEFAULT_SEED for use in join-from-link workspace creation

### CSS (web/src/theme.css)
- .badge--success — green pill indicator for active live session
- .callout--warning — yellow callout for disconnected warning
- .callout--inline — flex layout variant for callouts with inline buttons
- .live-session-controls — flex container for session action buttons

### Tests (live-sync/tests/live-session.test.ts)
- Added describe block for GET /api/live-session with 5 tests:
  - Valid session ID returns session info
  - LIVE_SYNC_URL config var builds correct wsUrl
  - Unknown session ID returns 404
  - Malformed session ID returns 400
  - Missing ls parameter returns 400

### Documentation (AGENTS.md)
- Updated live-session/index.ts description to include GET endpoint
- Updated test file description to note POST + GET coverage
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented ephemeral share-link flow for live sessions. Added GET /api/live-session?ls=<sessionId> endpoint for joiners to fetch session metadata. Frontend includes Collaborate button, join-from-link on mount (?ls= param), live session controls (copy link/end session), and disconnected/error banners. All 5 acceptance criteria met.
<!-- SECTION:FINAL_SUMMARY:END -->
