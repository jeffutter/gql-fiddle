---
id: TASK-95.1
title: Surface decryption failures instead of returning ciphertext as plaintext
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 20:01'
labels:
  - review
  - planned
dependencies: []
parent_task_id: TASK-95
priority: high
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/encryption.ts:133-145 decrypt() returns the original value unchanged when aesGcmDecrypt returns null (wrong key / tampering / truncation). For a CE1:/E1: value this hands the raw ciphertext string back to the sync layer as if it were plaintext, which then JSON.parses to garbage or aborts the whole pull, and can surface ciphertext as a workspace name. Fix: distinguish 'has a known prefix (CE1:/E1:) but decryption failed' (surface an error / skip the row, never treat as plaintext) from 'no prefix' (genuine legacy plaintext).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a CE1: value that fails to decrypt yields a surfaced error or skipped row, never the raw ciphertext
- [x] #2 legacy no-prefix plaintext still round-trips
- [x] #3 a unit test covers wrong-key decryption
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

web/src/encryption.ts decrypt() (lines 133-145) returns the raw ciphertext
string unchanged whenever aesGcmDecrypt() returns null for a CE1:/E1: value.
The only caller, decryptRow() in web/src/sync.ts (line 106-112), then treats
that string as trusted plaintext: it flows into rowToEntry() as a workspace
`name`, or gets JSON.parse()'d as a `payload`, either surfacing raw ciphertext
in the UI or throwing a JSON parse error that currently aborts the whole
pullWorkspaces() batch (since decryptRow calls are awaited via Promise.all).

## Fix

### 1. web/src/encryption.ts — throw instead of silently passing through

- Add and export a `DecryptionError` class (extends Error) so callers can
  distinguish "known prefix, decrypt failed" from other failures.
- In decrypt(): when `value.startsWith(COMPRESSED_PREFIX)` or
  `value.startsWith(PREFIX)` and `aesGcmDecrypt` returns null, `throw new
  DecryptionError(...)` instead of `return value`.
- No-prefix values still fall through to `return value` unchanged (legacy
  plaintext contract preserved — AC #2).
- Update the doc comment above decrypt() to describe the new throwing
  contract instead of "returns original value unchanged if decryption fails".

### 2. web/src/sync.ts — skip failed rows instead of failing the whole pull

- `pullWorkspaces()` currently does
  `await Promise.all(data.workspaces.map((row) => decryptRow(key, row)))`,
  which rejects entirely if any single row throws. Change to
  `Promise.allSettled(...)`, then:
  - push `result.value` for each `"fulfilled"` entry into the returned `rows`
  - for each `"rejected"` entry, `console.error("Sync: skipping workspace
    <id> — decryption failed", result.reason)` and omit it from `rows`
    (matches the existing `console.error("Sync: ...")` convention already
    used at lines 216/273/337/358 in this file)
- Leave the server-provided `cursor` untouched — advance normally even when a
  row is skipped, consistent with the existing cursor contract (never
  re-derived client-side).
- `pushWorkspace()`'s two direct `decryptRow(key, ...)` calls (echo of a row
  we just pushed) are left as-is: if decrypt throws there it propagates up to
  `autoSave`'s existing try/catch (`console.error("Sync: auto-save failed",
  err)`), which already satisfies "surface an error, never plaintext" for
  that path without new code.
- decryptRow() itself is unchanged — it already just awaits decrypt() inline,
  so a thrown DecryptionError naturally rejects the decryptRow() promise for
  Promise.allSettled to catch.

## Tests

- web/src/encryption.test.ts: add a case that decrypts a CE1: ciphertext with
  the wrong AES-GCM key and asserts it rejects with `DecryptionError`
  (`await expect(decrypt(wrongKey, ciphertext)).rejects.toThrow(DecryptionError)`)
  — satisfies AC #3. Keep the existing "passes legacy plaintext through
  unchanged" test as-is to guard AC #2.
- web/src/sync-encryption.integration.test.ts: add an integration case
  (real crypto, following the existing `fetch` mock pattern in this file)
  where the mocked `/api/workspaces` GET returns one row with a corrupted/
  wrong-key CE1: value alongside one valid row, and assert:
  - the resulting store state contains only the valid workspace (the
    corrupted row's ciphertext never appears as a name or payload anywhere
    in `useWorkspace.getState().workspaces`)
  - `console.error` was called (spy) rather than the pull throwing/aborting

## Verification

- `cd web && pnpm test run encryption.test.ts sync.test.ts sync-encryption.integration.test.ts`
- `pnpm tsc --noEmit`
- `pnpm lint`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned:

1. web/src/encryption.ts: added exported DecryptionError class. decrypt()
   now throws DecryptionError when a CE1:/E1:-prefixed value fails AES-GCM
   decryption (aesGcmDecrypt returns null), instead of silently returning
   the raw ciphertext. No-prefix values still fall through unchanged
   (legacy plaintext contract preserved). Updated the doc comment to
   describe the new throwing contract.

2. web/src/sync.ts: pullWorkspaces() now uses Promise.allSettled instead of
   Promise.all over decryptRow() calls. Rejected rows (decryption failures)
   are logged via console.error("Sync: skipping workspace <id> —
   decryption failed", reason) and omitted from the returned rows; the
   server cursor still advances normally. pushWorkspace()'s two decryptRow
   calls are left as-is — a thrown DecryptionError there propagates to
   autoSave's existing try/catch, which already logs and surfaces the
   error without treating ciphertext as plaintext.

3. Tests:
   - web/src/encryption.test.ts: new test encrypts with one key and
     decrypts with a different key, asserting decrypt() rejects with
     DecryptionError (AC #3). Existing "passes legacy plaintext through
     unchanged" test continues to guard AC #2.
   - web/src/sync-encryption.integration.test.ts: new integration test
     ("skips a row that fails to decrypt instead of surfacing its
     ciphertext") wraps a known DEK with a known KWK, mocks GET
     /api/workspaces to return one valid row and one row with a tampered
     CE1: ciphertext, and asserts: only the valid workspace ends up in
     useWorkspace state, the corrupted ciphertext never appears anywhere
     in the serialized state, and console.error was called identifying the
     skipped row — without the pull throwing/aborting (AC #1).

Verification: `pnpm test run` (390/390 passing), `pnpm tsc --noEmit` (no
errors), `pnpm lint` (0 errors/warnings across the repo).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
decrypt() now throws a DecryptionError for CE1:/E1: values that fail AES-GCM
decryption instead of returning the ciphertext as if it were plaintext.
pullWorkspaces() skips such rows (logging via console.error) rather than
aborting the whole sync pull. Legacy no-prefix plaintext still round-trips
unchanged. Covered by a new unit test (wrong-key decrypt rejects with
DecryptionError) and a new integration test (mixed valid/corrupted rows —
only the valid workspace surfaces, corrupted ciphertext never leaks into
state).
<!-- SECTION:FINAL_SUMMARY:END -->
