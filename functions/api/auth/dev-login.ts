// GET /api/auth/dev-login — dev-only endpoint that creates/looks up a
// synthetic user in D1 and mints a real KV session, identical to what the
// OAuth callback produces. Gated on ENVIRONMENT !== "production" — returns
// 404 in production so the route can't be probed.
//
// Local usage: hit /api/auth/dev-login in the browser while running
// `wrangler pages dev web/dist`. The DEV_USER_ID env var (from .dev.vars,
// gitignored) controls the synthetic user identity; defaults to "dev-user-1".
//
// Simulating cross-device sync locally: open two browser profiles on the same
// wrangler dev server and both hit this endpoint — they share the same userId
// and therefore see the same workspaces.
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

  // Synthetic GitHub profile — github_id 0 will not collide with real GitHub
  // users (IDs start at 1). Using login=devUserId makes it easy to tell
  // accounts apart in D1 when simulating multiple users.
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
