---
id: TASK-26
title: Add component-test setup (jsdom) and a Playwright e2e smoke test
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 18:34'
labels:
  - planned
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
- [x] #1 Vitest uses the jsdom environment
- [x] #2 A Playwright e2e test drives compose -> query -> results and passes locally
- [x] #3 An e2e script exists and e2e is NOT in the pre-push hook
- [x] #4 The way Playwright is given a browser is documented in the task notes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

PRE-CHECKED (do nothing for these):
- AC#1 is already satisfied: web/vite.config.ts line 16 already has `environment: "jsdom"` and jsdom is already in devDependencies. Skip step 1 of the original plan entirely.

STEP 1 — Install Playwright
Run: nix develop -c bash -c "cd web && pnpm add -D @playwright/test"
Do NOT run `pnpm playwright install` — the Nix dev shell provides Chromium via the $CHROME env var (see STEP 2).

STEP 2 — Create web/playwright.config.ts
Create this file (at web/playwright.config.ts, not inside src/):

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:8001',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        executablePath: process.env.CHROME,
      },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 8001,
    reuseExistingServer: !process.env.CI,
  },
});
```

Key: `executablePath: process.env.CHROME` — the Nix dev shell sets CHROME=${pkgs.chromium}/bin/chromium. This tells Playwright to use the Nix-provided Chromium binary instead of downloading one. No download needed, no PLAYWRIGHT_BROWSERS_PATH tricks required.

STEP 3 — Create web/e2e/smoke.spec.ts
Create the directory and file. The test must drive compose -> query -> results:

```ts
import { test, expect, Page } from '@playwright/test';

const SUBGRAPH_1 = `
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

type Query {
  me: User
}

type User @key(fields: "id") {
  id: ID!
  name: String!
}
`.trim();

const SUBGRAPH_2 = `
extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

type Query {
  topProducts: [Product]
}

type Product @key(fields: "upc") {
  upc: String!
  title: String!
}
`.trim();

async function fillMonacoEditor(page: Page, dataPath: string, content: string) {
  await page.locator(`[data-path="${dataPath}"]`).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(content, { delay: 0 });
}

test('compose → query → results smoke test', async ({ page }) => {
  await page.goto('/');

  // Fill first subgraph SDL
  await fillMonacoEditor(page, 'sg-0', SUBGRAPH_1);

  // Add second subgraph
  await page.getByRole('button', { name: '+' }).click();

  // Fill second subgraph SDL
  await fillMonacoEditor(page, 'sg-1', SUBGRAPH_2);

  // Expand the Supergraph SDL pane and wait for composition
  const showButton = page.getByRole('button', { name: /Show/ });
  await showButton.click();
  await expect(page.locator('pre').filter({ hasText: 'type Query' })).toBeVisible({ timeout: 15000 });

  // Enter a query
  await fillMonacoEditor(page, 'query.graphql', '{ me { id name } }');

  // Run the query
  await page.getByRole('button', { name: 'Run' }).click();

  // Verify results panel shows JSON output
  const resultsSection = page.getByRole('heading', { name: 'Results' });
  await expect(resultsSection).toBeVisible();
  await expect(page.locator('pre').last()).toContainText('{', { timeout: 10000 });
});
```

STEP 4 — Add e2e script to web/package.json
Add to the scripts section: `"e2e": "playwright test"`

STEP 5 — Do NOT touch lefthook.yml
The pre-push hook (via lefthook.yml) runs `cargo test` and `pnpm test run`. Do NOT add an e2e entry there. E2E tests are slow and belong in CI only.

STEP 6 — Optionally add to CI
If .github/workflows/ci.yml exists, add a step after the existing web-test job:
```yaml
- name: E2E tests
  run: nix develop -c bash -c "cd web && pnpm e2e"
```
This is optional for this task — add it if CI exists and it's straightforward.

STEP 7 — Run and verify
nix develop -c bash -c "cd web && pnpm e2e"
The test must pass locally. If the Monaco editor fill is unreliable (race conditions), add a small `page.waitForTimeout(500)` after each fill — but prefer explicit `expect` waits over arbitrary sleeps.

STEP 8 — Update task notes with browser documentation
After completing the task, add a note documenting: "Playwright uses the Nix-provided Chromium binary via the CHROME environment variable set in flake.nix (CHROME=${pkgs.chromium}/bin/chromium). This is passed as executablePath in web/playwright.config.ts. No browser download (pnpm playwright install) is needed; running outside the Nix dev shell requires CHROME to point to a valid Chromium binary."

VERIFICATION GATES:
- nix develop -c bash -c "cd web && pnpm test run" must still pass (jsdom tests unaffected)
- nix develop -c bash -c "cd web && pnpm e2e" must pass
- nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint" must pass
- lefthook.yml must NOT have e2e in pre-push
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Browser configuration: Playwright uses the Nix-provided Chromium binary via the CHROME environment variable set in flake.nix (CHROME=${pkgs.chromium}/bin/chromium). This is passed as executablePath in web/playwright.config.ts projects[0].use.executablePath. No pnpm playwright install is needed inside the Nix dev shell. Running outside the shell requires CHROME to point to a valid Chromium binary.

Monaco 0.55.x uses class 'ime-text-area' (not 'inputarea') for its keyboard textarea, and that element is covered by .monaco-scrollable-element — direct click/type approaches fail. Solution: expose `window.__monaco = _monaco` in dev mode (import.meta.env.DEV guard) and use `monaco.editor.getEditors().find(e => container.contains(e.getContainerDomNode())).setValue(content)` in page.evaluate(). This sets the model value and fires onDidChangeContent, triggering @monaco-editor/react's onChange callback and the store update. Fallback: click .monaco-scrollable-element + Ctrl+A + keyboard.type().
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC#1 (jsdom) was already satisfied — web/vite.config.ts line 16 already had `environment: \"jsdom\"` from prior work; no action needed.

AC#2 — Playwright e2e test: Installed `@playwright/test 1.60.0`. Created `web/playwright.config.ts` using `launchOptions.executablePath: process.env.CHROME` (Nix flake sets CHROME to ${pkgs.chromium}/bin/chromium) so no browser download is needed. Created `web/e2e/smoke.spec.ts` with a smoke test that drives compose → query → results using two federation-v2.3 subgraphs (users + reviews) verified against the WASM compose function. Test uses `window.__monaco` (exposed in dev mode via `import.meta.env.DEV` guard in App.tsx) to call `editor.setValue()` directly — required because Monaco 0.55.x covers its `ime-text-area` with `.monaco-scrollable-element`, blocking Playwright's click actionability checks on the textarea. Added `data-testid=\"subgraph-editor\"` and `data-testid=\"query-editor\"` to App.tsx wrapper divs for reliable editor targeting. Also added `test.exclude: [\"e2e/**\"]` to vite.config.ts to prevent Vitest from picking up Playwright spec files.

AC#3 — e2e script added (`\"e2e\": \"playwright test\"` in web/package.json). lefthook.yml NOT modified.

AC#4 — Browser documentation is in task notes (CHROME env var from flake.nix → launchOptions.executablePath in playwright.config.ts).

Also added `- name: Web e2e tests` step to .github/workflows/ci.yml.

Verification gates all pass: 61 Vitest tests (4 files), `pnpm tsc --noEmit`, `pnpm lint`, `pnpm e2e` (1 test, 1.7s)."
<!-- SECTION:FINAL_SUMMARY:END -->
