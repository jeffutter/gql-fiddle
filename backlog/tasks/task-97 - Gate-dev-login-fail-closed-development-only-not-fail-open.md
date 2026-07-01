---
id: TASK-97
title: 'Gate dev-login fail-closed (development only), not fail-open'
status: Backlog
assignee: []
created_date: '2026-07-01 00:27'
labels:
  - review
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
- [ ] #1 dev-login returns 404 when ENVIRONMENT is unset or any value other than 'development'
- [ ] #2 local dev with ENVIRONMENT=development still mints a session
- [ ] #3 a test covers the ENVIRONMENT-unset (preview) case
<!-- AC:END -->
