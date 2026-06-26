interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

// GET /api/health — liveness probe that also verifies D1 + KV bindings resolve.
export const onRequestGet: PagesFunction<Env> = (context) => {
  const { env } = context;
  return Response.json({
    ok: true,
    bindings: {
      db: env.DB !== undefined,
      sessions: env.SESSIONS !== undefined,
    },
  });
};
