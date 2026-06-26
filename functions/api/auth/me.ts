import { requireUser } from "../../_lib/auth";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

// GET /api/auth/me — return the authenticated user as JSON, or 401 if not
// logged in. Used by the frontend to determine login state on load.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireUser(context.request, context.env.SESSIONS, context.env.DB);
  if (result instanceof Response) return result;
  return Response.json({ user: result });
};
