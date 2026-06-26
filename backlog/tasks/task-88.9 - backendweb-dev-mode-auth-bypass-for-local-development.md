---
id: TASK-88.9
title: 'backend+web: dev-mode auth bypass for local development'
status: Backlog
assignee: []
created_date: '2026-06-26 20:52'
labels:
  - backend
  - web
  - auth
  - dx
dependencies:
  - TASK-88.2
  - TASK-88.3
parent_task_id: TASK-88
priority: high
ordinal: 99500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

GitHub OAuth requires a registered OAuth App with a matching callback URL, making local development painful and requiring external-network round-trips. This task adds a dev-only bypass so engineers can sign in instantly against `wrangler pages dev` — including simulating multiple users/devices via a stable configurable `DEV_USER_ID` — without touching GitHub or the internet.

## Depends on

- TASK-88.2 — `users` table + data-access helper (`getOrCreateUser`)
- TASK-88.3 — session minting logic (KV write + cookie set), and the `requireUser` helper

## Scope

### Backend — `GET /api/auth/login` (unified redirect)

Add a thin redirect endpoint that routes to the appropriate auth flow based on environment:

```ts
// functions/api/auth/login.ts
export async function onRequest(ctx) {
  if (ctx.env.ENVIRONMENT === 'production') {
    return Response.redirect('/api/auth/github')
  }
  return Response.redirect('/api/auth/dev-login')
}
```

This keeps the frontend unaware of which auth provider is active — `login()` always navigates to `/api/auth/login`.

### Backend — `GET /api/auth/dev-login` (bypass, non-production only)

```ts
// functions/api/auth/dev-login.ts
export async function onRequest(ctx) {
  if (ctx.env.ENVIRONMENT === 'production') {
    return new Response('Not found', { status: 404 })
  }
  const userId = ctx.env.DEV_USER_ID ?? 'dev-user-1'
  // upsert a synthetic user row via the db helper
  await getOrCreateDevUser(ctx.env.DB, userId)
  // mint a real session in KV just like the OAuth callback does
  await createSession(ctx.env.SESSIONS, userId)
  // set the HttpOnly session cookie and redirect to app root
  return redirectWithSession('/', sessionToken)
}
```

- Gate on `ENVIRONMENT !== 'production'` — returns 404 in prod so the route can't be probed.
- `DEV_USER_ID` comes from `.dev.vars` (the wrangler local-secrets file, gitignored). Document this pattern in AGENTS.md.
- To simulate two devices, open two browser profiles both hitting the same wrangler dev server and hit `/api/auth/dev-login`; they share the same `userId` and therefore the same workspaces.
- To simulate two *different* users, set `DEV_USER_ID=dev-user-2` in a second terminal's `.dev.vars` and run a second wrangler dev instance on a different port.

### Web — update auth client

In `web/src/auth.ts` (introduced by TASK-88.5), change `login()` to navigate to `/api/auth/login` instead of `/api/auth/github` directly:

```ts
export function login() {
  window.location.href = '/api/auth/login'
}
```

No other frontend change is needed — the server handles the routing. The login button label in the header can stay "Sign in with GitHub" in production and show "Dev login" in local dev if desired (optional, low priority).

## Out of scope

- Any mock for the full OAuth flow
- Per-request user switching in a single browser session
- The actual OAuth App setup (TASK-88.3)

## Notes for implementer

`.dev.vars` is the wrangler convention for local environment secrets (equivalent to Pages env secrets in prod). Add `.dev.vars` to `.gitignore` and document it in AGENTS.md alongside the other local dev setup steps. A `.dev.vars.example` with `DEV_USER_ID=dev-user-1` and `ENVIRONMENT=development` committed to the repo serves as the setup guide.

## Tests & docs

- Unit test: `GET /api/auth/dev-login` with `ENVIRONMENT=production` returns 404; with `ENVIRONMENT=development` mints a session and redirects.
- Unit test: `GET /api/auth/login` redirects to `/api/auth/github` in prod and `/api/auth/dev-login` otherwise.
- Update AGENTS.md: document `.dev.vars.example`, `DEV_USER_ID`, and the two-profile trick for cross-device sync testing locally.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /api/auth/dev-login is unreachable (404) when ENVIRONMENT=production and works when ENVIRONMENT=development
- [ ] #2 GET /api/auth/login redirects to /api/auth/github in production and /api/auth/dev-login otherwise, so the frontend never needs to know which provider is active
- [ ] #3 DEV_USER_ID env var (from .dev.vars) controls the synthetic user identity; defaults to 'dev-user-1' if unset
- [ ] #4 dev-login mints a real session in KV and sets the same HttpOnly Secure SameSite=Lax cookie as the OAuth callback — downstream code (requireUser, sync engine) is unaware of the difference
- [ ] #5 Two browser profiles hitting the same wrangler dev server both calling /api/auth/dev-login resolve to the same user and see the same synced workspaces
- [ ] #6 web/src/auth.ts login() navigates to /api/auth/login (not directly to /api/auth/github)
- [ ] #7 .dev.vars.example is committed with DEV_USER_ID and ENVIRONMENT fields; .dev.vars is gitignored; AGENTS.md documents the local dev setup
<!-- AC:END -->
