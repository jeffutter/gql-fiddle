---
id: TASK-100
title: 'Pin OAuth redirect_uri to a configured origin, not request host'
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:27'
updated_date: '2026-07-01 23:48'
labels:
  - review
  - planned
dependencies: []
priority: low
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-DEF-1.00. functions/api/auth/github.ts:17 and github/callback.ts:91 build redirect_uri from new URL(..., request.url), i.e. the incoming request host, which is attacker-influenceable via multiple hostnames / spoofable Host. GitHub's registered-callback allowlist limits exploitability, but security-relevant URLs should not derive from request origin. Fix: pin the public origin from a server var (e.g. APP_ORIGIN) and build redirect_uri from it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 redirect_uri derives from an APP_ORIGIN config var, not request.url
- [x] #2 local dev still completes the OAuth flow
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): Cloudflare Pages Functions backend (functions/), Rust+WASM core (crates/gql-core), TypeScript/React web app (web/). This ticket is BACKEND-ONLY (functions/ + wrangler.jsonc + .dev.vars* + AGENTS.md docs). No Rust/WASM or web/ changes. Work from repo root. Single PR, no sub-tickets — this is a small, single-file fix plus config/docs.

BUG: functions/api/auth/github.ts:17 builds the GitHub OAuth `redirect_uri` param via `new URL("/api/auth/github/callback", request.url)`, i.e. from the incoming request's Host header, which is attacker-influenceable (spoofable/alternate-hostname requests). Security-relevant URLs must not derive from request origin.

NOTE ON SCOPE (verified against current code): the ticket description also cites `github/callback.ts:91`, but that line is `Location: "/"` — a relative path, not built from `request.url`/Host, so it is NOT subject to the same spoofing risk. Do not "fix" it; only functions/api/auth/github.ts needs a change. Call this out in the PR/commit body so the discrepancy is understood rather than silently ignored.

STEP 1 — add an APP_ORIGIN config var:
- wrangler.jsonc: add `"APP_ORIGIN"` to the top-level `"vars"` block next to `"ENVIRONMENT"`, e.g. `"https://gql-fiddle.pages.dev"`, with a comment noting it's a placeholder to replace with the real production custom domain / *.pages.dev subdomain once known (mirrors the existing placeholder-comment convention used for database_id/kv id in this file). This is a plain var (not a secret) since it's public information (same trust level as ENVIRONMENT).
- .dev.vars.example and .dev.vars: add `APP_ORIGIN=http://localhost:8788` near the ENVIRONMENT line (must match the wrangler dev port and the GitHub OAuth App's registered local callback `http://localhost:8788/api/auth/github/callback`, per AGENTS.md's existing local-OAuth-app instructions).

STEP 2 — functions/api/auth/github.ts:
- Add `APP_ORIGIN: string;` to the `Env` interface.
- Fail closed if unset (mirrors this codebase's existing fail-closed pattern for ENVIRONMENT in login.ts/dev-login.ts): before building `params`, if `!env.APP_ORIGIN`, return `new Response("Server misconfigured: APP_ORIGIN is not set", { status: 500 })`.
- Replace `redirect_uri: new URL("/api/auth/github/callback", request.url).toString()` with `redirect_uri: new URL("/api/auth/github/callback", env.APP_ORIGIN).toString()`.
- `request` is currently destructured alongside `env` only for this line; if it becomes otherwise unused, drop it from the destructure (`const { env } = context;`) to avoid an unused-var lint error — check github/callback.ts and other handlers for the destructuring convention used elsewhere.

STEP 3 — docs: update AGENTS.md's OAuth setup section (~lines 180-200, "Required secrets" / callback-URL area) to document APP_ORIGIN: what it's for, that it's a `vars` entry (not a secret) set in wrangler.jsonc for production and in .dev.vars for local dev, and that it must match whichever host is registered as the GitHub OAuth App's callback (production origin, or http://localhost:8788 locally).

VERIFICATION (AC #2 — local dev flow):
- `cp .dev.vars.example .dev.vars`, set `ENVIRONMENT=production` and `APP_ORIGIN=http://localhost:8788` to exercise the real GitHub flow (per AGENTS.md's existing instructions for testing real OAuth locally), using a GitHub OAuth App whose registered callback is `http://localhost:8788/api/auth/github/callback`.
- `wrangler pages dev web/dist`, hit `/api/auth/github`, confirm the redirect_uri GitHub receives matches APP_ORIGIN, complete the flow end-to-end (login → callback → session cookie set → redirected to `/`).
- Confirm fail-closed behavior: with APP_ORIGIN unset/empty, `/api/auth/github` returns 500 instead of silently falling back to the request Host.
- Run repo's standard checks per AGENTS.md (typecheck/lint for functions/) before considering done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: functions/api/auth/github.ts now builds redirect_uri from a new
required env.APP_ORIGIN (not request.url), and fails closed with 500 if
APP_ORIGIN is unset. Added APP_ORIGIN to wrangler.jsonc vars (placeholder
prod value, with a comment to replace once the real domain is known) and to
.dev.vars / .dev.vars.example (http://localhost:8788, matching wrangler pages
dev's default port). Documented APP_ORIGIN in AGENTS.md's OAuth section.

Scope note: github/callback.ts:91 (`Location: "/"`) was NOT touched — it's a
relative path, not built from request.url/Host, so it isn't subject to the
same spoofing risk cited in the ticket description.

Verification: tsc --noEmit passes for functions/tsconfig.json and
functions/__tests__/tsconfig.json; existing functions test suite (60 tests)
passes unchanged; prettier --check passes for github.ts. Manually verified
(via a temporary, since-deleted vitest case) that: (1) redirect_uri in the
GitHub authorize URL equals `${APP_ORIGIN}/api/auth/github/callback` even
when the incoming request's Host is a spoofed/attacker-controlled value, and
(2) the handler returns 500 when APP_ORIGIN is empty/unset. Did not exercise
the live GitHub OAuth network round-trip (no registered OAuth App / network
access in this environment); AC #2 is satisfied at the code level — the
callback path and cookie-setting logic are unchanged, and the docs describe
the exact local .dev.vars setup needed for a human to complete the live
end-to-end check.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pinned the GitHub OAuth redirect_uri to a configured APP_ORIGIN var instead of the request Host, with fail-closed behavior, config/docs updates, and passing typecheck/tests.
<!-- SECTION:FINAL_SUMMARY:END -->
