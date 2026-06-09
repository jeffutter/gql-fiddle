---
id: TASK-34
title: >-
  Fix: composition error banner drops errors that share a code (React key
  collision)
status: Done
assignee:
  - developer
created_date: '2026-06-08 18:39'
updated_date: '2026-06-09 03:43'
labels:
  - review-followup
milestone: m-1
dependencies:
  - TASK-10
priority: high
ordinal: 120
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-10 (web/src/App.tsx:193-197). The error banner renders one <div> per composition error with key={e.code}. Federation composition routinely emits multiple errors with the SAME code (e.g. several SATISFIABILITY_ERROR or INVALID_FIELD_SHARING). Duplicate React keys make React drop/merge siblings, so not every error renders — violating TASK-10 AC#3 ('an error banner with each code and message'). Axis: Correct.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When compose() returns multiple errors sharing the same code, every error line is rendered in the banner
- [x] #2 A new App.test.tsx case returns two errors with the same code and asserts both messages appear
- [x] #3 nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run" passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. In web/src/App.tsx (around line 193-197), change the error banner map so the React key uses the array index instead of e.code: `compose.errors.map((e, i) => (<div key={i} ...>{`${e.code}: ${e.message}`}</div>))`. Index keys are safe here because the list is fully replaced on each compose and never reordered in place.
2. Add a test in web/src/App.test.tsx: make mockCompose return `{ ok: false, errors: [{ code: 'SATISFIABILITY_ERROR', message: 'first' }, { code: 'SATISFIABILITY_ERROR', message: 'second' }] }`, render, advance past the debounce, and assert both `screen.getByText(/first/)` and `screen.getByText(/second/)` are present.
3. Run: `nix develop -c bash -c 'cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run'`.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed React key collision in the composition error banner by switching from key={e.code} to key={i} (array index), which ensures all errors render even when multiple share the same federation error code like SATISFIABILITY_ERROR. Added two dedicated test cases verifying both duplicate-code errors appear independently in the rendered banner. All quality gates pass: 13 Rust tests, 36 web tests, clean fmt/clippy/TSC/lint.
<!-- SECTION:FINAL_SUMMARY:END -->
