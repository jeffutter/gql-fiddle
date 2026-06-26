// Tests for web/src/auth.ts (TASK-88.5)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./auth";

// We import these lazily in each test to get a fresh module in some cases,
// but for most tests we can just import at the top.
import { fetchCurrentUser, login, logout } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAuth() {
  useAuth.getState().setAuth(null);
  useAuth.setState({ status: "loading", syncStatus: "synced" });
}

// ---------------------------------------------------------------------------
// fetchCurrentUser
// ---------------------------------------------------------------------------

describe("fetchCurrentUser", () => {
  beforeEach(() => {
    resetAuth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when /api/auth/me returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    const user = await fetchCurrentUser();
    expect(user).toBeNull();
  });

  it("returns User when /api/auth/me returns 200", async () => {
    const mockUser = { id: "u1", login: "alice", name: "Alice", avatar_url: null };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ user: mockUser }), { status: 200 }),
    );
    const user = await fetchCurrentUser();
    expect(user).toEqual(mockUser);
  });

  it("returns null when fetch throws (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const user = await fetchCurrentUser();
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe("login", () => {
  it("navigates to /api/auth/login", () => {
    const original = window.location.href;
    // jsdom allows assignment to location.href
    const spy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...window.location,
        set href(v: string) {
          spy(v);
        },
      },
    });

    login();

    expect(spy).toHaveBeenCalledWith("/api/auth/login");

    // Restore
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, href: original },
    });
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe("logout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls POST /api/auth/logout and sets status to anonymous", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await logout();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(useAuth.getState().status).toBe("anonymous");
    expect(useAuth.getState().user).toBeNull();
  });

  it("resets auth state even when the fetch fails", async () => {
    useAuth.setState({
      user: { id: "u1", login: "alice", name: null, avatar_url: null },
      status: "authed",
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    await logout();

    expect(useAuth.getState().status).toBe("anonymous");
    expect(useAuth.getState().user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useAuth store — syncStatus
// ---------------------------------------------------------------------------

describe("useAuth syncStatus", () => {
  beforeEach(() => resetAuth());

  it("starts as synced", () => {
    expect(useAuth.getState().syncStatus).toBe("synced");
  });

  it("setSyncStatus updates the value", () => {
    useAuth.getState().setSyncStatus("saving");
    expect(useAuth.getState().syncStatus).toBe("saving");
    useAuth.getState().setSyncStatus("offline");
    expect(useAuth.getState().syncStatus).toBe("offline");
    useAuth.getState().setSyncStatus("error");
    expect(useAuth.getState().syncStatus).toBe("error");
    useAuth.getState().setSyncStatus("synced");
    expect(useAuth.getState().syncStatus).toBe("synced");
  });
});
