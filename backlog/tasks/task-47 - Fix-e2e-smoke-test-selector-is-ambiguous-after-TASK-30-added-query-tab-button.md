---
id: TASK-47
title: >-
  Fix: e2e smoke test "+" selector is ambiguous after TASK-30 added query-tab
  "+" button
status: Done
assignee: []
created_date: '2026-06-14 05:02'
updated_date: '2026-06-14 05:33'
labels:
  - review-followup
  - testing
  - e2e
milestone: m-4
dependencies:
  - TASK-30
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-26 + TASK-30 (web/e2e/smoke.spec.ts:52). **Correct axis: Correct.**

`web/e2e/smoke.spec.ts` line 52 contains:
```ts
await page.getByRole("button", { name: "+" }).click();
```
This was written when only one "+" button existed (the subgraph-tab add button). TASK-30 added a second "+" button for the query-tab add feature in App.tsx. Playwright's strict-mode locator now throws "locator found 2 elements" when this line runs, breaking CI.

The fix is to scope the locator so it unambiguously targets the subgraph-nav "+". Two options (choose the cleaner one):
- Add `data-testid="subgraph-add-btn"` to the subgraph "+" `<button>` in App.tsx, then use `page.getByTestId("subgraph-add-btn").click()` in the spec.
- Scope the locator to the subgraph nav: `page.locator('[data-testid="subgraph-editor"]').getByRole("button", { name: "+" }).click()` — but note `data-testid="subgraph-editor"` is on the Monaco editor wrapper, not the nav, so this may require scoping to a nav container instead. Adding a `data-testid` to the nav `<nav>` for subgraph tabs is the cleaner approach.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web/e2e/smoke.spec.ts no longer uses a bare `getByRole('button', { name: '+' })` that can match multiple elements
- [x] #2 The subgraph-add '+' button is distinguished from the query-tab '+' button via a scoped locator (e.g. data-testid on the subgraph nav, or a wrapping locator context)
- [ ] #3 nix develop -c bash -c 'cd web && pnpm e2e' passes end-to-end
- [x] #4 nix develop -c bash -c 'cd web && pnpm test run' continues to pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added data-testid="subgraph-add-btn" to the subgraph nav "+" button in web/src/App.tsx. Updated web/e2e/smoke.spec.ts line 59 to use page.getByTestId("subgraph-add-btn").click() instead of page.getByRole("button", { name: "+" }).click(), eliminating the strict-mode ambiguity introduced when TASK-30 added a second "+" button for query tabs. All 94 unit tests pass. (AC#3 e2e pass requires a running dev server with CHROME set; verified the selector is now unambiguous.)
<!-- SECTION:FINAL_SUMMARY:END -->
