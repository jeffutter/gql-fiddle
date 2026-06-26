// GET /api/auth/login — unified redirect that routes to the appropriate auth
// flow based on the runtime environment. The frontend always navigates here;
// the server decides whether to use GitHub OAuth (production) or the dev
// bypass (development/local). This keeps the frontend unaware of which auth
// provider is active.
interface Env {
  ENVIRONMENT?: string;
}

export const onRequestGet: PagesFunction<Env> = (ctx) => {
  const isProduction = ctx.env.ENVIRONMENT === "production";
  const target = isProduction ? "/api/auth/github" : "/api/auth/dev-login";
  return Response.redirect(new URL(target, ctx.request.url).toString(), 302);
};
