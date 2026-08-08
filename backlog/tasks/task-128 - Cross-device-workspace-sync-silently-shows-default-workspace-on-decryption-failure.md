---
id: TASK-128
title: >-
  Cross-device workspace sync silently shows default workspace on decryption
  failure
status: Blocked
assignee: []
created_date: '2026-08-07 14:04'
updated_date: '2026-08-08 00:33'
labels:
  - bug
  - sync
  - encryption
  - planned
dependencies:
  - TASK-128.1
  - TASK-128.2
documentation:
  - web/src/sync.ts
  - web/src/encryption.ts
  - TASK-118
priority: high
type: bug
ordinal: 164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Report

User worked in a workspace while logged in on device A. Later, logging in as the same account on a different (new) device B did not bring down the workspace from device A — device B showed the default workspace instead, as if the account had no saved data.

Device B's browser console showed:

```
Sync: skipping workspace 9208f432-a5b3-47f5-8b60-231029334e4d — decryption failed DecryptionError: Failed to decrypt value
```

So this is not a missed pull — the server row was fetched, but failed to decrypt on device B and was silently dropped (`pullWorkspaces` in `web/src/sync.ts:122`, which logs via `console.error` and adds the id to `skippedIds` rather than surfacing anything to the user). The result looks identical to data loss from the user's point of view.

## Why this points at the key-wrapping flow

A decryption failure on a *different device, same account* means the DEK device B derived doesn't match the DEK device A encrypted with — i.e. the two devices disagree on the wrapped DEK and/or the KWK used to unwrap it (see `web/src/encryption.ts` "Two-layer key system", `initEncryption()`).

`initEncryption()` (`web/src/encryption.ts:93`) has a specific silent fallback for exactly this disagreement: if the server has a `wrapped_dek` but the fetched KWK fails to decrypt it (`aesGcmDecrypt` returns null, line 108-116), it comments "KWK/wrapped_dek mismatch (e.g. race on first login) — keep local key" and falls back to a locally-generated key that has no relationship to the server's key. Device B would then never be able to decrypt any of device A's rows, and (if it also had nothing local) would default to a fresh empty workspace — matching the symptom reported here.

TASK-118 fixed a race in `getOrCreateKwk` that could let two devices *simultaneously logging in for the first time* generate and keep two different KWKs. This report describes a sequential login (device A used the account first, device B logged in later), and TASK-118's fix does not include any repair path for accounts whose KWK/wrapped_dek pair was already left mismatched by that race (or another cause) before the fix landed — so an already-corrupted account would keep silently failing to decrypt on every new device indefinitely, exactly as reported here.

## Desired outcome

- Root-cause why this account's device B could not decrypt device A's workspace, and fix the underlying key-mismatch (whether that's a residual gap in the TASK-118 race fix, a separate bug, or a pre-existing corrupted key pair for this account that needs a recovery path).
- A logged-in user's workspaces reliably show up when logging in from a new device, given no concurrent first-login race.
- When decryption does fail, the user should not be silently shown what looks like an empty/default account — surface this as a visible error/warning instead of swallowing it to the console only, so a real failure doesn't masquerade as data loss.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Logging in on a new device as an existing logged-in user reliably restores that user's previously-saved workspaces (repro: create a workspace on device A, log in as the same account on a fresh device B, confirm the workspace appears)
- [ ] #2 The root cause of the KWK/wrapped_dek mismatch causing DecryptionError is identified and fixed, or, if it stems from pre-existing corrupted data predating TASK-118's fix, a recovery path is added so affected accounts stop failing indefinitely
- [ ] #3 When a workspace row fails to decrypt during pull/sync, the user is shown a visible error or warning rather than silently ending up on an unrelated default workspace with no indication anything went wrong
- [ ] #4 Regression test coverage added for the specific failure path (KWK fails to unwrap an existing wrapped_dek) in addition to the race already covered by TASK-118
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause (see TASK-128.1 for full detail)

`migrations/0002_users_wrapped_dek.sql` (the original encryption feature)
predates `migrations/0003_users_kwk.sql` (TASK-118, 2026-07-02) by over a
month. Migration 0003 added `users.kwk` as a bare nullable column with no
backfill from the pre-existing `kwk:<user_id>` KV entries. Any account that
had already finished key setup (had a `wrapped_dek` in D1) before TASK-118
shipped got a brand-new, unrelated KWK auto-generated in D1 the next time
any device called `GET /api/auth/enc-meta` — permanently orphaning that
account's `wrapped_dek`. This is additive to, not a residual gap in,
TASK-118's concurrent-first-login race fix (confirmed via `git log`
against `functions/api/auth/enc-meta.ts` and the migration timestamps).

This is not a hypothesis needing further research — it was verified against
current source and git history during planning, and the fix design below
was validated against all the relevant code paths (`functions/_lib/db.ts`,
`functions/api/auth/enc-meta.ts`, `web/src/encryption.ts`,
`web/src/sync.ts`, `web/src/auth.ts`, `web/src/App.tsx`).

## Why this split into two sub-tickets

The work naturally separates into two independently shippable,
independently testable pieces that don't need each other to be individually
valuable:

- **TASK-128.1** — the actual root-cause fix + recovery path (AC #1, #2,
  most of #4). Server offers a legacy KWK candidate; only the browser can
  prove which key actually unwraps `wrapped_dek` (the server never sees
  the plaintext DEK), so the client tries the fallback and, on success,
  confirms it back to the server for permanent repair. This is the piece
  that makes the reported repro (workspace `9208f432-...`) actually work
  again.
- **TASK-128.2** — visible decrypt-failure warning (AC #3, rest of #4).
  Independently useful defense-in-depth: even after TASK-128.1 ships, any
  *other* decrypt failure (genuine corruption, tampering, a future
  regression) should never again silently masquerade as an empty account.
  Touches an almost entirely disjoint set of files (`auth.ts` store,
  `sync.ts` caller sites, `App.tsx` banner) from TASK-128.1's crypto/key
  plumbing.

These are not tightly coupled — TASK-128.1 makes the *specific* reported
failure stop happening; TASK-128.2 makes *any* remaining or future failure
visible instead of silent. Either can ship without the other providing
partial, real value, which is why they're separate tickets rather than one
ticket bundling backend crypto changes with unrelated frontend UI wiring.

## Sequencing

No hard ordering between TASK-128.1 and TASK-128.2 — they touch different
files and can be implemented/reviewed in either order or in parallel. Both
must land before this parent is done (AC #1-#4 span both).

## Integration / final verification (after both sub-tickets are Done)

1. Confirm both sub-tickets' individual verification steps passed (each
   ticket's own plan lists its `pnpm test:functions` / `pnpm test run` /
   `tsc` / `lint` runs).
2. Run the full suite once more from a clean state to catch any
   cross-ticket interaction:
   - `nix develop -c bash -c "cd web && pnpm test:functions"`
   - `nix develop -c bash -c "cd web && pnpm test run"`
   - `nix develop -c bash -c "cd web && pnpm tsc --noEmit"`
   - `nix develop -c bash -c "cd web && pnpm lint"`
3. Manually re-read the combined diff end-to-end once: the
   `legacy_kwk`/`confirm_kwk` round trip (TASK-128.1) and the
   `decryptWarning` banner (TASK-128.2) should compose correctly — e.g. an
   account that self-heals via TASK-128.1 on login should never trip
   TASK-128.2's banner for that same pull (decryption succeeds before
   `pullWorkspaces` ever adds the row to `skippedIds`), and an account that
   is genuinely unrecoverable (neither `kwk` nor `legacy_kwk` unwraps
   `wrapped_dek`) should show TASK-128.2's banner instead of a silent
   default workspace.
4. Re-check acceptance criteria #1-#4 against the shipped behavior:
   - #1: manually reason through / re-verify the device-A-then-device-B
     repro is fixed by TASK-128.1's mechanism.
   - #2: root cause documented above and in TASK-128.1; recovery path
     shipped there.
   - #3: banner shipped in TASK-128.2.
   - #4: regression tests listed in both sub-tickets' plans.
5. Update this parent ticket's Implementation Notes / Final Summary
   referencing both sub-tickets once they're Done, per the standard
   finalization workflow.

## Known residual limitation (accepted, not blocking)

An account that both (a) raced two devices on first login *before*
TASK-118 shipped, *and* (b) had the losing device's in-memory KWK never
persisted anywhere recoverable, has no automated recovery path — neither
the current D1 `kwk` nor the legacy KV entry actually matches what
`wrapped_dek` was wrapped under in that specific double-corruption
scenario, and the server has no way to reconstruct a value that was never
durably stored anywhere. TASK-128.2's visible warning is the safety net for
this remaining edge case: the user sees a clear "could not be loaded"
message instead of silent data loss, even though the account cannot
self-heal automatically. This is called out explicitly rather than left as
an implicit gap — if it turns out to affect real accounts, it would need
its own follow-up ticket with a different approach (e.g. manual account
recovery flow), which is out of scope here.
<!-- SECTION:PLAN:END -->
