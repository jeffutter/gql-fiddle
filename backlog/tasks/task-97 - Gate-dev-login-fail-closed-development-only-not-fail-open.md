---
id: TASK-97
title: 'Gate dev-login fail-closed (development only), not fail-open'
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:27'
updated_date: '2026-07-01 23:22'
labels:
  - review
  - planned
dependencies: []
priority: high
ordinal: 118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-ACC-1.00, SEC-DEF-1.00. functions/api/auth/dev-login.ts:24 returns 404 only when ENVIRONMENT === 'production' and otherwise mints a full 30-day session for an attacker-chosen synthetic user with no auth. Cloudflare Pages preview/branch deployments frequently do not inherit production vars, so ENVIRONMENT may be undefined there and the bypass is live on preview URLs. Fix: invert to fail-closed — serve dev-login only when ENVIRONMENT === 'development' (or a dedicated ALLOW_DEV_LOGIN flag), 404 otherwise; verify preview-deployment env.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 dev-login returns 404 when ENVIRONMENT is unset or any value other than 'development'
- [x] #2 local dev with ENVIRONMENT=development still mints a session
- [x] #3 a test covers the ENVIRONMENT-unset (preview) case
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

Two endpoints share the same fail-open pattern, both keyed off `ENVIRONMENT`:

- `functions/api/auth/dev-login.ts:24` — 404s only when `ENVIRONMENT === "production"`; mints a full session otherwise (including when unset).
- `functions/api/auth/login.ts:11-12` — routes to `/api/auth/dev-login` unless `ENVIRONMENT === "production"` (same fail-open default).

Cloudflare Pages preview/branch deployments only inherit the `vars.ENVIRONMENT = "production"` set in `wrangler.jsonc` on the production branch; preview builds get `ENVIRONMENT` unset, so both endpoints currently fail open on preview URLs. Fixing only `dev-login.ts` without also fixing `login.ts` would leave `/api/auth/login` redirecting previews into a dead-end 404 (login.ts still fail-open, dev-login.ts fail-closed) — so both must flip together to keep the login flow coherent.

## Implementation

1. **`functions/api/auth/dev-login.ts`**: invert the guard to fail-closed:
   ```ts
   if (ctx.env.ENVIRONMENT !== "development") {
     return new Response("Not found", { status: 404 });
   }
   ```
   Update the file's header comment (currently says "Gated on ENVIRONMENT !== production") to describe the new development-only gate.

2. **`functions/api/auth/login.ts`**: apply the same fail-closed default so the unified redirect never routes an unrecognized environment into the (now 404ing) dev bypass:
   ```ts
   const isDevelopment = ctx.env.ENVIRONMENT === "development";
   const target = isDevelopment ? "/api/auth/dev-login" : "/api/auth/github";
   ```
   Update the header comment (currently: "routes to ... GitHub (production) or the dev bypass (development/local)" implying dev is the default) to state GitHub OAuth is now the default/fail-closed target.

3. **`functions/__tests__/dev-auth.test.ts`**: update to match the new fail-closed defaults:
   - `GET /api/auth/login`: change the "redirects to /api/auth/dev-login when ENVIRONMENT is unset" case — unset must now redirect to `/api/auth/github`. Keep the `ENVIRONMENT=development` case as still redirecting to dev-login.
   - `GET /api/auth/dev-login`: add a case for `ENVIRONMENT` unset (the preview scenario) asserting 404, alongside the existing `ENVIRONMENT=production` → 404 case. Keep the `ENVIRONMENT=development` → 302 + session-cookie case.
   - This directly covers AC #1 (unset/other → 404), #2 (development → session), #3 (unset/preview case tested).

4. **`AGENTS.md`**: update the auth-flow description (~line 121, 127, 233-235) to state the fail-closed default: unset or any non-"development" value now routes to GitHub OAuth / 404s the dev-login endpoint; only `ENVIRONMENT=development` enables the bypass.

5. **`.dev.vars.example`**: fix the stale comment on `ENVIRONMENT=development` — it currently claims this is "the default when unset"; after this fix that's no longer true (unset now fails closed), so the comment should say development mode requires the value to be set explicitly.

## Verification

- `cd web && pnpm test:functions` (or `pnpm vitest run --config vitest.functions.config.ts`) — all `dev-auth.test.ts` cases pass, including the new unset→404 case.
- Manually confirm local dev still works: `.dev.vars` already sets `ENVIRONMENT=development` explicitly, so `wrangler pages dev web/dist` continues to mint a session at `/api/auth/dev-login`.
- No `ALLOW_DEV_LOGIN`-style new flag is introduced — reusing the existing `ENVIRONMENT` var (now allow-listed to exactly `"development"`) is sufficient and avoids adding a second knob that could itself be misconfigured.

## Scope note

Single tightly-coupled fix across 2 small source files + 1 test file + 2 doc comments — no sub-tickets needed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Flipped dev-login.ts and login.ts to fail-closed on ENVIRONMENT: dev-login.ts now 404s unless ENVIRONMENT === "development" (was: 404 only in production); login.ts now redirects to GitHub unless ENVIRONMENT === "development" (was: dev-login unless production). Updated dev-auth.test.ts to cover the unset/preview case for both endpoints and flipped the "unset" expectation for login.ts to GitHub. Updated AGENTS.md and .dev.vars.example comments to describe the new fail-closed default and remove the stale "default when unset" claim. Verified with `pnpm test:functions` (57/57 passing) and `tsc --noEmit` on functions/tsconfig.json and functions/__tests__/tsconfig.json.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Inverted the dev-login gate to fail-closed: /api/auth/dev-login now 404s unless ENVIRONMENT is exactly "development" (previously fail-open, 404ing only when ENVIRONMENT === "production", which meant unset ENVIRONMENT — the default on Cloudflare Pages preview/branch deployments — minted a full session for any visitor). /api/auth/login was flipped the same way so the login redirect and dev-login gate stay coherent for previews. Added a test covering the unset/preview case for both endpoints and updated docs (AGENTS.md, .dev.vars.example) to reflect the fail-closed default.
<!-- SECTION:FINAL_SUMMARY:END -->
