import {
  clearCookieHeader,
  deleteSession,
  getSession,
  parseCookies,
  SESSION_COOKIE_NAME,
} from "../../_lib/auth";
import { withErrorHandling } from "../../_lib/http";
import { logEvent } from "../../_lib/log";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ENVIRONMENT?: string;
}

// POST /api/auth/logout — delete the session from KV and clear the session
// cookie. Returns 204 regardless of whether a session existed.
export const onRequestPost: PagesFunction<Env> = withErrorHandling(
  async (context) => {
    const cookies = parseCookies(context.request.headers.get("Cookie") ?? "");
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      // Look up the session before deleting it so we know whose it was —
      // deleteSession alone can't tell us the user_id after the fact.
      const session = await getSession(context.env.SESSIONS, token);
      await deleteSession(context.env.SESSIONS, token);
      if (session) logEvent("auth.logout", { user_id: session.user_id });
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie": clearCookieHeader(
          context.env.ENVIRONMENT === "production",
        ),
      },
    });
  },
);
