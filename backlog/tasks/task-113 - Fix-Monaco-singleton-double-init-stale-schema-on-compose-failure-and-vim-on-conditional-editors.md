---
id: TASK-113
title: >-
  Fix Monaco singleton double-init, stale schema on compose failure, and vim on
  conditional editors
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 15:07'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 150000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In web/src/App.tsx the module-scope monacoGraphQLAPI is initialized lazily inside a debounced async compose callback (~56, ~647) — two rapid composes before the first resolves can both see null and double-initialize; it is never reset when composition fails, so a broken supergraph keeps a stale schema registered for completions/hovers; and the vim effect (~977, deps [vimMode, editor]) does not attach vim to the conditionally-mounted mock-config/query editors. Fix: guard singleton init against concurrency, clear/update the registered schema on compose failure, and attach vim per-editor on mount based on current vimMode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 rapid successive composes never double-initialize the monaco-graphql singleton
- [x] #2 a compose failure clears stale completions/hovers from the previous schema
- [x] #3 enabling vim then opening the mock-config editor attaches vim to it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

All three bugs live in the same ~30-line region of `web/src/App.tsx` (the debounced
compose effect around line 501-533, and the vim-attachment effect/onMount handlers
around line 842-868 and 1660-1707 / 1932-1980). They are tightly coupled to the same
editor-lifecycle code and ship together as a single atomic fix — no sub-tickets.

## Fix 1 — Guard the monaco-graphql singleton against concurrent composes (AC#1)

`monacoGraphQLAPI` (module scope, line 62) is lazily set inside the debounced
compose callback (line 508-509) with a plain `if (!monacoGraphQLAPI)` check. Because
the callback is `async` (`await loadCore()` at line 504) and a new debounce cycle's
timeout can *fire* while an earlier cycle's callback is still suspended on that
`await`, two overlapping invocations can race through the check. Fix by adding a
per-effect-invocation generation counter (a `useRef<number>` incremented at the top
of each timeout callback) so a callback that resumes after a newer compose has
already started discards its own result instead of touching `monacoGraphQLAPI` or
calling `setCompose`/`setComposeResult`. This both prevents double-init and prevents
a slower, stale compose from clobbering the schema registered by a newer one
(the same race in spirit, just for the schema content rather than the singleton
pointer).

```
const composeGenerationRef = useRef(0);
...
composeTimeoutRef.current = setTimeout(async () => {
  const generation = ++composeGenerationRef.current;
  const core = await loadCore();
  if (generation !== composeGenerationRef.current) return; // superseded — bail out
  const result = core.compose(subgraphs);
  ...
}, COMPOSE_DEBOUNCE_MS);
```

Keep the singleton-init line itself as `monacoGraphQLAPI ??= initializeMode();` for
clarity, now that only the freshest generation ever reaches it.

## Fix 2 — Clear stale schema on compose failure (AC#2)

In the `else` branch of the compose effect (currently line 525-527, only calls
`setComposeResult(null, result.errors, 0)`), also reset the monaco-graphql schema
config *if* a schema was previously registered:

```
} else {
  useWorkspace.getState().setComposeResult(null, result.errors, 0);
  monacoGraphQLAPI?.setSchemaConfig([]);
}
```

Guarding with `monacoGraphQLAPI?.` (rather than unconditionally initializing here)
preserves the existing behavior/test that `setSchemaConfig` is never called when
compose has never succeeded (see `App.test.tsx` "AC#3: does not call setSchemaConfig
when compose fails" — that test name is from an earlier, unrelated ticket's AC
numbering; do not confuse it with this ticket's AC#2/AC#3). Passing `[]` deregisters
all schemas so monaco-graphql's completion/hover providers return nothing until the
next successful compose re-registers a schema.

## Fix 3 — Attach vim to conditionally-mounted editors (AC#3)

`mockConfigEditorRef` and `queryEditorRef` (lines 318, 305) are plain refs populated
in `onMount` handlers for two mutually-exclusive `<Editor>` branches (mock-config vs.
query, each rendered twice — once in the mobile layout ~1660-1707, once in the
desktop layout ~1932-1980, all four gated by the same `showMockConfig` boolean).
Because these are refs, mounting a new editor does not re-render and does not
re-run the vim effect (deps `[vimMode, editor]`, line 868), so toggling
`showMockConfig` while vim is already enabled leaves the freshly-mounted editor
without vim keybindings.

Fix by attaching vim directly at mount time, based on the *current* `vimMode`, via a
small shared helper (defined in the component body, closing over `vimMode` and
`vimStatusBarRef`):

```
function attachVimOnMount(ed: _monaco.editor.IStandaloneCodeEditor) {
  if (!vimMode || !vimStatusBarRef.current) return;
  const vimInst = initVimMode(ed, vimStatusBarRef.current);
  vimDisposersRef.current.push(() => vimInst.dispose());
}
```

Call it from all four `onMount` handlers for the mock-config/query editors, right
after setting the ref:

```
onMount={(ed) => {
  mockConfigEditorRef.current = ed;
  queryEditorRef.current = null; // the other editor just unmounted
  attachVimOnMount(ed);
}}
```
(mirror for the query editor's `onMount`, clearing `mockConfigEditorRef.current`
instead). Clearing the sibling ref prevents the pre-existing hazard where the main
vim effect (line 852-856) would otherwise later call `initVimMode` on a stale,
already-disposed editor instance left behind by the ternary swap — since only one
of the two editors is ever mounted at a time, at most one of the two refs should
ever be non-null.

The existing centralized effect (line 844-868) is unchanged and still correctly
handles: (a) initial mount of the schema editor and whichever of query/mock-config
is showing, via its `[vimMode, editor]` deps firing after first mount, and
(b) turning vim on/off, which disposes everything in `vimDisposersRef` (including
disposers added by `attachVimOnMount`) and reattaches to whatever is currently
mounted.

## Testing

Add to `web/src/App.test.tsx` (co-located with the existing compose/vim-adjacent
tests):
- AC#1: with fake timers, trigger two rapid subgraph edits so two debounce cycles
  overlap (e.g. make the `./core` mock's `loadCore` resolve on separate
  microtask ticks so both callbacks are in-flight simultaneously), then assert
  `initializeMode` (already mocked at line 49-51) was called at most once.
- AC#2: render, let an initial compose succeed (`mockSetSchemaConfig` called once
  with the schema), then make `mockCompose` return `{ ok: false, ... }` and trigger
  a re-compose; assert `mockSetSchemaConfig` is called again with `[]`.
- AC#3: enable vim mode (`vimMode` toggled via the existing UI control), then toggle
  `showMockConfig` to mount the mock-config editor; assert `initVimMode` (mocked in
  `setupTests.tsx` line 78-81) was called with the mock-config editor instance.
  Use the existing `__editorTestHarness` pattern (see line 198) or the `Editor` mock
  to obtain a handle on the mounted instance if needed — check how other tests in
  this file (e.g. line 194-217) synthesize a mock editor object for onMount.

Run `cd web && npm run test -- App.test.tsx` (or the project's normal `npm test`)
plus `npm run lint` / `npm run typecheck` per AGENTS.md before finishing.

## Verification against Acceptance Criteria

- #1 rapid successive composes never double-initialize the singleton → Fix 1
  (generation counter short-circuits stale callbacks before they can reach the
  `monacoGraphQLAPI` check).
- #2 a compose failure clears stale completions/hovers from the previous schema →
  Fix 2 (`setSchemaConfig([])` on failure when a schema was previously registered).
- #3 enabling vim then opening the mock-config editor attaches vim to it → Fix 3
  (`attachVimOnMount` called from the mock-config/query `onMount` handlers).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented all three fixes in web/src/App.tsx per the plan:

1. Added a composeGenerationRef counter incremented at the top of each debounce
   timeout callback; after `await loadCore()` the callback bails out (before
   calling core.compose or touching monacoGraphQLAPI) if its generation was
   superseded by a newer compose cycle. Changed the singleton init to
   `monacoGraphQLAPI ??= initializeMode();`.
2. On compose failure, added `monacoGraphQLAPI?.setSchemaConfig([])` to
   deregister the stale schema so completions/hovers don't keep offering
   fields from a supergraph that no longer composes.
3. Added an `attachVimOnMount` helper (closes over vimMode/vimStatusBarRef/
   vimDisposersRef) called from all four mock-config/query editor onMount
   handlers (mobile + desktop layouts), which also null out the sibling ref
   so only one of mockConfigEditorRef/queryEditorRef is ever non-null at a
   time (avoids the centralized vim effect later touching a disposed stale
   editor instance).

Tests added/updated in web/src/App.test.tsx:
- "TASK-113 AC#1": drives two overlapping debounce cycles via a deferred
  loadCore() mock and asserts the superseded cycle never calls core.compose()
  a second time (asserting on mockInitializeMode call counts proved unreliable
  since the monaco-graphql singleton is module-scoped and persists across
  tests within the same file/worker, so composeCallCount deltas are used
  instead — a more direct assertion of the generation-guard behavior anyway).
- "TASK-113 AC#2": replaced the previously-existing (differently-scoped)
  "AC#3: does not call setSchemaConfig when compose fails" test, which
  asserted setSchemaConfig is never called on failure — that assumption no
  longer holds once a schema has been registered, which is exactly this
  ticket's fix. The new test lets an initial compose succeed, then fails a
  subsequent compose and asserts setSchemaConfig([]) is called.
- "TASK-113 AC#3": enables vim, switches to the mock-config editor (mounting
  it for the first time), invokes its recorded onMount from the test harness,
  and asserts initVimMode was called with that editor instance.

Also refactored the `./core` and `monaco-graphql/initializeMode` mocks in
App.test.tsx to use named, overridable vi.fn()s (mockLoadCore,
mockInitializeMode) so AC#1's race scenario could be constructed.

Verified: pnpm test run (406/406 passed), pnpm tsc --noEmit (clean), pnpm lint
(0 errors, 2 pre-existing unrelated warnings), pnpm prettier --check (clean).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed all three Monaco-related bugs in web/src/App.tsx: a generation-counter
guard now prevents overlapping debounced composes from double-initializing
the monaco-graphql singleton or letting a stale compose clobber a fresher
schema; a failed compose now deregisters the previously-registered schema
(setSchemaConfig([])) so completions/hovers don't keep suggesting fields from
a broken supergraph; and vim keybindings are now attached directly at mount
time for the conditionally-rendered mock-config/query editors (in addition to
the existing centralized effect), with sibling refs cleared to avoid touching
disposed stale editor instances. Added/updated tests for all three ACs; full
suite, typecheck, lint, and prettier all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
