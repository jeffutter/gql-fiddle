import { clearCookieHeader, deleteSession, parseCookies, SESSION_COOKIE_NAME } from "../../_lib/auth";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

// POST /api/auth/logout — delete the session from KV and clear the session
// cookie. Returns 204 regardless of whether a session existed.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const cookies = parseCookies(context.request.headers.get("Cookie") ?? "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) await deleteSession(context.env.SESSIONS, token);
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookieHeader() },
  });
};
