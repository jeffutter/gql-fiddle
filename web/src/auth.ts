// Auth client module (TASK-88.5) + sync status store (TASK-88.7).
//
// Exports:
//   useAuth     — Zustand store: { user, status, syncStatus }
//   fetchCurrentUser() — calls GET /api/auth/me
//   login()            — navigates to /api/auth/login (server picks provider)
//   logout()           — POST /api/auth/logout + clears auth state
import { create } from "zustand";

// ---------------------------------------------------------------------------
// User type (mirrors UserRow from the backend)
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

// ---------------------------------------------------------------------------
// Auth + sync status store
// ---------------------------------------------------------------------------

export type AuthStatus = "loading" | "anonymous" | "authed";

/** Four states the sync status indicator can be in. */
export type SyncStatus = "synced" | "saving" | "offline" | "error";

interface AuthState {
  user: User | null;
  status: AuthStatus;
  syncStatus: SyncStatus;
  setAuth: (user: User | null) => void;
  setSyncStatus: (s: SyncStatus) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  syncStatus: "synced",
  setAuth: (user) => set({ user, status: user ? "authed" : "anonymous" }),
  setSyncStatus: (s) => set({ syncStatus: s }),
}));

// ---------------------------------------------------------------------------
// Auth client functions
// ---------------------------------------------------------------------------

/**
 * Fetch the currently logged-in user from /api/auth/me.
 * Returns null when the response is not 2xx or on network error.
 * Uses credentials: "include" so the session cookie rides along
 * (same-origin, no CORS needed).
 */
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

/**
 * Navigate to the unified login endpoint. The server decides whether to
 * redirect to GitHub OAuth (production) or the dev bypass (development),
 * so the frontend never needs to know which provider is active.
 */
export function login(): void {
  window.location.href = "/api/auth/login";
}

/**
 * POST to /api/auth/logout to invalidate the session, then clear auth state.
 * The session cookie is cleared by the server response. Network errors are
 * swallowed — we always clear local auth state regardless of server response
 * since the user's intent is to log out.
 */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Session may already be invalid or network unavailable — clear local state anyway.
  } finally {
    useAuth.getState().setAuth(null);
  }
}
