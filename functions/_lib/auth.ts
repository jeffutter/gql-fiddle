import type { UserRow } from "./db";

export interface SessionData {
  user_id: string;
  created_at: number;
}

export const SESSION_COOKIE_NAME = "__session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — fixed TTL, no sliding renewal
const STATE_TTL_SECONDS = 10 * 60; // 10 minutes

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export function sessionCookieHeader(token: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}

export function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// State tokens — CSRF prevention
// Keys are stored as `state:<token>` with a 10-minute TTL and deleted on use
// (one-time tokens). Using the same KV namespace as sessions but a different
// prefix avoids key collisions.
// ---------------------------------------------------------------------------

export async function generateState(kv: KVNamespace): Promise<string> {
  const token = crypto.randomUUID();
  await kv.put(`state:${token}`, "1", { expirationTtl: STATE_TTL_SECONDS });
  return token;
}

export async function verifyState(kv: KVNamespace, state: string): Promise<boolean> {
  const val = await kv.get(`state:${state}`);
  if (!val) return false;
  await kv.delete(`state:${state}`);
  return true;
}

// ---------------------------------------------------------------------------
// Session management
// Tokens are opaque UUIDs stored as `session:<token>` → JSON with a 30-day
// fixed TTL. The GitHub access token is never stored here or anywhere.
// ---------------------------------------------------------------------------

export async function mintSession(kv: KVNamespace, userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const data: SessionData = { user_id: userId, created_at: Date.now() };
  await kv.put(`session:${token}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function getSession(kv: KVNamespace, token: string): Promise<SessionData | null> {
  const val = await kv.get(`session:${token}`);
  if (!val) return null;
  return JSON.parse(val) as SessionData;
}

export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(`session:${token}`);
}

// ---------------------------------------------------------------------------
// requireUser — reusable auth gate for all protected endpoints.
// Returns the UserRow on success, or a 401 Response on failure.
// TASK-88.9 (dev-mode auth bypass) may need a hook point here.
// ---------------------------------------------------------------------------

export async function requireUser(
  request: Request,
  kv: KVNamespace,
  db: D1Database,
): Promise<UserRow | Response> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await getSession(kv, token);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(session.user_id)
    .first<UserRow>();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return user;
}
