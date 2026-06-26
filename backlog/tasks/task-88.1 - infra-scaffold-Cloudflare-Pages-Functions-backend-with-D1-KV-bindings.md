---
id: TASK-88.1
title: 'infra: scaffold Cloudflare Pages Functions backend with D1 + KV bindings'
status: To Do
assignee: []
created_date: '2026-06-26 12:11'
updated_date: '2026-06-26 21:14'
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
- [ ] #1 `functions/` is deployed with the Pages project and a GET /api/health endpoint returns {ok:true} both locally (wrangler pages dev) and on the deployed site
- [ ] #2 D1 and KV bindings are declared in config and resolve at runtime from a Function
- [ ] #3 CI deploy step includes Functions and required API token scopes are documented
- [ ] #4 AGENTS.md documents backend layout, local dev command, and Cloudflare free-tier limits
- [ ] #5 No CORS configuration is required because the API is same-origin
<!-- AC:END -->
