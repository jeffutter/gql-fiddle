import { generateState } from "../../_lib/auth";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

// GET /api/auth/github — generate an OAuth state token, store it in KV with a
// 10-minute TTL, and redirect the browser to GitHub's authorization URL.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const state = await generateState(env.SESSIONS);
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL("/api/auth/github/callback", request.url).toString(),
    scope: "read:user",
    state,
  });
  return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
};
