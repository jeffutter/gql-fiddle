import {
  mintSession,
  sessionCookieHeader,
  verifyState,
} from "../../../_lib/auth";
import { getOrCreateUser } from "../../../_lib/db";
import { jsonError, withErrorHandling } from "../../../_lib/http";
import { logEvent } from "../../../_lib/log";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

// GET /api/auth/github/callback — validate OAuth state, exchange the code for
// an access token, fetch the GitHub user profile, upsert the user row in D1,
// mint an opaque session token stored in KV, and set it as an HttpOnly cookie.
//
// The GitHub access token is used exactly once to fetch the profile and is then
// discarded — it is never stored.
export const onRequestGet: PagesFunction<Env> = withErrorHandling(
  async (context) => {
    const { env, request } = context;
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!state || !code) {
      return jsonError("Missing code or state", 400);
    }

    const stateValid = await verifyState(env.SESSIONS, state);
    if (!stateValid) {
      logEvent("auth.state_invalid", { reason: "missing_or_expired" });
      return jsonError("Invalid or expired state", 400);
    }

    // Exchange authorization code for an access token.
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
    );

    const tokenData = (await tokenRes.json()) as GitHubTokenResponse;
    if (tokenData.error || !tokenData.access_token) {
      logEvent("auth.login_failure", { reason: "token_exchange_failed" });
      return jsonError("Failed to exchange code for token", 400);
    }

    // Fetch the GitHub user profile. Access token is used here and then discarded.
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "gql-fiddle",
      },
    });

    if (!userRes.ok) {
      logEvent("auth.login_failure", { reason: "profile_fetch_failed" });
      return jsonError("Failed to fetch GitHub user", 502);
    }

    const ghUser = (await userRes.json()) as GitHubUser;

    const user = await getOrCreateUser(env.DB, {
      github_id: ghUser.id,
      login: ghUser.login,
      name: ghUser.name,
      avatar_url: ghUser.avatar_url,
    });

    const sessionTtlSeconds = 30 * 24 * 60 * 60; // 30 days
    const token = await mintSession(env.SESSIONS, user.id);

    logEvent("auth.login_success", { user_id: user.id, provider: "github" });

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": sessionCookieHeader(token, sessionTtlSeconds),
      },
    });
  },
);
