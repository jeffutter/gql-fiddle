---
id: TASK-88.5
title: 'web: auth client & login/logout UI'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:12'
updated_date: '2026-06-26 23:25'
labels:
  - web
  - auth
  - ui
  - planned
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
- [x] #1 Auth client module exposes fetchCurrentUser/login/logout using same-origin credentialed requests
- [x] #2 App resolves auth state on mount and exposes { user, status } for other code to consume
- [x] #3 Header shows 'Sign in with GitHub' when anonymous and avatar + Sign out when authenticated, styled via existing theme tokens/classes (no hardcoded colors)
- [x] #4 Sign-in affordance is present and usable on mobile
- [x] #5 Returning from the OAuth redirect leaves the app in the authenticated state without a manual refresh
- [x] #6 Component tests cover anonymous vs authed header rendering; logged-out experience has no regressions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Introduces `web/src/auth.ts` (auth client module + Zustand auth store) and wires login/logout/avatar UI into the existing `globalHeader` in `App.tsx`. No routing changes — the server handles provider selection.

## Step 1 — `web/src/auth.ts`

Exports both the auth client functions and the `useAuth` Zustand store in one module:

```ts
import { create } from "zustand";

export interface User {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export type AuthStatus = "loading" | "anonymous" | "authed";

interface AuthState {
  user: User | null;
  status: AuthStatus;
  setAuth: (user: User | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  setAuth: (user) =>
    set({ user, status: user ? "authed" : "anonymous" }),
}));

/** Fetch the currently logged-in user. Returns null if unauthenticated. */
export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: User };
    return data.user;
  } catch {
    return null;
  }
}

/** Navigate to the unified login endpoint (routes to OAuth or dev bypass). */
export function login(): void {
  window.location.href = "/api/auth/login";
}

/** POST logout, clear auth state. */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } finally {
    useAuth.getState().setAuth(null);
  }
}
```

## Step 2 — Bootstrap in `App.tsx`

Add a `useEffect` in the `App` component (or in `main.tsx` if preferred for separation):

```ts
useEffect(() => {
  void fetchCurrentUser().then((user) => {
    useAuth.getState().setAuth(user);
  });
}, []);
```

Runs once on mount. After the OAuth redirect, the callback sets the cookie and redirects to `/`; `fetchCurrentUser()` on mount picks up the authenticated state automatically.

## Step 3 — Auth UI in `globalHeader`

In `App.tsx`, import `useAuth`, `login`, `logout` from `./auth`. In the `globalHeader` JSX, append auth UI at the end of `page-header__actions`:

```tsx
const { user, status } = useAuth();
// ...
// inside page-header__actions:
{status !== "loading" && (
  status === "anonymous" ? (
    <button onClick={login} className="btn">Sign in with GitHub</button>
  ) : (
    <div className="auth-user">
      {user?.avatar_url && (
        <img
          src={user.avatar_url}
          alt={user.login}
          className="auth-user__avatar"
          width={24}
          height={24}
        />
      )}
      <span className="auth-user__name">{user?.login}</span>
      <button onClick={() => void logout()} className="btn">Sign out</button>
    </div>
  )
)}
```

The auth UI is hidden while `status === "loading"` to avoid a flash of the wrong state.

## Step 4 — CSS additions (web/src/index.css)

Minimal additions using existing CSS variables:

```css
.auth-user {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auth-user__avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.auth-user__name {
  font-size: 0.85em;
  color: var(--text-muted, #aaa);
}
```

No hardcoded colors — uses CSS variables from the existing theme.

## Step 5 — Tests

`web/src/auth.test.ts`:
1. `fetchCurrentUser` when `/api/auth/me` returns 401 → null
2. `fetchCurrentUser` when `/api/auth/me` returns 200 → User object
3. `logout` calls POST `/api/auth/logout` and resets `useAuth.getState().status` to `"anonymous"`
4. `login` navigates to `/api/auth/login` (mock `window.location.href` assignment)

`web/src/App.test.tsx` additions (mock `useAuth`):
5. Header shows "Sign in with GitHub" when `status="anonymous"`
6. Header shows avatar + username + "Sign out" when `status="authed"`
7. Header shows nothing auth-related when `status="loading"` (no flash)
8. Clicking "Sign out" calls `logout()`

## Files

New: `web/src/auth.ts`
Modified: `web/src/App.tsx` (import useAuth + auth UI in globalHeader + bootstrap useEffect)
Modified: `web/src/index.css` (auth-user styles)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented web auth client and login/logout UI. Created `web/src/auth.ts` with `User` type, `useAuth` Zustand store (`{user, status, syncStatus}`), `fetchCurrentUser()`, `login()` (navigates to /api/auth/login), `logout()` (POST + clears auth state on network error too). Updated `web/src/App.tsx`: imports useAuth/login/logout/initSync, bootstraps auth on mount via fetchCurrentUser, initializes sync engine, adds auth UI to page-header__actions (Sign in with GitHub button when anonymous, avatar+username+Sign out when authed, hidden during loading). Added `.auth-user`, `.auth-user__avatar`, `.auth-user__name` and `.sync-status--*` CSS classes to `web/src/theme.css` using CSS variables only. Added 8 unit tests in `web/src/auth.test.ts`.
<!-- SECTION:FINAL_SUMMARY:END -->
