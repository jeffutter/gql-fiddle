---
id: TASK-101
title: Add auth/data-access audit logging and generic error handling
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:27'
updated_date: '2026-07-01 23:58'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-LOG-1.00, SEC-ERR-1.00, SEC-DAT-1.00. functions/ has zero structured logging for security events (login success/failure, session mint, logout, state-validation failures, cross-user 404s, wrapped-DEK writes) and no top-level error handling — unhandled D1 errors/throws (db.ts:64,141 include ids in messages) can surface as default Workers 500 pages leaking internals; error shapes are inconsistent (plain-text OAuth vs JSON {error} elsewhere). Fix: emit structured JSON logs for auth/permission/DEK-write events (user_id only, never tokens/payloads/KWK/wrapped_dek), add a shared try/catch wrapper returning a generic {error:'Internal error'} 500, and standardize the JSON error shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 auth events emit structured logs containing no tokens, payloads, KWK, or wrapped_dek
- [x] #2 unexpected errors return a generic 500 without internal detail
- [x] #3 error responses use one consistent JSON shape across endpoints
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP: Cloudflare Pages Functions backend (functions/). This ticket is BACKEND-ONLY: functions/_lib/, functions/api/**, functions/__tests__/. No Rust/WASM or web/ UI changes. Single PR, no sub-tickets — every endpoint needs the same two shared primitives, so splitting would only fragment one cohesive change across artificial boundaries.

CONTEXT (verified against current code):
- functions/_lib/db.ts:64 and :141 throw `Error` messages that embed github_id/user_id — currently unhandled, so they'd surface as Cloudflare's default 500 HTML page (leaking the message) if they ever fire.
- Error shapes are inconsistent: functions/api/auth/github.ts and functions/api/auth/github/callback.ts return `new Response("<plain text>", {status})`; every other endpoint (workspaces/*, enc-meta.ts, auth/*.ts via requireUser) returns `Response.json({ error: "..." })`.
- Zero logging anywhere in functions/ today (`grep -rn "console\." functions/` is empty) — no visibility into login success/failure, session mint, logout, state-validation failures, cross-user 404s, or wrapped-DEK writes.
- No eslint `no-console` rule applies to functions/ (web/eslint.config.js doesn't reference functions/), so console.log/console.error are safe to use as the log sink (Workers runtime forwards console output to `wrangler pages dev`/tail logs).

STEP 1 — functions/_lib/log.ts (new file):
- Export `logEvent(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void`.
- Implementation: build `{ level: "info", event, ...fields, ts: new Date().toISOString() }`, then **redact by key** before serializing — for any field key matching `/token|secret|kwk|wrapped_dek|payload|code|password/i`, replace the value with `"[redacted]"` regardless of what the caller passed. This is defense-in-depth: it makes AC #1 hold even if a future call site accidentally passes a forbidden field, rather than relying on every call site to remember by convention (the module owns the redaction policy, not each caller).
- `console.log(JSON.stringify(record))` — one line of structured JSON per event, matching Workers' log aggregation expectations.
- This is the ONLY function that touches console output for security-relevant events; keep it small and single-purpose (no log levels/transports needed — YAGNI for a single Workers deployment).

STEP 2 — functions/_lib/http.ts (new file):
- Export `jsonError(message: string, status: number): Response` → `Response.json({ error: message }, { status })`. This becomes the ONE way error responses are built; replaces ad-hoc `Response.json({error:...}, {status:...})` call sites and the plain-text `new Response(...)` call sites in github.ts/callback.ts.
- Export `withErrorHandling<Env>(handler: PagesFunction<Env>): PagesFunction<Env>` — wraps a handler, `try { return await handler(context) } catch (err) { ... }`. On catch: call `logEvent("unhandled_error", { path: new URL(context.request.url).pathname, message: err instanceof Error ? err.message : String(err) })` (full detail goes to the server-side log only — never returned to the client), then `return jsonError("Internal error", 500)`.
- This single wrapper is what turns "unhandled D1 errors surface as default Workers 500 pages" into "always a generic JSON 500" — apply it at every handler's export boundary (see Step 3).

STEP 3 — wire into every handler (apply `withErrorHandling` to each exported `onRequestGet`/`onRequestPost`/`onRequestPut`/`onRequestDelete`, and replace ad-hoc error Responses with `jsonError`):

- functions/api/health.ts: wrap (cheap, keeps the pattern universal across api/ — no other changes needed, it has no error path today).
- functions/api/auth/login.ts: wrap (no throwing code today, but consistent).
- functions/api/auth/github.ts: wrap; replace the `APP_ORIGIN` misconfigured plain-text 500 with `jsonError("Server misconfigured", 500)`.
- functions/api/auth/github/callback.ts: wrap; replace all four plain-text Responses (missing code/state 400, invalid/expired state 400, token-exchange-failed 400, profile-fetch-failed 502) with `jsonError(...)`. Add logging:
  - after `verifyState` returns false → `logEvent("auth.state_invalid", { reason: "missing_or_expired" })` before returning the 400.
  - after token exchange fails or profile fetch fails → `logEvent("auth.login_failure", { reason: "token_exchange_failed" | "profile_fetch_failed" })`.
  - after `mintSession` succeeds (right before building the redirect Response) → `logEvent("auth.login_success", { user_id: user.id, provider: "github" })`. This single event covers both "login success" and "session mint" from the AC — they happen atomically in this handler, so two separate events would be redundant.
- functions/api/auth/dev-login.ts: wrap; after `mintSession` → `logEvent("auth.login_success", { user_id: user.id, provider: "dev" })`.
- functions/api/auth/logout.ts: wrap. Currently deletes the session by token without knowing whose it was. Change to: look up the session via `getSession(kv, token)` BEFORE calling `deleteSession`, so the user_id is available; if a session was found, `logEvent("auth.logout", { user_id: session.user_id })`. If there was no cookie/token or no matching session, skip logging (nothing to attribute) — still return 204 either way (unchanged behavior).
- functions/api/auth/me.ts: wrap only (requireUser already returns a JSON 401; no new logging needed here — login/logout events are logged at their own endpoints, not on every `/me` poll).
- functions/api/auth/enc-meta.ts: wrap both onRequestGet and onRequestPut. In onRequestPut, after `setWrappedDekIfAbsent` succeeds → `logEvent("data.dek_write", { user_id: user.id })` (user_id only — never the wrapped_dek value itself, which log.ts's redaction would strip anyway as defense-in-depth).
- functions/api/workspaces/index.ts: wrap onRequestGet.
- functions/api/workspaces/[id].ts: wrap onRequestPut and onRequestDelete.
  - onRequestPut: the existing explicit ownership check (`existing.user_id !== user.id`) is the one place we can definitively distinguish "belongs to another user" from "truly missing" — log `logEvent("data.cross_user_denied", { user_id: user.id, workspace_id: id })` there before returning the 404, and also when `upsertWorkspace` returns `{accepted:false, row:null}` (the ON CONFLICT cross-user-guard path documented in db.ts's upsertWorkspace comment).
  - onRequestDelete: `softDeleteWorkspace` returning false is ambiguous (genuinely missing id vs. another user's id — it doesn't tell you which). Log a broader `logEvent("data.workspace_not_found", { user_id: user.id, workspace_id: id })` in that branch rather than over-claiming it's always cross-user; note this in a code comment so a future reader doesn't assume every one of these events is a cross-user attempt.
- functions/_lib/auth.ts's `requireUser` itself: no change — it already returns structured 401 JSON on every failure path and isn't itself an exported handler, so `withErrorHandling` at the handler level already covers any D1 error it might throw.

STEP 4 — tests (functions/__tests__/, run via `cd web && pnpm test:functions`):
- New functions/__tests__/log.test.ts: verify `logEvent` emits valid JSON via `console.log` (spy with `vi.spyOn(console, "log")`), includes `event`/`ts`, and — critically — redacts fields whose keys match the denylist (e.g. pass `{ token: "abc", wrapped_dek: "xyz", kwk: "k", payload: "p", user_id: "u1" }` and assert the emitted JSON contains `"[redacted]"` for the first four keys and the real value for `user_id`).
- New functions/__tests__/http.test.ts: verify `jsonError` shape, and `withErrorHandling` — a handler that throws returns a JSON 500 `{ error: "Internal error" }` with no trace of the original message in the body, while the original message is still passed to `logEvent` (spy on the log module, or on console.log).
- Update functions/__tests__/auth.test.ts (or add to dev-auth.test.ts): assert dev-login and github/callback handlers still work end-to-end and now emit `auth.login_success` (spy console.log, parse JSON lines, assert one contains `event: "auth.login_success"` and the right user_id, and confirm no line contains a session token or the GitHub access token string).
- Update functions/__tests__/workspaces.test.ts: add a case hitting PUT /api/workspaces/:id with an id owned by a different user and assert both the existing 404 behavior AND a `data.cross_user_denied` log line (spy console.log).
- Update functions/__tests__/enc-meta.test.ts: assert PUT emits `data.dek_write` with `user_id` and that no log line ever contains the literal wrapped_dek value used in the test.
- All existing tests must keep passing unmodified in intent — this is additive logging/wrapping, not a behavior change to success-path response bodies (error response bodies for the OAuth plain-text endpoints DO change shape from plain text to JSON — update any assertions in existing tests that check `.text()` on those specific 400/500/502 paths to check `.json()` -> `{error}` instead).

VERIFICATION:
- `web/node_modules/.bin/tsc --project functions/tsconfig.json --noEmit`
- `web/node_modules/.bin/tsc --project functions/__tests__/tsconfig.json --noEmit`
- `cd web && pnpm test:functions`
- Manually grep the final diff for any `console.log`/`logEvent` call sites that pass `token`, `access_token`, `kwk`, or `wrapped_dek` as literal field values, to confirm reliance on redaction is a backstop, not the primary control — call sites should already be passing only `user_id`/`reason`/`path`/`workspace_id`.
- Confirm AC #3 (one consistent JSON error shape): `grep -rn "new Response(" functions/api/` should show no remaining plain-text error bodies outside the 204/302/redirect-with-no-body cases (logout 204, OAuth 302 redirects, workspaces DELETE 204 — these have no body and are fine as-is).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added functions/_lib/log.ts (logEvent: structured JSON via console.log, with
key-based redaction of token/secret/kwk/wrapped_dek/payload/code/password as a
defense-in-depth backstop) and functions/_lib/http.ts (jsonError for the one
consistent {error} JSON shape; withErrorHandling wraps a PagesFunction so any
thrown error is logged server-side with full detail and returns a generic
{error:"Internal error"} 500 to the client).

Wrapped every exported handler in functions/api/** with withErrorHandling, and
replaced all ad-hoc error Responses (including the plain-text ones in
github.ts / github/callback.ts / dev-login.ts's 404) with jsonError so
AC #3 holds project-wide. Added logging at: auth.state_invalid,
auth.login_failure (token_exchange_failed / profile_fetch_failed),
auth.login_success (github + dev-login), auth.logout (looks up the session
before deleting it so user_id is known), data.dek_write, data.cross_user_denied
(both ownership-check and ON CONFLICT-guard paths in workspaces PUT), and
data.workspace_not_found (ambiguous case in workspaces DELETE).

Added functions/__tests__/log.test.ts and functions/__tests__/http.test.ts
(new), and extended dev-auth.test.ts (dev-login + a new github/callback
describe block with a stubbed fetch), enc-meta.test.ts, and workspaces.test.ts
to assert the new log events fire with only identifiers (user_id/workspace_id)
and never contain tokens/wrapped_dek literals. All 72 functions tests pass;
both functions tsconfig and functions/__tests__ tsconfig type-check clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added shared functions/_lib/log.ts (redacting structured JSON logger) and
functions/_lib/http.ts (jsonError + withErrorHandling), wired them into every
functions/api/** handler, and standardized all error responses on the
{error: string} JSON shape (replacing the plain-text OAuth/dev-login
responses). Emits structured logs for auth state validation, login
success/failure, logout, DEK writes, and cross-user/not-found data access —
containing only identifiers, never tokens/payloads/KWK/wrapped_dek. Added
new tests (log.test.ts, http.test.ts) and extended existing suites to verify
the new events and redaction; all 72 functions tests pass and both
functions/functions-tests tsconfigs type-check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
