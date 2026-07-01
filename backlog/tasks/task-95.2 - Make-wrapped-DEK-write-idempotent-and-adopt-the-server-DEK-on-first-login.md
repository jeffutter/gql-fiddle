---
id: TASK-95.2
title: Make wrapped-DEK write idempotent and adopt the server DEK on first login
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 20:11'
labels:
  - review
  - planned
dependencies:
  - TASK-95.1
parent_task_id: TASK-95
priority: high
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/encryption.ts:96-111 persists the freshly-generated wrapped DEK via a fire-and-forget PUT /api/auth/enc-meta whose response is never checked. Two devices racing first-login each generate a different DEK; the loser keeps encrypting under a DEK the server no longer maps, producing permanently undecryptable workspaces (compounded by the silent-plaintext bug in ENC.1). Fix: make the server enc-meta PUT idempotent (only set wrapped_dek if currently null, otherwise return the existing wrapped_dek), and have the client adopt the server's returned wrapped DEK rather than assuming its own won. Server (functions/api/auth/enc-meta.ts) + client change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 two simulated first-login devices converge on a single DEK
- [x] #2 the losing device adopts the winner's wrapped DEK and can decrypt prior uploads
- [x] #3 the enc-meta PUT is idempotent server-side (only sets wrapped_dek when null)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

Two devices racing first login each generate their own DEK, wrap it with the
shared per-user KWK, and PUT it to `/api/auth/enc-meta`. `setWrappedDek`
(functions/_lib/db.ts:172) unconditionally overwrites `users.wrapped_dek`, so
whichever PUT lands last wins server-side — and the client
(web/src/encryption.ts:96-105) never checks the PUT response, so the loser
keeps encrypting under a DEK the server no longer maps. Its uploads become
permanently undecryptable by any other device.

## Fix

### 1. functions/_lib/db.ts — conditional write + read-back

Replace `setWrappedDek` with `setWrappedDekIfAbsent(db, userId, wrappedDek):
Promise<string>` (no other caller exists — grepped, only enc-meta.ts uses it):

```ts
export async function setWrappedDekIfAbsent(
  db: D1Database,
  userId: string,
  wrappedDek: string,
): Promise<string> {
  await db
    .prepare(
      "UPDATE users SET wrapped_dek = ? WHERE id = ? AND wrapped_dek IS NULL",
    )
    .bind(wrappedDek, userId)
    .run();

  const current = await getWrappedDek(db, userId);
  if (current === null) {
    throw new Error(
      `wrapped_dek missing after setWrappedDekIfAbsent (user_id=${userId})`,
    );
  }
  return current;
}
```

The `WHERE ... AND wrapped_dek IS NULL` guard makes the first writer to reach
the UPDATE the only one whose value sticks; a racing second UPDATE becomes a
no-op because the column is no longer null. Both callers then read back
whatever is now stored, so every caller — winner or loser — resolves to the
same value. Correctness relies on D1/SQLite serializing individual
statements, which is already an existing assumption elsewhere in this file
(e.g. `upsertWorkspace`'s conditional `ON CONFLICT ... WHERE`).

Doc-comment `setWrappedDekIfAbsent` explaining this idempotent/race-safe
contract (mirroring the style of the `listWorkspaces`/`upsertWorkspace` doc
comments already in this file).

### 2. functions/api/auth/enc-meta.ts — return the winning wrapped_dek

`onRequestPut`: call `setWrappedDekIfAbsent` instead of `setWrappedDek`, and
respond with the stored value instead of a bare 204:

```ts
const stored = await setWrappedDekIfAbsent(ctx.env.DB, user.id, wrapped_dek);
return Response.json({ wrapped_dek: stored });
```

(Status becomes 200 via `Response.json`, replacing the old `204 No Content` —
callers now need the body.)

### 3. web/src/encryption.ts — adopt the server's returned DEK on first login

In `initEncryption()`'s "first device" branch (currently lines 96-106):
after PUTting the generated `wrapped`, read the JSON response's
`wrapped_dek` and compare it to what we sent. If they differ, we lost the
race — unwrap the server's value with the KWK we already have and use those
bytes as `dekBytes` instead of our own generated ones (mirrors the
"existing wrapped_dek" unwrap branch just above it, reusing `aesGcmDecrypt`).
If the PUT fails (non-ok / network) or the response's DEK fails to unwrap
under our KWK (should not happen since it's wrapped with the same KWK, but
guard defensively), keep our own generated `dekBytes` as today — no
regression versus the current fire-and-forget behavior for the offline case.

```ts
} else {
  // First device for this user: generate DEK, wrap it, send to server.
  dekBytes = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await aesGcmEncrypt(kwk, new TextEncoder().encode(toBase64(dekBytes)));
  const putRes = await fetch("/api/auth/enc-meta", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wrapped_dek: wrapped }),
  });
  if (putRes.ok) {
    const { wrapped_dek: winningWrapped } = (await putRes.json()) as { wrapped_dek: string };
    if (winningWrapped !== wrapped) {
      // Lost the race to another device — adopt its DEK instead of our own.
      const dekRaw = await aesGcmDecrypt(kwk, winningWrapped);
      if (dekRaw) dekBytes = fromBase64(new TextDecoder().decode(dekRaw));
    }
  }
}
```

No change needed to the "existing wrapped_dek present" branch (lines 87-95)
— that already unwraps and falls back to the local key on mismatch.

## Tests

### functions/__tests__/db.test.ts
- Rename the `setWrappedDek` describe/tests to `setWrappedDekIfAbsent`.
- Update "stores and retrieves wrapped_dek" to assert the function's return
  value equals what was stored.
- Replace "overwrites a previously stored wrapped_dek" with a test asserting
  the SECOND call is a no-op: call with `"E1:first=="` then `"E1:second=="`,
  assert both calls' return values are `"E1:first=="` and
  `getWrappedDek` still returns `"E1:first=="` afterward.

### functions/__tests__/enc-meta.test.ts
- "returns 204 and stores the wrapped_dek" → update to expect `status 200`
  and `body.wrapped_dek === "E1:realWrapped=="`.
- "overwrites a previously stored wrapped_dek" → replace with "second PUT is
  a no-op and both callers get the first-stored wrapped_dek": PUT
  `"E1:first=="`, then PUT `"E1:second=="`; assert the second response body's
  `wrapped_dek` is `"E1:first=="` (not `"E1:second=="`), and a subsequent GET
  also returns `"E1:first=="`. This directly covers AC #3.

### web/src/encryption.test.ts
- Update "generates and stores a wrapped DEK when server has none" — the PUT
  mock currently returns `new Response(null, { status: 204 })`; change it to
  echo back the captured body as `Response.json({ wrapped_dek: <captured> })`
  with status 200, matching the new server contract.
- Add a new test: "adopts the server's wrapped DEK when it loses the
  first-login race" — mock GET to return `wrapped_dek: null` (so the client
  takes the "first device" branch), mock PUT to return a **different**
  wrapped DEK than the one the client generated (simulating another device
  winning the race), wrapped with the same KWK around a known DEK. After
  `initEncryption()`, assert `getOrCreateKey()` produces a key that decrypts
  data encrypted with that known (winning) DEK — i.e. the loser adopted the
  winner's key, not its own. Covers AC #1/#2 from the client side.

### web/src/sync-encryption.integration.test.ts
- Both existing PUT mocks (`new Response(null, { status: 204 })` at two call
  sites) must be updated to `Response.json({ wrapped_dek: <the body's own
  wrapped_dek> }, { status: 200 })` so `initEncryption()` doesn't throw
  parsing a null body as JSON.
- Add an integration-level test simulating two devices: a tiny in-memory
  fake server state (`let storedWrappedDek: string | null = null`) shared by
  a single `fetch` mock, so two independent `initEncryption()` calls (as if
  two browser tabs/devices) both hit the same conditional-write logic that
  `setWrappedDekIfAbsent` implements server-side (first PUT sets it, second
  PUT's mock returns the already-stored value unchanged). After both
  `initEncryption()` calls resolve, assert workspace data encrypted by
  "device A" decrypts correctly using "device B"'s resulting key (requires
  two separate module instances or two directly-constructed CryptoKey
  results via `getOrCreateKey()`/`initEncryption()` sequence, following the
  existing pattern of re-deriving keys from captured wrapped/KWK bytes used
  in "unwraps an existing wrapped DEK from the server"). Satisfies AC #1/#2
  end-to-end.

## Verification

- `nix develop -c bash -c "cd web && pnpm test run encryption.test.ts sync-encryption.integration.test.ts"`
- `nix develop -c bash -c "pnpm test run"` (functions test suite, covers db.test.ts / enc-meta.test.ts)
- `nix develop -c bash -c "pnpm tsc --noEmit"`
- `nix develop -c bash -c "pnpm lint"`
- Confirm no other caller of the old `setWrappedDek` name remains (grep) —
  the rename to `setWrappedDekIfAbsent` should be total.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as planned:
- functions/_lib/db.ts: replaced setWrappedDek with setWrappedDekIfAbsent(db, userId, wrappedDek): Promise<string>. UPDATE now guards on wrapped_dek IS NULL so a racing second write is a no-op; both callers read back and receive the same winning value via a trailing SELECT.
- functions/api/auth/enc-meta.ts: onRequestPut now calls setWrappedDekIfAbsent and responds 200 with { wrapped_dek: stored } instead of a bare 204.
- web/src/encryption.ts: in the 'first device' branch, after PUTting the generated wrapped DEK, the client now reads the response's wrapped_dek and, if it differs from what was sent, unwraps the server's (winning) value with the local KWK and adopts those bytes instead of its own. Falls back to its own generated DEK if the PUT fails or the response DEK doesn't unwrap (defensive, no regression vs prior fire-and-forget behavior).
- Updated/added tests: functions/__tests__/db.test.ts (renamed describe/tests, new no-op-on-second-call assertion), functions/__tests__/enc-meta.test.ts (200 + body assertions, no-op-race test), web/src/encryption.test.ts (echoing PUT mock + new race-loss adoption test using a shared wrapDek() helper), web/src/sync-encryption.integration.test.ts (PUT mocks now echo the wrapped_dek instead of returning bare 204).

Verification run:
- pnpm test run encryption.test.ts sync-encryption.integration.test.ts (web) — 12 passed
- pnpm test:functions (web, functions suite) — 56 passed
- pnpm test run (web, full suite) — 391 passed
- tsc -b --noEmit (web) and tsc --project functions/__tests__/tsconfig.json --noEmit — clean
- pnpm lint (web) — 0 errors (2 pre-existing unrelated warnings in App.tsx)
- grep confirms no remaining references to the old setWrappedDek name
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Made the enc-meta wrapped-DEK PUT idempotent server-side (setWrappedDekIfAbsent only sets wrapped_dek when null and returns the winning value) and had the client adopt the server's returned DEK when it loses a first-login race, eliminating the permanently-undecryptable-workspace bug from two devices racing first login.
<!-- SECTION:FINAL_SUMMARY:END -->
