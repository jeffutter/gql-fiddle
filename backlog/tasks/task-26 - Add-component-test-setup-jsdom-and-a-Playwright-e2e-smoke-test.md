---
id: TASK-26
title: Add component-test setup (jsdom) and a Playwright e2e smoke test
status: To Do
assignee: []
created_date: '2026-06-06 20:20'
updated_date: '2026-06-08 18:39'
labels: []
milestone: m-4
dependencies:
  - TASK-19
  - TASK-32
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add browser-like testing: switch Vitest to jsdom for component tests, and add one end-to-end Playwright test that drives the real app through the core flow (compose -> query -> results).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Vitest uses the jsdom environment
- [ ] #2 A Playwright e2e test drives compose -> query -> results and passes locally
- [ ] #3 An e2e script exists and e2e is NOT in the pre-push hook
- [ ] #4 The way Playwright is given a browser is documented in the task notes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Add jsdom: nix develop -c bash -c "cd web && pnpm add -D jsdom". In web/vite.config.ts set test.environment back to "jsdom".
2. Add Playwright: nix develop -c bash -c "cd web && pnpm add -D @playwright/test", plus a playwright config and a test under web/e2e/.
   IMPORTANT: Playwright needs a browser. Headless Chrome is available from the Nix flake — configure Playwright to use the system Chrome/Chromium (via channel or executablePath) instead of downloading one. Record exactly what you used in this task's notes.
3. The e2e test must: use Playwright webServer to run "pnpm dev", open the app, enter two subgraphs, confirm the Supergraph pane shows composed output, type a query, click Run, and confirm the Results panel shows data.
4. Add an "e2e": "playwright test" script to web/package.json.
5. Run it once and make it pass. Do NOT add e2e to the pre-push git hook (it is slow) — it belongs in CI only. You may add it to .github/workflows/ci.yml.
<!-- SECTION:PLAN:END -->
