// GET /api/workspaces — return the authenticated user's workspaces.
//
// Without ?since: full snapshot of live (non-deleted) workspaces.
// With ?since=<cursor>: delta — rows updated at-or-after that cursor
//   (a value previously returned by this endpoint's `cursor` field — never a
//   client-derived timestamp), including soft-deleted ones so clients learn
//   about deletions on the next sync.
//
// Every response — snapshot or delta — includes a `cursor`: a server
// timestamp captured immediately before the DB query runs. Clients must
// persist it and echo it back verbatim as the next `since`. Capturing it
// before (not after, and not derived from) the query means an empty result
// set still yields a usable, monotonic cursor, and a write that commits
// while this request is in flight will be picked up on the *next* pull
// (since the cursor predates it) rather than silently skipped.
import { requireUser } from "../../_lib/auth";
import { listWorkspaces } from "../../_lib/db";
import { withErrorHandling } from "../../_lib/http";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
    if (result instanceof Response) return result;
    const user = result;

    const sinceParam = new URL(ctx.request.url).searchParams.get("since");
    const since = sinceParam !== null ? Number(sinceParam) : undefined;

    // Capture the cursor before querying — see module comment above.
    const cursor = Date.now();
    const rows = await listWorkspaces(ctx.env.DB, user.id, since);
    return Response.json({ workspaces: rows, cursor });
  },
);
