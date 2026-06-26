---
id: TASK-88.3
title: 'backend: GitHub OAuth login + KV-backed sessions'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:12'
updated_date: '2026-06-26 22:59'
labels:
  - backend
  - auth
  - cloudflare
  - planned
dependencies:
  - TASK-88.1
  - TASK-88.2
parent_task_id: TASK-88
priority: high
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Accounts are the entry point for cloud storage (parent TASK-88). Developers are the audience, so GitHub OAuth is the lowest-friction, zero-cost identity provider. Sessions are stored in KV so no third-party auth SaaS is needed.

## Depends on

- TASK-88.1 — Functions environment + KV binding (`SESSIONS`).
- TASK-88.2 — `users` table + data-access helpers (to create/fetch the user on first login).

## Scope

Implement the OAuth Authorization Code flow as Pages Functions:

- `GET /api/auth/github` — generate a `state`, store it briefly (KV or signed cookie), redirect to GitHub's authorize URL with the configured `client_id` and `redirect_uri`.
- `GET /api/auth/github/callback` — validate `state`, exchange `code` for an access token, fetch the GitHub user (`/user`), upsert into `users` (by `github_id`), mint an **opaque session token** stored in KV (`SESSIONS`: token → {user_id, created_at}, with TTL), set it as an **HttpOnly, Secure, SameSite=Lax** cookie, then redirect back to the app root.
- `GET /api/auth/me` — return the current user (or 401) based on the session cookie. Used by the frontend to determine login state.
- `POST /api/auth/logout` — delete the session from KV and clear the cookie.
- An **auth helper** (e.g. `functions/_lib/auth.ts`) exposing `requireUser(request, env)` → user or 401, reused by the workspace API.

## Configuration / secrets

- GitHub OAuth App `client_id` + `client_secret` provided as Pages environment secrets (document creation of the OAuth App and the callback URL; never commit secrets).
- Session cookie: HttpOnly, Secure, SameSite=Lax, reasonable expiry (e.g. 30 days) with sliding or fixed TTL — document the choice.

## Security notes

- Validate `state` to prevent CSRF on the callback.
- Store only an opaque token client-side; the GitHub access token is used server-side once to fetch the profile and is not persisted unless a specific later need arises (it is not needed for this feature — discard it).

## Tests & docs

- Unit-test the helper logic (state validation, session lookup, `requireUser` 401 path) with the GitHub HTTP calls mocked.
- Document the OAuth App setup, required secrets, and the callback URL in AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Visiting /api/auth/github redirects to GitHub and a successful callback creates/updates a users row and sets an HttpOnly Secure SameSite=Lax session cookie
- [x] #2 Session tokens are opaque and stored in KV with a TTL; the GitHub access token is not persisted
- [x] #3 GET /api/auth/me returns the logged-in user or 401 when unauthenticated
- [x] #4 POST /api/auth/logout invalidates the session in KV and clears the cookie
- [x] #5 OAuth state is validated on callback to prevent CSRF
- [x] #6 requireUser helper returns 401 for missing/invalid sessions and is reusable by other endpoints
- [x] #7 Tests cover state validation, session lookup, and the 401 path with GitHub calls mocked; AGENTS.md documents OAuth App setup and secrets
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

All auth work ships as a single session — the helper, four endpoints, and tests form a unit that cannot work independently. No sub-tickets.

## File Structure to Create

```
functions/
  api/
    auth/
      github.ts          GET /api/auth/github — generate state, redirect to GitHub
      callback.ts        GET /api/auth/github/callback — validate state, exchange code, mint session
      me.ts              GET /api/auth/me — return current user or 401
      logout.ts          POST /api/auth/logout — delete session from KV, clear cookie
  _lib/
    auth.ts              All auth primitives: state, session, requireUser, cookie helpers
  __tests__/
    auth.test.ts         Unit tests for auth.ts (KV mock, D1 mock from TASK-88.2)
AGENTS.md               Add Auth subsection (OAuth App setup, secrets, cookie design)
```

## Step 1 — Create `functions/_lib/auth.ts`

This module owns all auth primitives. Endpoints import from here and stay thin.

### Types

```ts
export interface SessionData {
  user_id: string;
  created_at: number;
}
```

### Constants and cookie helpers

```ts
export const SESSION_COOKIE_NAME = "__session";

export function sessionCookieHeader(token: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}

export function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(";").map(s => s.trim().split("=").map(p => decodeURIComponent(p.trim())))
      .filter(([k]) => k).map(([k, ...v]) => [k, v.join("=")])
  );
}
```

### State functions (CSRF prevention)

```ts
// Stores `state:<token>=1` in KV with 10-minute TTL.
export async function generateState(kv: KVNamespace): Promise<string>

// Verifies and deletes the state token (one-time use). Returns false if missing/expired.
export async function verifyState(kv: KVNamespace, state: string): Promise<boolean>
```

Key prefix: `state:` (avoids collision with session tokens in the same KV namespace).

### Session functions

```ts
// Mints an opaque session token, stores `session:<token>=JSON` with 30-day TTL.
export async function mintSession(kv: KVNamespace, userId: string): Promise<string>

// Returns SessionData for a valid token, or null for missing/expired.
export async function getSession(kv: KVNamespace, token: string): Promise<SessionData | null>

// Deletes session from KV.
export async function deleteSession(kv: KVNamespace, token: string): Promise<void>
```

Session TTL is **fixed 30 days** (no sliding renewal). Document this choice in AGENTS.md.

### requireUser helper

```ts
export async function requireUser(
  request: Request,
  kv: KVNamespace,
  db: D1Database
): Promise<UserRow | Response>
```

Logic:
1. Parse `Cookie` header with `parseCookies`
2. If `SESSION_COOKIE_NAME` not present → `Response.json({ error: "Unauthorized" }, { status: 401 })`
3. `getSession(kv, token)` — if null → 401
4. `db.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first<UserRow>()` — if null → 401
5. Return the `UserRow`

Import `UserRow` from `../_lib/db`.

## Step 2 — Create Endpoint Files

All endpoints share the same `Env` interface (defined once at the top of each file — no shared Env type to keep endpoint files standalone and consistent with `health.ts`):

```ts
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}
```

### `functions/api/auth/github.ts`

```ts
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const state = await generateState(env.SESSIONS);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL("/api/auth/github/callback", request.url).toString(),
    scope: "read:user",
    state,
  });
  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params}`, 302
  );
};
```

### `functions/api/auth/callback.ts`

Steps on success:
1. Read `code` and `state` from URL search params
2. If `state` missing or `verifyState(env.SESSIONS, state)` returns false → `400 Bad Request`
3. POST to `https://github.com/login/oauth/access_token` with `client_id`, `client_secret`, `code` (Accept: `application/json`)
4. If error in response → `400` (bad code)
5. GET `https://api.github.com/user` with `Authorization: Bearer <access_token>` and `User-Agent: gql-fiddle`
6. Map response to `GithubProfile` (import from `../_lib/db`)
7. `getOrCreateUser(env.DB, profile)` (import from `../_lib/db`)
8. `mintSession(env.SESSIONS, user.id)` — 30 days
9. Return `Response.redirect("/", 302)` with `Set-Cookie: sessionCookieHeader(token, 30 * 24 * 60 * 60)`

**The GitHub access token is not persisted.** Use it only for step 5, then discard.

### `functions/api/auth/me.ts`

```ts
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireUser(context.request, context.env.SESSIONS, context.env.DB);
  if (result instanceof Response) return result;
  return Response.json({ user: result });
};
```

### `functions/api/auth/logout.ts`

```ts
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const cookies = parseCookies(context.request.headers.get("Cookie") ?? "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) await deleteSession(context.env.SESSIONS, token);
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookieHeader() },
  });
};
```

## Step 3 — Create `functions/__tests__/auth.test.ts`

Tests focus on `auth.ts` logic only. The endpoint wiring (GitHub HTTP calls) is tested via mocked fetches in a subset of tests for the callback logic.

**KV mock** — a `Map<string, {value: string, expiry?: number}>` that implements `put`, `get`, `delete`. Implement inline in the test file (it's small).

**Test cases:**

1. `generateState` — stores a key under `state:` prefix, returns a non-empty string
2. `verifyState(valid)` — returns true for a key in KV; key is deleted after verification
3. `verifyState(invalid)` — returns false for an unknown key
4. `mintSession` — stores session JSON under `session:` prefix, returns a non-empty token
5. `getSession(valid)` — returns `SessionData` with correct `user_id`
6. `getSession(invalid)` — returns null for unknown token
7. `requireUser (no cookie)` — returns a Response with status 401
8. `requireUser (invalid session)` — returns 401 when token not found in KV
9. `requireUser (valid)` — returns `UserRow` when session is valid and user exists in D1

For test 9: use `createD1Mock(migrationSql)` (from `d1-mock.ts`) + `getOrCreateUser` to seed a user, then test `requireUser`.

**parseCookies:**
10. Parses a multi-value Cookie header correctly

## Step 4 — Update AGENTS.md

Under "Backend", add a "### Auth (GitHub OAuth)" subsection covering:

- **OAuth App setup**: GitHub → Settings → Developer settings → OAuth Apps → New
  - Homepage URL: `https://<project>.pages.dev`
  - Callback URL: `https://<project>.pages.dev/api/auth/github/callback`
  - For local dev: add `http://localhost:8788/api/auth/github/callback`
- **Required secrets** (never commit):
  ```sh
  wrangler pages secret put GITHUB_CLIENT_ID
  wrangler pages secret put GITHUB_CLIENT_SECRET
  ```
  For local dev, add to `.dev.vars` (gitignored):
  ```
  GITHUB_CLIENT_ID=<your_client_id>
  GITHUB_CLIENT_SECRET=<your_client_secret>
  ```
- **Session design**: opaque `__session` cookie, HttpOnly, Secure, SameSite=Lax, 30-day fixed TTL. GitHub access token is used once to fetch the user profile and then discarded.
- **State tokens**: stored in KV with `state:` prefix, 10-minute TTL, deleted on use (CSRF prevention).

Update the Backend layout diagram to include the new files.

## Files to Create / Modify

**New:**
- `functions/api/auth/github.ts`
- `functions/api/auth/callback.ts`
- `functions/api/auth/me.ts`
- `functions/api/auth/logout.ts`
- `functions/_lib/auth.ts`
- `functions/__tests__/auth.test.ts`

**Modified:**
- `AGENTS.md` — Auth subsection + layout diagram update

## Integration Notes

- TASK-88.4 (workspace sync REST API) will call `requireUser` from `_lib/auth.ts` — keep the signature stable.
- TASK-88.5 (web: auth client & login/logout UI) calls `GET /api/auth/me` and `POST /api/auth/logout`.
- TASK-88.9 (dev-mode auth bypass) may need a hook point in `requireUser` — leave a comment noting this.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Callback file placed at `functions/api/auth/github/callback.ts` (not `auth/callback.ts` as the plan suggested) to correctly route to `/api/auth/github/callback` matching the redirect_uri and GitHub OAuth App settings. Both `functions/api/auth/github.ts` and `functions/api/auth/github/` coexist cleanly in Pages Functions filesystem routing.

KV mock for tests is implemented inline in `auth.test.ts` — a simple `Map<string, string>` cast to `KVNamespace`. No TTL simulation needed since tests are synchronous.

13 tests added across parseCookies, state, session, and requireUser cases (21 total including the 8 from db.test.ts).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented GitHub OAuth 2.0 Authorization Code flow as Cloudflare Pages Functions. Created `functions/_lib/auth.ts` with all auth primitives (state generation/verification for CSRF, session minting/lookup/deletion, cookie helpers, and the reusable `requireUser` guard). Added four endpoint files: `GET /api/auth/github` (state + redirect), `GET /api/auth/github/callback` (code exchange, user upsert, session mint), `GET /api/auth/me` (session-gated user info), and `POST /api/auth/logout` (KV delete + cookie clear). The GitHub access token is used once to fetch the profile then discarded. Added 13 unit tests in `functions/__tests__/auth.test.ts` covering all auth primitives with an inline KV mock and the existing D1 mock. Updated AGENTS.md with OAuth App setup instructions, required secrets, session design notes, and updated layout diagrams. All 21 functions tests pass and TypeScript type-checking is clean."
<!-- SECTION:FINAL_SUMMARY:END -->
