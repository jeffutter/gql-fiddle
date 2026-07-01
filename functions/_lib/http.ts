// Shared HTTP response helpers so every endpoint returns errors in one
// consistent JSON shape, and so no unhandled exception ever surfaces as
// Cloudflare's default 500 HTML page (which can leak internal error text).
import { logEvent } from "./log";

/** The one way error responses are built: `{ error: message }` as JSON. */
export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Wrap a Pages Function handler so any thrown error is logged (server-side
 * only, full detail) and converted into a generic JSON 500 — never the raw
 * error message, which may embed internal identifiers (see functions/_lib/db.ts).
 */
export function withErrorHandling<Env>(
  handler: PagesFunction<Env>,
): PagesFunction<Env> {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      logEvent("unhandled_error", {
        path: new URL(context.request.url).pathname,
        message: err instanceof Error ? err.message : String(err),
      });
      return jsonError("Internal error", 500);
    }
  };
}
