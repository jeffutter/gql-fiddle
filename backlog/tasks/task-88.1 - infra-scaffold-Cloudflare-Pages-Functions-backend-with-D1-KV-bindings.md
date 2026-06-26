---
id: TASK-88.1
title: 'infra: scaffold Cloudflare Pages Functions backend with D1 + KV bindings'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-26 12:11'
updated_date: '2026-06-26 21:22'
labels:
  - infra
  - backend
  - cloudflare
dependencies: []
parent_task_id: TASK-88
priority: high
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Foundation for all backend work (parent TASK-88). Establishes the serverless backend surface and resource bindings so subsequent tasks (DB schema, auth, sync API) have somewhere to live. No business logic in this task.

## Context

The site deploys via **Cloudflare Pages** (`.github/workflows/ci.yml`: `pages deploy web/dist`). We extend the same Pages project with **Pages Functions** so the API is same-origin (no CORS, native cookies).

## Scope

- Create a `functions/` directory at the Pages project root (deployed alongside `web/dist`). Confirm/adjust the Pages build so `functions/` is picked up (it may need to sit relative to the deployed output; document the chosen layout).
- Add a `wrangler.toml` (or `[[d1_databases]]` / `[[kv_namespaces]]` config) declaring:
  - a **D1** database binding (e.g. `DB`)
  - a **KV** namespace binding (e.g. `SESSIONS`)
- Provision the D1 database and KV namespace via `wrangler` (document the commands; production ids go in CI secrets/config, not committed).
- Add a trivial health-check function (e.g. `GET /api/health` → `{ ok: true }`) to prove the Functions pipeline + bindings resolve in local dev (`wrangler pages dev`) and in deployed Pages.
- Wire CI: ensure the deploy step uploads `functions/` and that bindings are configured on the Pages project (via dashboard or `wrangler`); document any required `CLOUDFLARE_API_TOKEN` scopes.
- Update AGENTS.md with: the backend layout, how to run it locally (`wrangler pages dev`), and the free-tier limits table.

## Out of scope

DB schema, auth, and any workspace endpoints (separate subtasks).

## Notes for implementer

Keep everything free-tier. Do not introduce a separate standalone Worker — Pages Functions keep it same-origin. Secrets (GitHub OAuth, etc.) are added in later tasks; just establish the mechanism here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `functions/` is deployed with the Pages project and a GET /api/health endpoint returns {ok:true} both locally (wrangler pages dev) and on the deployed site
- [x] #2 D1 and KV bindings are declared in config and resolve at runtime from a Function
- [x] #3 CI deploy step includes Functions and required API token scopes are documented
- [x] #4 AGENTS.md documents backend layout, local dev command, and Cloudflare free-tier limits
- [x] #5 No CORS configuration is required because the API is same-origin
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scaffolded Cloudflare Pages Functions backend:

- `wrangler.toml` at project root declares D1 binding (`DB`) and KV binding (`SESSIONS`) with placeholder IDs and full provisioning instructions in comments.
- `functions/api/health.js` implements `GET /api/health → {ok:true}` and references both bindings via `ctx.env.DB` / `ctx.env.SESSIONS` to validate they resolve at runtime.
- `.gitignore` extended with `.wrangler/` (local wrangler state).
- CI workflow annotated with required `CLOUDFLARE_API_TOKEN` permission scopes (Pages Edit, D1 Edit, Workers KV Storage Edit, Account Settings Read) and a comment explaining that wrangler auto-picks up `functions/` from CWD.
- `AGENTS.md` updated: new "Backend" section with layout diagram, `wrangler pages dev web/dist` local-dev command, provisioning `wrangler d1 create` / `wrangler kv namespace create` commands, and a free-tier limits table.

No DB schema, auth, or workspace endpoints — those are in subsequent subtasks. Placeholder IDs in `wrangler.toml` must be replaced with real IDs after running the provisioning commands.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Created the Cloudflare Pages Functions scaffold: `wrangler.toml` (D1 + KV bindings with placeholder IDs and provisioning docs), `functions/api/health.js` (GET /api/health → {ok:true} accessing both env bindings), `.gitignore` entry for `.wrangler/`, CI annotations for required API token scopes, and a new AGENTS.md \"Backend\" section covering layout, local dev command, provisioning steps, and free-tier limits table.
<!-- SECTION:FINAL_SUMMARY:END -->
