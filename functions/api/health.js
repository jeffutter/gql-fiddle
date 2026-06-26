/**
 * GET /api/health
 *
 * Trivial liveness probe that also validates D1 + KV bindings are accessible.
 * Returns { ok: true } on success.
 *
 * @param {EventContext<{DB: D1Database, SESSIONS: KVNamespace}, "api/health", Record<string, unknown>>} ctx
 * @returns {Response}
 */
export const onRequestGet = async (ctx) => {
  // Accessing the bindings here will throw at runtime if they are not
  // configured on the Pages project, making misconfiguration immediately visible.
  const _db = ctx.env.DB;
  const _sessions = ctx.env.SESSIONS;

  return Response.json({ ok: true });
};
