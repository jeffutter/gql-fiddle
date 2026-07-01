// PUT  /api/workspaces/:id — upsert one workspace (last-write-wins).
// DELETE /api/workspaces/:id — soft-delete (sets deleted_at, bumps version).
//
// Both endpoints are authenticated and operate only on the caller's rows.
// Cross-user access returns 404 (not 403) to avoid id enumeration.
import { requireUser } from "../../_lib/auth";
import { upsertWorkspace, softDeleteWorkspace } from "../../_lib/db";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

const PAYLOAD_SIZE_LIMIT = 1_048_576; // 1 MB
const NAME_MAX_BYTES = 256; // generous for a display name; no prior documented contract

export const onRequestPut: PagesFunction<Env> = async (ctx) => {
  const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
  if (result instanceof Response) return result;
  const user = result;

  const id = ctx.params.id as string;

  // Reject on the declared Content-Length before touching the body at all.
  // This is the primary DoS mitigation: an honestly-declared oversized
  // request never gets buffered or parsed.
  const contentLength = ctx.request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > PAYLOAD_SIZE_LIMIT) {
    return Response.json(
      { error: "Payload too large (max 1 MB)" },
      { status: 413 },
    );
  }

  let rawBody: string;
  try {
    rawBody = await ctx.request.text();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Defends against a missing/understated Content-Length header. Measured
  // in real UTF-8 bytes (not UTF-16 code units) so multi-byte payloads
  // can't slip past the documented 1 MB contract. Gates the expensive
  // JSON.parse below.
  if (new TextEncoder().encode(rawBody).length > PAYLOAD_SIZE_LIMIT) {
    return Response.json(
      { error: "Payload too large (max 1 MB)" },
      { status: 413 },
    );
  }

  let body: { name: string; payload: string; version: number };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, payload, version } = body;
  if (
    typeof name !== "string" ||
    typeof payload !== "string" ||
    typeof version !== "number"
  ) {
    return Response.json(
      { error: "Missing required fields: name, payload, version" },
      { status: 400 },
    );
  }

  if (new TextEncoder().encode(name).length > NAME_MAX_BYTES) {
    return Response.json(
      { error: `Name too long (max ${NAME_MAX_BYTES} bytes)` },
      { status: 400 },
    );
  }

  // Ownership check: if this id already exists and belongs to another user,
  // return 404 to avoid leaking that the id is taken.
  const existing = await ctx.env.DB.prepare(
    "SELECT user_id FROM workspaces WHERE id = ?",
  )
    .bind(id)
    .first<{ user_id: string }>();
  if (existing && existing.user_id !== user.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { accepted, row } = await upsertWorkspace(ctx.env.DB, {
    id,
    user_id: user.id,
    name,
    payload,
    version,
  });

  if (!accepted) {
    if (!row) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ conflict: true, current: row }, { status: 409 });
  }

  return Response.json({ workspace: row });
};

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
  if (result instanceof Response) return result;
  const user = result;

  const id = ctx.params.id as string;

  const deleted = await softDeleteWorkspace(ctx.env.DB, id, user.id);
  if (!deleted) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(null, { status: 204 });
};
