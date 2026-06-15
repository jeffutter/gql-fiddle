---
id: TASK-52
title: 'CI: cache pnpm store for web-checks and e2e jobs'
status: To Do
assignee: []
created_date: '2026-06-15 12:11'
labels:
  - ci
  - infra
dependencies:
  - TASK-50
priority: medium
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `web-checks` and `e2e` jobs (from TASK-50) each run `pnpm install --frozen-lockfile` from scratch. Add caching for pnpm's content-addressable store (the path returned by `pnpm store path`, typically `~/.local/share/pnpm/store`), keyed on `web/pnpm-lock.yaml`'s hash with a restore-key fallback. This lets `pnpm install` reuse previously-fetched packages (Monaco, Mermaid, Playwright, Vite, etc.) instead of re-downloading the full dependency tree on every run.

Note: Playwright's e2e tests launch via `process.env.CHROME` (Nix-provided Chromium, see `web/playwright.config.ts`), so no separate Playwright browser-binary cache is needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web-checks and e2e jobs cache the pnpm store keyed on web/pnpm-lock.yaml's hash, with a restore-key fallback
- [ ] #2 pnpm install --frozen-lockfile reuses cached packages on an unchanged lockfile, verified via the Actions log showing a cache hit and reduced install time
- [ ] #3 The pnpm cache is named/scoped so it doesn't collide with the Cargo caches from TASK-51
<!-- AC:END -->
