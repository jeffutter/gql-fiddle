---
id: TASK-121
title: 'Fix: remove dead duplicate /api/sessions routes in live-sync worker'
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-23 06:06'
updated_date: '2026-07-23 20:36'
labels:
  - review-followup
dependencies:
  - TASK-119.1
priority: high
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-119.1 (live-sync/src/index.ts:39-51, handleCreateSession/handleGetSession). This worker exposes its own POST /api/sessions and GET /api/sessions/:id routes that duplicate the session-creation logic already owned by functions/api/live-session/index.ts (the Pages Function the client is actually meant to call per the commit message and wrangler.jsonc's LIVE_SYNC_URL comment). Nothing in the repo calls /api/sessions (grep confirms zero references outside index.ts's own route table and its doc comment) — it's dead code. Worse, the two implementations diverge: the worker does a plain INSERT (throws on session-id collision), while the Pages Function uses INSERT OR IGNORE (idempotent, matching its own test's stated intent). Two independent, inconsistent implementations of 'create a live session' is exactly the information-leakage/duplication CLAUDE.md's design philosophy calls out — a future ticket (TASK-119.2/119.3, client wiring) could easily call the wrong one. Axis: Concise/Organized.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 live-sync/src/index.ts no longer defines /api/sessions (POST) or /api/sessions/:id (GET) routes, or the handleCreateSession/handleGetSession functions that back them
- [x] #2 live-sync/src/index.ts's remaining routes are /health and /ws/:sessionId only, matching what functions/api/live-session/index.ts + the /ws/:sessionId path actually need
- [x] #3 the module comment block at the top of live-sync/src/index.ts is updated to remove the now-deleted routes from its documented route list
- [x] #4 nix develop -c pnpm --dir live-sync test run passes with no reference to the removed handlers
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions. This ticket is scoped to live-sync/ (a standalone Cloudflare Worker), run pnpm through 'nix develop -c'.

1. Open live-sync/src/index.ts. Confirm (re-grep) that /api/sessions and /api/sessions/:id are not referenced anywhere else in the repo (web/, functions/, live-sync/tests/) before deleting — run: grep -rn 'api/sessions' --include='*.ts' --include='*.tsx' . from the repo root, excluding node_modules. If a caller has appeared since this ticket was written, stop and re-scope the ticket instead of deleting a now-used route.
2. Delete the 'POST /api/sessions — create a new session' block (the 'if (path === "/api/sessions" && request.method === "POST")' branch) and the 'GET /api/sessions/:id' block (the 'if (path.startsWith("/api/sessions/"))' branch) from the exported fetch handler.
3. Delete the now-unused handleCreateSession and handleGetSession functions entirely, along with the getOrigin helper if it is not used elsewhere in the file after their removal (check with grep before deleting getOrigin specifically).
4. Update the file's top-of-file route-list comment (lines ~1-10) to remove the deleted routes, leaving only /ws/:sessionId and /health documented.
5. Run: nix develop -c pnpm --dir live-sync exec tsc --noEmit to confirm no dangling references.
6. Run: nix develop -c pnpm --dir live-sync test run to confirm the existing test suite (which never exercised these dead routes) still passes unchanged.
7. Run: nix develop -c pnpm --dir live-sync lint (or the equivalent lint script in live-sync/package.json) if one exists, to catch unused imports left behind by the deletion.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed dead POST /api/sessions and GET /api/sessions/:id routes from live-sync/src/index.ts, along with handleCreateSession, handleGetSession, and getOrigin functions. These duplicated session management already owned by functions/api/live-session/index.ts (the Pages Function). Updated module doc comment to reflect the two remaining routes (/health, /ws/:sessionId). TypeScript check passes clean, all 18 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted 80 lines of dead code from live-sync/src/index.ts: removed POST /api/sessions and GET /api/sessions/:id routes plus their backing handlers (handleCreateSession, handleGetSession, getOrigin). These duplicated session CRUD already owned by the Pages Function at functions/api/live-session/index.ts, with divergent implementations (plain INSERT vs INSERT OR IGNORE). The worker now only serves /health and /ws/:sessionId routes as intended.
<!-- SECTION:FINAL_SUMMARY:END -->
