// GET /api/workspaces — return the authenticated user's workspaces.
//
// Without ?since: full snapshot of live (non-deleted) workspaces.
// With ?since=<epochMs>: delta — rows updated after that timestamp, including
//   soft-deleted ones so clients learn about deletions on the next sync.
import { requireUser } from "../../_lib/auth";
import { listWorkspaces } from "../../_lib/db";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
  if (result instanceof Response) return result;
  const user = result;

  const sinceParam = new URL(ctx.request.url).searchParams.get("since");
  const since = sinceParam !== null ? Number(sinceParam) : undefined;

  const rows = await listWorkspaces(ctx.env.DB, user.id, since);
  return Response.json({ workspaces: rows });
};
