// GET /api/auth/login — unified redirect that routes to the appropriate auth
// flow based on the runtime environment. The frontend always navigates here;
// the server decides whether to use GitHub OAuth (the fail-closed default) or
// the dev bypass (only when ENVIRONMENT === "development"). This keeps the
// frontend unaware of which auth provider is active, and ensures unset or
// unrecognized environments (e.g. Cloudflare Pages previews) never route into
// the dev bypass.
import { withErrorHandling } from "../../_lib/http";

interface Env {
  ENVIRONMENT?: string;
}

export const onRequestGet: PagesFunction<Env> = withErrorHandling((ctx) => {
  const isDevelopment = ctx.env.ENVIRONMENT === "development";
  const target = isDevelopment ? "/api/auth/dev-login" : "/api/auth/github";
  return Response.redirect(new URL(target, ctx.request.url).toString(), 302);
});
