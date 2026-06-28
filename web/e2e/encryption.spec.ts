// Browser-level E2E test: verifies that the sync engine sends AES-GCM
// ciphertext to the server, not plaintext, when running in a real browser.
//
// Because the Playwright webServer is Vite-only (no wrangler backend), all
// backend API routes are mocked with page.route(). This lets us:
//   1. Simulate a signed-in session without GitHub OAuth.
//   2. Supply a known KWK so the browser can derive a DEK via real Web Crypto.
//   3. Capture workspace PUT bodies and assert they carry CE1:-prefixed ciphertext.
import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";

test("workspace sync sends CE1:-compressed-encrypted name and payload to the server", async ({
  page,
}) => {
  // A valid 32-byte AES-256 key as base64 — used as the server-side KWK.
  const kwk = randomBytes(32).toString("base64");

  const pushedBodies: Array<{ name: string; payload: string; version: number }> = [];

  // ── Route mocks (set up before navigation so nothing slips through) ────────

  // Auth: pretend the user is already signed in.
  await page.route("**/api/auth/me", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "e2e-test-user",
          login: "e2euser",
          name: "E2E Test User",
          avatar_url: null,
        },
      }),
    });
  });

  // enc-meta GET: return the KWK with no wrapped DEK (first login).
  // enc-meta PUT: accept the client's wrapped DEK and return 204.
  await page.route("**/api/auth/enc-meta", (route) => {
    if (route.request().method() === "PUT") {
      void route.fulfill({ status: 204 });
    } else {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ kwk, wrapped_dek: null }),
      });
    }
  });

  // Workspace list: empty on first login so all local workspaces are local-only.
  // Match both /api/workspaces and /api/workspaces?since=N (delta endpoint used by onLogin).
  await page.route(/\/api\/workspaces(\?.*)?$/, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workspaces: [] }),
      });
    } else {
      void route.continue();
    }
  });

  // Workspace PUT: capture the request body and return a minimal server row.
  // The body is what the browser actually sent — still encrypted at this point.
  await page.route("**/api/workspaces/**", (route) => {
    if (route.request().method() === "PUT") {
      const raw = route.request().postData();
      const body = JSON.parse(raw ?? "{}") as {
        name: string;
        payload: string;
        version: number;
      };
      pushedBodies.push(body);

      const wsId = route.request().url().split("/").pop() ?? "ws-unknown";
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workspace: {
            id: wsId,
            name: body.name,
            payload: body.payload,
            version: body.version,
            updated_at: 0,
            deleted_at: null,
          },
        }),
      });
    } else if (route.request().method() === "DELETE") {
      void route.fulfill({ status: 204 });
    } else {
      void route.continue();
    }
  });

  // ── Navigate and wait for the authenticated UI ─────────────────────────────

  await page.goto("/");

  // The app shows "Sign out" once it detects an authenticated session.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({
    timeout: 15_000,
  });

  // ── Assert encrypted payloads ──────────────────────────────────────────────

  // Wait for at least one workspace to be pushed (onLogin pushes local-only workspaces).
  await expect.poll(() => pushedBodies.length, { timeout: 15_000 }).toBeGreaterThan(0);

  for (const body of pushedBodies) {
    expect(body.name, "workspace name must be compressed+encrypted ciphertext").toMatch(/^CE1:/);
    expect(body.payload, "workspace payload must be compressed+encrypted ciphertext").toMatch(
      /^CE1:/,
    );
  }
});
