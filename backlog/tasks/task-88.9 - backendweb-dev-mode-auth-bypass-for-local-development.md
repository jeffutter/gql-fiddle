---
id: TASK-88.9
title: 'backend+web: dev-mode auth bypass for local development'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 20:52'
updated_date: '2026-06-26 23:25'
labels:
  - backend
  - web
  - auth
  - dx
  - planned
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
- [x] #1 GET /api/auth/dev-login is unreachable (404) when ENVIRONMENT=production and works when ENVIRONMENT=development
- [x] #2 GET /api/auth/login redirects to /api/auth/github in production and /api/auth/dev-login otherwise, so the frontend never needs to know which provider is active
- [x] #3 DEV_USER_ID env var (from .dev.vars) controls the synthetic user identity; defaults to 'dev-user-1' if unset
- [x] #4 dev-login mints a real session in KV and sets the same HttpOnly Secure SameSite=Lax cookie as the OAuth callback — downstream code (requireUser, sync engine) is unaware of the difference
- [x] #5 Two browser profiles hitting the same wrangler dev server both calling /api/auth/dev-login resolve to the same user and see the same synced workspaces
- [x] #6 web/src/auth.ts login() navigates to /api/auth/login (not directly to /api/auth/github)
- [x] #7 .dev.vars.example is committed with DEV_USER_ID and ENVIRONMENT fields; .dev.vars is gitignored; AGENTS.md documents the local dev setup
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Creates a thin routing layer so the frontend never hardcodes which auth provider is active, plus a zero-browser-round-trip dev login endpoint that mints real KV sessions and D1 users — identical to what the OAuth callback produces.

## Files to create / modify

New:
- `functions/api/auth/login.ts` — unified redirect (prod → GitHub, dev → dev-login)
- `functions/api/auth/dev-login.ts` — dev-only session mint + redirect
- `.dev.vars.example` — committed template for local secrets
- `functions/__tests__/dev-auth.test.ts` — unit tests

Modified:
- `.gitignore` — add `.dev.vars`
- `AGENTS.md` — local dev auth setup

## Step 1 — `functions/api/auth/login.ts`

```ts
import type { PagesFunction } from "@cloudflare/workers-types";
interface Env { ENVIRONMENT?: string; }

export const onRequestGet: PagesFunction<Env> = (ctx) => {
  const isProduction = ctx.env.ENVIRONMENT === "production";
  const target = isProduction ? "/api/auth/github" : "/api/auth/dev-login";
  return Response.redirect(new URL(target, ctx.request.url).toString(), 302);
};
```

No state or side effects — pure redirect based on environment variable.

## Step 2 — `functions/api/auth/dev-login.ts`

Gate on ENVIRONMENT to block access in production:

```ts
import type { PagesFunction } from "@cloudflare/workers-types";
import { getOrCreateUser } from "../../_lib/db";
import { mintSession, sessionCookieHeader } from "../../_lib/auth";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ENVIRONMENT?: string;
  DEV_USER_ID?: string;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  if (ctx.env.ENVIRONMENT === "production") {
    return new Response("Not found", { status: 404 });
  }
  const devUserId = ctx.env.DEV_USER_ID ?? "dev-user-1";
  // Synthetic GitHub profile — github_id 0 won't collide with real GitHub users (IDs start at 1).
  const user = await getOrCreateUser(ctx.env.DB, {
    github_id: 0,
    login: devUserId,
    name: "Dev User",
    avatar_url: null,
  });
  const token = await mintSession(ctx.env.SESSIONS, user.id);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": sessionCookieHeader(token, 30 * 24 * 60 * 60),
    },
  });
};
```

## Step 3 — `.dev.vars.example`

```
# Local-only secrets for wrangler pages dev. Copy to .dev.vars (gitignored).
ENVIRONMENT=development
DEV_USER_ID=dev-user-1
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
```

Add `.dev.vars` to `.gitignore`.

## Step 4 — Tests (`functions/__tests__/dev-auth.test.ts`)

Use the existing D1 mock (`d1-mock.ts`) and inline KV mock patterns from `auth.test.ts`. Apply migrations in `beforeAll`.

Test cases:
1. `GET /api/auth/login` with `ENVIRONMENT=production` → 302 Location: `/api/auth/github`
2. `GET /api/auth/login` without ENVIRONMENT → 302 Location: `/api/auth/dev-login`
3. `GET /api/auth/dev-login` with `ENVIRONMENT=production` → 404
4. `GET /api/auth/dev-login` with `ENVIRONMENT=development` → 302 Location: `/`, `Set-Cookie: __session=...`
5. `GET /api/auth/dev-login` idempotency — second call returns same `user.id` (getOrCreateUser is idempotent on github_id=0 + login=devUserId)
6. `DEV_USER_ID` defaults to `dev-user-1` when env var is unset

## Step 5 — AGENTS.md

Add "### Local development auth" under the Backend/Auth section:
- Copy `.dev.vars.example` to `.dev.vars` and fill in credentials
- `ENVIRONMENT=development` (default if unset) enables the dev-login bypass
- Hit `http://localhost:8788/api/auth/dev-login` to sign in instantly
- Two-profile cross-device test: open two browser profiles on same wrangler dev server; both hit `/api/auth/dev-login` → share the same userId and see the same workspaces
- Two-user test: set `DEV_USER_ID=dev-user-2` in a second terminal running wrangler dev on a different port

## Note for TASK-88.5

The `login()` function in `web/src/auth.ts` MUST navigate to `/api/auth/login` (not `/api/auth/github` directly). This routing layer is what TASK-88.9 establishes; TASK-88.5 consumes it.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented dev-mode auth bypass: `functions/api/auth/login.ts` (unified redirect, prod→GitHub, dev→dev-login), `functions/api/auth/dev-login.ts` (mints real KV session for a synthetic github_id=0 user, gates on ENVIRONMENT!=='production'), `.dev.vars.example` (committed template), `.gitignore` updated to exclude `.dev.vars`. Added 8 unit tests in `functions/__tests__/dev-auth.test.ts` covering all branches. Updated `AGENTS.md` with local dev auth bypass instructions, two-profile cross-device test docs, and .dev.vars setup.
<!-- SECTION:FINAL_SUMMARY:END -->
