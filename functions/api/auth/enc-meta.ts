// GET /api/auth/enc-meta — returns { kwk, wrapped_dek } for the authenticated user.
// PUT /api/auth/enc-meta — stores the client-generated wrapped DEK.
//
// Security model:
//   KWK  (Key Wrapping Key): random 256-bit key, stored in KV under kwk:<user_id>.
//   DEK  (Data Encryption Key): generated client-side, wrapped with KWK, stored in D1.
//
// Neither KV nor D1 alone is sufficient to decrypt workspace data; both are required.
// The plaintext DEK is constructed and used only in the browser — the server never sees it.
import { requireUser } from "../../_lib/auth";
import { getWrappedDek, setWrappedDekIfAbsent } from "../../_lib/db";
import { jsonError, withErrorHandling } from "../../_lib/http";
import { logEvent } from "../../_lib/log";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

const KWK_PREFIX = "kwk:";

async function getOrCreateKwk(
  kv: KVNamespace,
  userId: string,
): Promise<string> {
  const existing = await kv.get(`${KWK_PREFIX}${userId}`);
  if (existing) return existing;

  const raw = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(Array.from(raw, (b) => String.fromCharCode(b)).join(""));
  await kv.put(`${KWK_PREFIX}${userId}`, b64);
  return b64;
}

export const onRequestGet: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
    if (result instanceof Response) return result;
    const user = result;

    const kwk = await getOrCreateKwk(ctx.env.SESSIONS, user.id);
    const wrapped_dek = await getWrappedDek(ctx.env.DB, user.id);

    return Response.json({ kwk, wrapped_dek });
  },
);

export const onRequestPut: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
    if (result instanceof Response) return result;
    const user = result;

    let body: { wrapped_dek: string };
    try {
      body = (await ctx.request.json()) as typeof body;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const { wrapped_dek } = body;
    if (typeof wrapped_dek !== "string" || !wrapped_dek) {
      return jsonError("Missing required field: wrapped_dek", 400);
    }

    const stored = await setWrappedDekIfAbsent(
      ctx.env.DB,
      user.id,
      wrapped_dek,
    );
    logEvent("data.dek_write", { user_id: user.id });
    return Response.json({ wrapped_dek: stored });
  },
);
