---
id: TASK-100
title: 'Pin OAuth redirect_uri to a configured origin, not request host'
status: Backlog
assignee: []
created_date: '2026-07-01 00:27'
labels:
  - review
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
- [ ] #1 redirect_uri derives from an APP_ORIGIN config var, not request.url
- [ ] #2 local dev still completes the OAuth flow
<!-- AC:END -->
