import { generateState } from "../../_lib/auth";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  APP_ORIGIN: string;
}

// GET /api/auth/github — generate an OAuth state token, store it in KV with a
// 10-minute TTL, and redirect the browser to GitHub's authorization URL.
//
// redirect_uri is built from APP_ORIGIN (a configured origin), not the
// incoming request's Host header — Host is attacker-influenceable (spoofable
// / reachable via alternate hostnames) and GitHub echoes this value back
// verbatim during the callback, so it must not derive from request-controlled
// input. Fail-closed if APP_ORIGIN is unset.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  if (!env.APP_ORIGIN) {
    return new Response("Server misconfigured: APP_ORIGIN is not set", {
      status: 500,
    });
  }
  const state = await generateState(env.SESSIONS);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL(
      "/api/auth/github/callback",
      env.APP_ORIGIN,
    ).toString(),
    scope: "read:user",
    state,
  });
  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params}`,
    302,
  );
};
