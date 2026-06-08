---
id: TASK-32
title: 'Fix: the web test suite is red (8 failures) — make pnpm test run green'
status: Needs Plan
assignee: []
created_date: '2026-06-08 18:38'
updated_date: '2026-06-08 18:43'
labels:
  - review-followup
milestone: m-1
dependencies:
  - TASK-8
  - TASK-29
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-8/9/29. The committed web suite fails: 'nix develop -c bash -c "cd web && pnpm test run"' reports 8 failed | 25 passed, yet the Final Summaries of TASK-8, 9, 10 and 29 all claim tests pass (Correct + Resilient: the verification step is not catching failures). Two independent root causes: (A) web/src/setupTests.tsx adds a global vi.mock('./core') that only stubs compose(); this clobbers src/core/index.test.ts (TASK-7's real-loader tests), so core.validateSubgraph is undefined, the cached-instance check fails, and the real-composition assertion gets empty SDL — 5 failures. App.test.tsx already declares its own complete vi.mock('./core') (line 26), so the global one is both redundant and harmful. (B) TASK-29 added a useEffect in web/src/App.tsx (lines 62-66) that calls editor.focus(); three TASK-9 validation tests construct bare mock editors with only getModel and no focus, so onMount throws 'editor.focus is not a function', crashing before validation markers are set — 3 failures + uncaught exceptions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/src/setupTests.tsx no longer globally mocks ./core (the global vi.mock('./core') block is removed); App.test.tsx keeps its own ./core mock
- [ ] #2 src/core/index.test.ts passes (all 6 tests) — it exercises the real loadCore against the mocked ../wasm/gql_core.js
- [ ] #3 The three App validation tests no longer throw 'editor.focus is not a function' (mock editors include focus)
- [ ] #4 nix develop -c bash -c "cd web && pnpm test run" reports 0 failing tests and 0 unhandled errors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

ROOT CAUSE A — global ./core mock breaks core/index.test.ts:
1. Open web/src/setupTests.tsx. Delete ONLY the block that reads:
     // Mock the WASM core module so tests never attempt a fetch to localhost:3000.
     vi.mock('./core', () => ({ loadCore: vi.fn(() => Promise.resolve({ compose: () => ({ ok: true, supergraph_sdl: '', hints: [] }) })) }));
   Leave the monaco-editor and @monaco-editor/react mocks, the unhandledRejection handler, the queryCommandSupported polyfill, and the __editorTestHarness setup intact.
2. Do NOT touch App.test.tsx — it already has its own complete vi.mock('./core') at the top (compose, validateSubgraph, validateQuery, plan, executeMock), which still overrides the module for that file.
3. Run: nix develop -c bash -c 'cd web && pnpm test run src/core/index.test.ts' and confirm all 6 tests pass.

ROOT CAUSE B — editor.focus crashes validation tests:
4. In web/src/App.test.tsx, find the three bare mock editors declared as 'const mockEditor = { getModel: vi.fn(() => mockModel) };' (in the tests: 'fixing the error clears the underline', 'debounces validation so rapid keystrokes trigger only one validateSubgraph call', and 'typing invalid SDL shows a red underline at the correct position within ~300ms'). Add 'focus: vi.fn(),' to each of these mock editor objects so the App focus effect (App.tsx:62-66) does not throw when onMount is invoked.
5. Run: nix develop -c bash -c 'cd web && pnpm test run src/App.test.tsx' and confirm 0 failures and no 'editor.focus is not a function' uncaught exceptions.

VERIFY EVERYTHING:
6. Run: nix develop -c bash -c 'cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run'. All must pass with 0 failing tests.
<!-- SECTION:PLAN:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: TASK-32 — Fix web test suite (8 failures)

## Summary
The 8 test failures stem from two independent root causes. **Root Cause A**: a global `vi.mock('./core')` in `setupTests.tsx` clobbers the real-loader tests in `src/core/index.test.ts`, producing 5 failures. **Root Cause B**: three App validation tests declare bare mock editors missing `focus()`, crashing when `App.tsx` lines 62–66 invoke `editor.focus()` in a `useEffect`, producing 3 failures + uncaught exceptions. The prescribed fixes are surgical and low-risk: delete the global mock block, and add `focus: vi.fn()` to three mock editor objects.

## Findings

1. **Root Cause A — global `vi.mock` clobbers per-file real tests.** Vitest hoists every `vi.mock()` call to the top of its file and applies it before any imports execute (Vitest transforms static imports into dynamic ones via `__handle_mock__`). When `setupTests.tsx` declares `vi.mock('./core', ...)`, that mock becomes active for *every* test file in the project, including `src/core/index.test.ts`, which needs the real `loadCore` implementation. The fix — deleting the global block — is correct because `App.test.tsx` already defines its own complete `vi.mock('./core')` with all five exports (`compose`, `validateSubgraph`, `validateQuery`, `plan`, `executeMock`). [Source](https://github.com/vitest-dev/vitest/blob/main/docs/guide/mocking/modules.md)

2. **Vitest module mocking mechanics confirm the fix is safe.** Vitest's `vi.mock` is file-scoped (hoisted within each test file). A mock declared in a setup file applies globally, but mocks declared inside individual test files override for that file only. Importantly, Vitest does *not* cascade per-file mocks into other files — so removing the global mock will not affect `App.test.tsx`'s own mock, and no other test file should depend on it (the task description states it was added as a convenience but is redundant). [Source](https://github.com/vitest-dev/vitest/blob/main/docs/guide/mocking.md)

3. **Gotcha: do not import `./core` before the mock in setupTests.tsx.** If any other setup file or test utility imports `./core` before Vitest processes the `vi.mock`, the real module gets cached and `vi.mock` becomes a no-op (or throws in newer Vitest versions). The current global mock was already "working" for most tests because it ran first, but it broke `core/index.test.ts`. Removing it eliminates this class of bug entirely. [Source](https://github.com/vitest-dev/vitest/issues/10104)

4. **Root Cause B — Monaco Editor `focus()` is a required instance method.** The Monaco Editor `IEditor` interface (the object returned by `editor.create()`) exposes methods including `focus()`, `getModel()`, `getValue()`, `layout()`, `dispose()`, and many others. When `App.tsx` calls `editor.focus()` in its `onMount` callback, any test that provides a bare mock `{ getModel: vi.fn(...) }` will throw `TypeError: editor.focus is not a function`. Adding `focus: vi.fn()` to each of the three failing test mocks is the minimal correct fix. [Source](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IEditor.html)

5. **Alternative approaches considered and rejected:**
   - *Fix in App.tsx instead (guard `editor.focus?.()`)* — Would hide the real bug (incomplete mocks) rather than fix it. The tests should be correct; the production code already assumes a valid editor instance.
   - *Use `vi.spyOn` on `./core` exports instead of replacing the module* — Overly complex for this use case; `vi.mock` is the standard pattern and works correctly when scoped to individual test files.
   - *Add `focus` to a shared mock factory* — Possible, but the three mocks are in different tests with different model setups; adding `focus: vi.fn()` inline is simpler and more explicit.

6. **Verification order matters.** Run `src/core/index.test.ts` first (confirms Root Cause A fix), then `src/App.test.tsx` (confirms Root Cause B fix), then the full suite (`pnpm test run`). This isolates which root cause any remaining failure belongs to. TypeScript check (`tsc --noEmit`) and linting should pass since no new code is added — only a deletion and one property addition per mock.

## Sources
- **Vitest Mocking Guide** (https://github.com/vitest-dev/vitest/blob/main/docs/guide/mocking.md) — How `vi.mock` hoisting works, setup file behavior, and module mocking mechanics
- **Vitest Module Mocking Deep Dive** (https://github.com/vitest-dev/vitest/blob/main/docs/guide/mocking/modules.md) — Per-file vs global mock scoping, `importOriginal`, pitfalls
- **Vitest Issue #10104: vi.mock ignored when pre-loaded via setupFiles** (https://github.com/vitest-dev/vitest/issues/10104) — Confirms the cached-module gotcha
- **Monaco Editor IEditor API Reference** (https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IEditor.html) — Full list of editor instance methods including `focus()`, `getModel()`, `dispose()`

## Gaps
- Exact Vitest version in use: the behavior of `vi.mock` in setup files changed between 1.x and 2+ (newer versions throw when a mock is called after module load). The repo's `package.json` should be checked to confirm which behavior applies. Suggested next step: `cd web && cat package.json | grep vitest`.
- Whether any *other* test files besides `App.test.tsx` and `core/index.test.ts` depend on the global `./core` mock. The task description implies it was only used by App tests (which have their own mock), but a quick `grep -r "from '\./core'" web/src/**/*.test.*` would confirm no other consumers exist.
- Whether `editor.focus()` needs to be called in any specific order relative to `getModel()` or if there are side effects worth testing (e.g., does `focus()` trigger validation?). The current fix (`vi.fn()`) silences the crash but doesn't verify behavior — acceptable for a regression fix, but worth noting.

<!-- SECTION:NOTES:END -->
