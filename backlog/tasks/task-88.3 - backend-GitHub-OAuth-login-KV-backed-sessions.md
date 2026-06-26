---
id: TASK-88.3
title: 'backend: GitHub OAuth login + KV-backed sessions'
status: To Do
assignee: []
created_date: '2026-06-26 12:12'
updated_date: '2026-06-26 21:14'
labels:
  - backend
  - auth
  - cloudflare
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
- [ ] #1 Visiting /api/auth/github redirects to GitHub and a successful callback creates/updates a users row and sets an HttpOnly Secure SameSite=Lax session cookie
- [ ] #2 Session tokens are opaque and stored in KV with a TTL; the GitHub access token is not persisted
- [ ] #3 GET /api/auth/me returns the logged-in user or 401 when unauthenticated
- [ ] #4 POST /api/auth/logout invalidates the session in KV and clears the cookie
- [ ] #5 OAuth state is validated on callback to prevent CSRF
- [ ] #6 requireUser helper returns 401 for missing/invalid sessions and is reusable by other endpoints
- [ ] #7 Tests cover state validation, session lookup, and the 401 path with GitHub calls mocked; AGENTS.md documents OAuth App setup and secrets
<!-- AC:END -->
