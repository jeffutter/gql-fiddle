// GET /api/auth/enc-meta — returns { kwk, wrapped_dek, legacy_kwk } for the authenticated user.
// PUT /api/auth/enc-meta — stores the client-generated wrapped DEK, and/or
//   confirms a legacy KWK the client has proven correct (see below).
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
//
// Legacy KV recovery (TASK-128): migration 0003 (TASK-118) added the D1 `kwk`
// column with no backfill from the pre-existing `kwk:<user_id>` KV entries.
// Accounts that had already completed key setup before TASK-118 shipped got a
// brand-new, unrelated D1 kwk generated lazily on their next GET, orphaning
// their existing wrapped_dek. The server can never tell an orphaned account
// apart from one with a genuinely stale, already-superseded legacy KV entry —
// it never sees the plaintext DEK. So GET offers the legacy KV value as a
// `legacy_kwk` candidate whenever it disagrees with the stored D1 kwk and a
// wrapped_dek already exists, and the client (which can attempt the decrypt)
// confirms which one is correct via `confirm_kwk` on PUT.
import { requireUser } from "../../_lib/auth";
import {
  getKwk,
  getWrappedDek,
  setKwk,
  setKwkIfAbsent,
  setWrappedDekIfAbsent,
} from "../../_lib/db";
import { jsonError, withErrorHandling } from "../../_lib/http";
import { logEvent } from "../../_lib/log";

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

// Legacy location of the KWK before TASK-118 moved key storage into D1.
// Deliberately never deleted by any code path so it survives indefinitely
// as a recovery source for accounts whose D1 kwk was orphaned by migration
// 0003's unbackfilled column (see TASK-128).
const LEGACY_KWK_PREFIX = "kwk:";

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

    // If this account already has a wrapped_dek, a legacy (pre-TASK-118)
    // KV-stored KWK might still exist and disagree with the D1 value — the
    // exact orphaning bug TASK-128 exists to fix. Only the client can prove
    // which one actually unwraps wrapped_dek (the server never sees the
    // plaintext DEK), so surface the legacy candidate for the client to try
    // instead of guessing here. Skipped entirely when wrapped_dek is null:
    // there is nothing to reconcile yet for a brand-new account.
    let legacy_kwk: string | null = null;
    if (wrapped_dek !== null) {
      const legacy = await ctx.env.SESSIONS.get(`${LEGACY_KWK_PREFIX}${user.id}`);
      if (legacy && legacy !== kwk) legacy_kwk = legacy;
    }

    return Response.json({ kwk, wrapped_dek, legacy_kwk });
  },
);

export const onRequestPut: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
    if (result instanceof Response) return result;
    const user = result;

    let body: { wrapped_dek?: string; confirm_kwk?: string };
    try {
      body = (await ctx.request.json()) as typeof body;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const { wrapped_dek, confirm_kwk } = body;

    if (confirm_kwk !== undefined) {
      if (typeof confirm_kwk !== "string" || !confirm_kwk) {
        return jsonError("Invalid confirm_kwk", 400);
      }
      // Only ever adopt a value that matches this account's own legacy KV
      // entry — never trust an arbitrary client-supplied KWK. The client
      // only ever echoes back the exact `legacy_kwk` this endpoint gave it
      // after proving locally that it unwraps wrapped_dek; re-checking here
      // against KV (rather than trusting the client's claim) means a buggy
      // or malicious client can at worst no-op this call, never corrupt
      // another value. Best-effort: mismatch/absence silently no-ops
      // instead of erroring, since the caller's current request already
      // succeeded locally regardless of whether this repair lands.
      const legacy = await ctx.env.SESSIONS.get(`${LEGACY_KWK_PREFIX}${user.id}`);
      if (legacy && legacy === confirm_kwk) {
        await setKwk(ctx.env.DB, user.id, confirm_kwk);
        logEvent("data.kwk_repaired", { user_id: user.id });
      }
    }

    if (wrapped_dek === undefined) {
      if (confirm_kwk === undefined) {
        return jsonError("Missing required field: wrapped_dek or confirm_kwk", 400);
      }
      return Response.json({ ok: true });
    }
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
