// GET /api/auth/enc-meta — returns { kwk, wrapped_dek } for the authenticated user.
// PUT /api/auth/enc-meta — stores the client-generated wrapped DEK.
//
// Security model:
//   KWK  (Key Wrapping Key): random 256-bit key, stored in D1 alongside the wrapped DEK.
//   DEK  (Data Encryption Key): generated client-side, wrapped with KWK, stored in D1.
//
// Both the KWK and the wrapped DEK live in the same database (D1) — this is no
// longer a two-separate-storage-backends design (see TASK-118: the prior KV-backed
// KWK could not be written race-safely, so it moved into D1 using the same
// conditional-write pattern as the wrapped DEK).
// The plaintext DEK is constructed and used only in the browser — the server never
// sees it, so a D1 compromise yields the wrapped DEK and the KWK but never the
// unwrapped plaintext.
import { requireUser } from "../../_lib/auth";
import {
  getKwk,
  getWrappedDek,
  setKwkIfAbsent,
  setWrappedDekIfAbsent,
} from "../../_lib/db";
import { jsonError, withErrorHandling } from "../../_lib/http";
import { logEvent } from "../../_lib/log";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

async function getOrCreateKwk(db: D1Database, userId: string): Promise<string> {
  const existing = await getKwk(db, userId);
  if (existing) return existing;

  const raw = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(Array.from(raw, (b) => String.fromCharCode(b)).join(""));
  return setKwkIfAbsent(db, userId, b64);
}

export const onRequestGet: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
    if (result instanceof Response) return result;
    const user = result;

    const kwk = await getOrCreateKwk(ctx.env.DB, user.id);
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
