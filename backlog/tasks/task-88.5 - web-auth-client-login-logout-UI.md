---
id: TASK-88.5
title: 'web: auth client & login/logout UI'
status: To Do
assignee: []
created_date: '2026-06-26 12:12'
updated_date: '2026-06-26 21:14'
labels:
  - web
  - auth
  - ui
dependencies:
  - TASK-88.3
  - TASK-88.9
parent_task_id: TASK-88
priority: high
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Gives users a way to sign in and surfaces login state in the UI (parent TASK-88). Prerequisite for the sync engine, which only activates when logged in.

## Depends on

- TASK-88.3 — `/api/auth/me`, `/api/auth/logout`.
- TASK-88.9 — `/api/auth/login` (the unified redirect endpoint that routes to GitHub OAuth in prod or the dev bypass locally).

## Scope

- Add a small auth client module (e.g. `web/src/auth.ts`): `fetchCurrentUser()` (calls `/api/auth/me`), `login()` (navigates to `/api/auth/login` — **not** `/api/auth/github` directly; the server decides which flow to use based on environment), `logout()` (POST `/api/auth/logout`). All requests use `credentials: 'include'` (same-origin, so the cookie rides along).
- Hold auth state in the app (a small Zustand slice or React context): `{ user: User | null, status: 'loading' | 'anonymous' | 'authed' }`. Resolve on app mount via `fetchCurrentUser()`.
- UI in the `page-header` action area (consistent with the committed aesthetic — use existing `.btn` classes / tokens from `web/src/theme.css`, no hardcoded colors):
  - Logged out: a **"Sign in with GitHub"** button.
  - Logged in: avatar + username with a menu/affordance to **Sign out**.
- Mobile: include the sign-in/out affordance in the mobile header (compact).
- After returning from the OAuth redirect, the app should detect the now-authenticated state on load (the callback redirects to root; `fetchCurrentUser()` on mount picks it up).

## Out of scope

Actual workspace syncing — that is TASK-88.6. This task only establishes identity in the UI and exposes auth state for the sync engine to consume.

## Tests & docs

- Component test: header shows Sign in when anonymous and avatar/Sign out when authed (mock the auth client).
- Verify logged-out experience is unchanged (no auth UI errors when `/api/auth/me` returns 401).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Auth client module exposes fetchCurrentUser/login/logout using same-origin credentialed requests
- [ ] #2 App resolves auth state on mount and exposes { user, status } for other code to consume
- [ ] #3 Header shows 'Sign in with GitHub' when anonymous and avatar + Sign out when authenticated, styled via existing theme tokens/classes (no hardcoded colors)
- [ ] #4 Sign-in affordance is present and usable on mobile
- [ ] #5 Returning from the OAuth redirect leaves the app in the authenticated state without a manual refresh
- [ ] #6 Component tests cover anonymous vs authed header rendering; logged-out experience has no regressions
<!-- AC:END -->
