---
id: TASK-128.2
title: >-
  Surface workspace decryption failures to the user instead of silently showing
  default workspace
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-08 00:32'
updated_date: '2026-08-08 00:44'
labels:
  - planned
  - bug
  - sync
  - encryption
dependencies: []
documentation:
  - web/src/sync.ts
  - web/src/auth.ts
  - web/src/App.tsx
  - TASK-128
parent_task_id: TASK-128
priority: high
type: bug
ordinal: 166000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`pullWorkspaces` (`web/src/sync.ts:122`) already detects per-row decryption
failures and collects their ids into `skippedIds`, but every caller
(`onLogin`, `deltaRefresh`) only ever `console.error`s and otherwise
proceeds as if nothing happened — including calling
`setSyncStatus("synced")` on login even when rows were silently dropped. If
every row on the account fails to decrypt (e.g. a KWK/wrapped_dek
mismatch), the merged workspace list is empty and the user is shown a
fresh default workspace with the green "synced" indicator, indistinguishable
from a genuinely-new account. This is the UI half of the report in the
parent ticket (TASK-128) — independent of whatever is causing decryption to
fail (TASK-128's sibling sub-ticket addresses one specific root cause; this
covers the "never fail silently" acceptance criterion generally, including
any other decrypt failure — corruption, tampering, a future regression).

## Fix

Surface a dismissible, visible warning whenever a pull reports non-empty
`skippedIds`, following the exact pattern already used for
`liveSessionError` in `web/src/App.tsx` (a `callout callout--error
callout--inline` banner with a Dismiss button) — this codebase's existing
convention for this kind of transient, dismissible, error-level notice.

Full design already worked out against the current source
(`web/src/auth.ts`, `web/src/sync.ts`, `web/src/App.tsx`) — see the
Implementation Plan field.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When pullWorkspaces reports any skippedIds (rows that failed to decrypt), the user sees a visible, dismissible banner naming the count and explaining data was not deleted, both on login and on a later delta refresh
- [x] #2 The banner clears automatically once a subsequent pull reports no skipped rows, and never leaks across a logout/login boundary to a different user on the same browser
- [x] #3 Regression tests cover: warning appears on login with a skipped row, warning stays clear when nothing is skipped, warning appears on a delta refresh that skips a row even when it pulls zero new rows, and warning clears once the row starts decrypting successfully
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## 1. web/src/auth.ts — add `decryptWarning` to the auth store

```ts
export interface AuthState {
  user: User | null;
  status: AuthStatus;
  syncStatus: SyncStatus;
  decryptWarning: string | null;
  setAuth: (user: User | null) => void;
  setSyncStatus: (s: SyncStatus) => void;
  setDecryptWarning: (message: string | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  syncStatus: "synced",
  decryptWarning: null,
  setAuth: (user) => set({ user, status: user ? "authed" : "anonymous" }),
  setSyncStatus: (s) => set({ syncStatus: s }),
  setDecryptWarning: (message) => set({ decryptWarning: message }),
}));
```

In `logout()`, clear it alongside the existing `clearCachedKey()` call so a
warning from one logged-in user never bleeds into the next user's session
on a shared browser:

```ts
} finally {
  useAuth.getState().setAuth(null);
  useAuth.getState().setDecryptWarning(null);
  clearCachedKey();
}
```

## 2. web/src/sync.ts — set the warning wherever `skippedIds` is non-empty

Add a small helper near the top of the "Delta refresh" section (or inline —
whichever reads more naturally; two call sites, both need the exact same
message shape):

```ts
function decryptWarningMessage(skippedCount: number): string {
  return (
    `${skippedCount} workspace${skippedCount === 1 ? "" : "s"} could not be ` +
    `loaded because ${skippedCount === 1 ? "it" : "they"} failed to decrypt ` +
    `on this device. This can happen when a workspace was saved with a ` +
    `different encryption key (e.g. from another device). Your data has ` +
    `not been deleted — it may still be recoverable from the device it was ` +
    `saved on.`
  );
}
```

(Adjust exact wording during implementation for clarity/tone — the key
requirement is: names the count, says explicitly the data is NOT deleted,
and gives the user a next step. Keep it a single sentence or two, matching
the terseness of the existing `liveSessionError` copy in App.tsx.)

Call sites — always set (not just when non-empty), so a resolved failure
clears the banner on the next successful pull:

- `onLogin` (~line 264): after `const { rows, cursor, skippedIds } = await
  pullWorkspaces(0);`, add
  `useAuth.getState().setDecryptWarning(skippedIds.size > 0 ?
  decryptWarningMessage(skippedIds.size) : null);`
- `deltaRefresh` (~line 221): destructure `skippedIds` too (currently only
  `rows, cursor` are destructured) and set the same way. Note
  `deltaRefresh` currently returns early when `rows.length === 0` — the
  warning must be set *before* that early return, otherwise a delta pull
  that skips rows but pulls nothing new would never surface the warning.

Both call sites already have `useAuth.getState().setSyncStatus(...)`
nearby — do not conflate `syncStatus` (the small connectivity-style
indicator dot) with `decryptWarning` (the banner); they answer different
questions ("is sync currently working?" vs "was something silently
dropped?") and should stay independent, matching how `liveSessionError` is
already independent of the live-session connection-status dot in App.tsx.

## 3. web/src/App.tsx — render the banner

Destructure `decryptWarning` alongside the existing `syncStatus` read
(~line 391): `const { user, status: authStatus, syncStatus, decryptWarning
} = useAuth();`

Add a banner following the exact `liveSessionError` pattern (~line 1530),
placed near it for consistency:

```tsx
{/* Workspace decryption warning (TASK-128) */}
{decryptWarning && (
  <div className="callout callout--error callout--inline">
    {decryptWarning}
    <button
      onClick={() => useAuth.getState().setDecryptWarning(null)}
      className="btn"
    >
      Dismiss
    </button>
  </div>
)}
```

No new CSS needed — `callout`, `callout--error`, `callout--inline` already
exist and are used for `liveSessionError`.

## 4. Tests

### web/src/sync.test.ts
The module mocks `./encryption`'s `decrypt` as an unconditional pass-through
(`decrypt: (_key, text) => Promise.resolve(text)`). Change it to a
conditional stub that throws a `DecryptionError` for a sentinel payload, so
individual tests can opt a specific row into "fails to decrypt" without
touching the real crypto:

```ts
vi.mock("./encryption", () => ({
  initEncryption: () => Promise.resolve(),
  getOrCreateKey: () => Promise.resolve({}),
  encrypt: (_key: unknown, text: string) => Promise.resolve(text),
  decrypt: (_key: unknown, text: string) => {
    if (text === "UNDECRYPTABLE") {
      return Promise.reject(new Error("Failed to decrypt value"));
    }
    return Promise.resolve(text);
  },
}));
```

Add a helper (near `makeRow`) for a row that will fail decryption, e.g.
`makeUndecryptableRow(id: string)` returning a row whose `payload` is
`"UNDECRYPTABLE"`.

New tests:
- "onLogin sets decryptWarning when a pulled row fails to decrypt" — mock
  the `/api/workspaces?since=0` fetch to return one normal row and one
  `makeUndecryptableRow`, call the exported login flow (however the
  existing tests trigger it — check `initSync`'s exported test hook /
  existing "pull-on-login" tests in this file for the established pattern),
  assert `useAuth.getState().decryptWarning` is a non-null string
  mentioning the skipped count.
- "onLogin does not set decryptWarning when all rows decrypt successfully"
  — regression guard, asserts `decryptWarning` stays `null`.
- "deltaRefresh sets decryptWarning when a delta row fails to decrypt, even
  when it also pulls zero new normal rows" — covers the early-return
  ordering note above: mock a delta response containing only the
  undecryptable row, call `deltaRefresh(true)`, assert `decryptWarning` is
  set.
- "deltaRefresh clears a previous decryptWarning once the row decrypts
  successfully" — seed `useAuth.setState({ decryptWarning: "stale" })`
  first, then run a `deltaRefresh` whose response has no skipped rows,
  assert `decryptWarning` becomes `null`.

Reset `decryptWarning: null` in the existing `resetStores()` helper's
`useAuth.setState(...)` call (~line 62) alongside `syncStatus`, so it
doesn't leak between tests.

### web/src/App.test.tsx (check current coverage first)
Grep for how the existing `liveSessionError` banner is tested (rendering +
Dismiss button) and mirror that pattern for `decryptWarning`: set
`useAuth.setState({ status: "authed", decryptWarning: "test message" })`,
render `App`, assert the banner text appears; click Dismiss, assert
`useAuth.getState().decryptWarning === null` and the banner unmounts. If no
direct precedent exists for `liveSessionError` in this file (it may be
local `useState`, untestable the same way), a simpler smoke test —
asserting the banner renders when `decryptWarning` is set on the store, and
is absent when `null` — is sufficient; don't force a Dismiss-interaction
test if the existing test setup for this file makes it disproportionately
awkward relative to the other new tests in this ticket.

## Verification

- `nix develop -c bash -c "cd web && pnpm test run"` (sync.test.ts,
  App.test.tsx, full suite)
- `nix develop -c bash -c "cd web && pnpm tsc --noEmit"`
- `nix develop -c bash -c "cd web && pnpm lint"`
- Manually sanity-check the banner copy reads clearly and doesn't imply the
  workspace is permanently lost (it may still be recoverable, especially
  once the sibling root-cause sub-ticket ships).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the plan: added `decryptWarning: string | null` + `setDecryptWarning` to the `useAuth` zustand store (web/src/auth.ts), cleared alongside `setAuth(null)` in `logout()` so it never leaks across a logout/login boundary. Added `decryptWarningMessage()` + `applyDecryptWarning()` helpers in web/src/sync.ts and called them unconditionally (so a resolved failure clears a stale banner) from both `onLogin` and `deltaRefresh` — in `deltaRefresh`, the call is placed before the `rows.length === 0` early return so a delta pull that skips a row but pulls zero new rows still surfaces the warning. Rendered the banner in web/src/App.tsx following the exact `liveSessionError` callout--error callout--inline + Dismiss button pattern, placed directly below it. Reused the existing CSS classes — no new styles needed.

Tests: web/src/sync.test.ts — changed the mocked `decrypt` to a conditional stub that rejects for a sentinel "UNDECRYPTABLE" payload, added a `makeUndecryptableRow` helper, reset `decryptWarning: null` in `resetStores()`, and added a `decryptWarning` describe block covering all four scenarios from AC #3 (login sets warning on a skipped row, login leaves it null when nothing is skipped, deltaRefresh sets it even with zero new rows, deltaRefresh clears a stale warning). web/src/App.test.tsx has no prior precedent for testing the (real, unmocked) `useAuth` store directly, so added a new `App decryptWarning banner` describe block that sets `useAuth.setState({ decryptWarning })` directly and asserts render/absence/Dismiss-click behavior — mirrors the store-driven pattern already used for `useWorkspace` elsewhere in that file.

Verification: `pnpm test run` (459/459 passing), `pnpm tsc --noEmit` (clean), `pnpm lint` (clean — the only 2 warnings are pre-existing react-hooks/exhaustive-deps warnings in useGraphQLPipeline.ts, unrelated to this change).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a dismissible `callout callout--error callout--inline` banner (matching the existing `liveSessionError` pattern) that surfaces whenever `pullWorkspaces` reports skipped (undecryptable) rows, on both login and delta refresh. A new `decryptWarning` field on the `useAuth` store holds the message, is set unconditionally on every pull (so it self-clears once decryption starts succeeding again), is set before `deltaRefresh`'s early return (so a skip-only delta pull still surfaces it), and is cleared on logout so it can't leak to a different user on a shared browser. Covered by new regression tests in sync.test.ts (login/delta, warning set/cleared) and App.test.tsx (banner render/absence/dismiss). Full suite, tsc, and lint all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
