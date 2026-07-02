---
id: TASK-118
title: 'Fix: KWK creation race can leave two devices with different key-wrapping keys'
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 20:50'
updated_date: '2026-07-02 16:07'
labels:
  - review-fix
  - planned
dependencies: []
ordinal: 153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-95.2 made the wrapped-DEK write (functions/_lib/db.ts setWrappedDekIfAbsent,
called from functions/api/auth/enc-meta.ts onRequestPut) idempotent so two
devices racing first login converge on one DEK — but that fix only works if
both devices already agree on the same KWK. The KWK itself is still created
with an unguarded read-then-write in getOrCreateKwk() (functions/api/auth/enc-meta.ts):

  const existing = await kv.get(`kwk:${userId}`);
  if (existing) return existing;
  const raw = crypto.getRandomValues(new Uint8Array(32));
  ...
  await kv.put(`kwk:${userId}`, b64);
  return b64;

Two devices hitting GET /api/auth/enc-meta for the very first time
concurrently (the same scenario TASK-95.2's commit message describes) can
both see `existing === null`, each generate and `kv.put` its own random KWK,
and each proceed with its own (different) KWK value in memory — regardless
of which write KV ultimately keeps (KV is last-write-wins and only
eventually consistent).

When the losing device later PUTs its wrapped DEK and gets back the winning
device's wrapped_dek (per TASK-95.2's fix), it tries to unwrap that value
with its own KWK (web/src/encryption.ts initEncryption). Since the KWKs
differ, aesGcmDecrypt returns null, the `if (dekRaw)` guard silently skips
adopting the winning DEK, and the losing device falls back to its own
generated (server-orphaned) DEK — reproducing the exact "permanently
undecryptable workspace" failure mode TASK-95.2 set out to fix, just moved
one layer down to the KWK.

Suggested fix: make getOrCreateKwk's KV write conditional/idempotent the
same way setWrappedDekIfAbsent is (e.g. a compare-and-swap via a
`kv.get` + only `kv.put` when still absent isn't enough given KV's
eventual consistency — consider using D1 with the same
`WHERE ... IS NULL` pattern already used for wrapped_dek, or another
mechanism that gives a single winner and lets every caller read back the
same value).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

`getOrCreateKwk()` (functions/api/auth/enc-meta.ts) does an unguarded
read-then-write against Cloudflare KV (`kv.get` → generate → `kv.put`). KV has
no compare-and-swap and is only eventually consistent, so two devices racing
the very first `GET /api/auth/enc-meta` for a user can both see `existing ===
null`, each generate and `put` a different KWK, and each proceed in memory
with a KWK the other device doesn't have — regardless of which `put` KV
ultimately keeps. This is the same class of bug TASK-95.2 fixed for
`wrapped_dek`, one layer down. The fix in TASK-95.2 worked because D1
supports a real conditional write (`UPDATE ... WHERE wrapped_dek IS NULL`)
with same-request read-after-write consistency; KV structurally cannot
provide that guarantee no matter how the KV calls are sequenced.

## Fix: move the KWK from KV into D1, using the exact `setWrappedDekIfAbsent`
## race-safe pattern already proven in this file

Rejected alternative: keep the KWK's *secret bytes* in KV and only use D1 as
a coordination pointer (e.g. write a random token to
`kwk:<userId>:<token>` in KV, then race a D1 `UPDATE ... WHERE kwk_token IS
NULL` to pick a winning token, then `kv.get` the winning token's entry).
This preserves the two-separate-storage-systems narrative in
web/src/AboutModal.tsx, but does not actually fix the race: KV writes can
take up to ~60s to propagate globally, so a losing device could resolve the
winning token from D1 and then `kv.get` it before that device's own KV write
has propagated to the reader's edge location, getting `null` back — the
exact class of bug this ticket exists to close, just moved into the pointer
resolution step instead of the value itself. D1 is used for
`setWrappedDekIfAbsent` specifically because it gives same-request
read-after-write consistency that KV cannot; anything that still routes the
authoritative value through KV inherits KV's eventual consistency. Store the
KWK directly in D1 instead.

Trade-off to flag explicitly: this changes the security narrative in
web/src/AboutModal.tsx, which currently advertises the KWK and wrapped DEK
as living in two separate storage backends ("an attacker would need
simultaneous access to both the session store (KWK) and the database
(wrapped DEK)"). After this fix both live in D1, so that specific claim
becomes false and must be corrected as part of this ticket, not left stale.
The plaintext DEK still never leaves the browser and is still never stored
anywhere server-side — that protection is unaffected — but the "two
independent storage systems" defense-in-depth layer is genuinely being
traded away for correctness. This is called out for the implementer to
address in the copy, not silently patched over.

### 1. New migration: migrations/0003_users_kwk.sql

```sql
ALTER TABLE users ADD COLUMN kwk TEXT;
```

Mirrors migrations/0002_users_wrapped_dek.sql exactly (single nullable
column, no default, no backfill needed — existing users get a KWK lazily on
next GET just like they got a KV entry lazily before).

### 2. functions/_lib/db.ts — getKwk / setKwkIfAbsent

Add two functions immediately after `getWrappedDek` /
`setWrappedDekIfAbsent`, following their exact shape:

```ts
export async function getKwk(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT kwk FROM users WHERE id = ?")
    .bind(userId)
    .first<{ kwk: string | null }>();
  return row?.kwk ?? null;
}

/**
 * Store a KWK the first time a user needs one, and otherwise leave the
 * existing value untouched. Same race-safe contract as
 * `setWrappedDekIfAbsent`: whichever caller's UPDATE reaches the row first
 * wins (the `kwk IS NULL` guard turns a racing second UPDATE into a no-op),
 * and every caller reads back the same winning value via the trailing
 * SELECT. This closes the first-login KWK race described in TASK-118 — two
 * devices calling this concurrently with different freshly-generated KWKs
 * converge on one value instead of each keeping its own.
 *
 * Returns the KWK now stored for this user (which may be the caller's own
 * value, or another device's if it won the race).
 */
export async function setKwkIfAbsent(
  db: D1Database,
  userId: string,
  kwk: string,
): Promise<string> {
  await db
    .prepare("UPDATE users SET kwk = ? WHERE id = ? AND kwk IS NULL")
    .bind(kwk, userId)
    .run();

  const current = await getKwk(db, userId);
  if (current === null) {
    throw new Error(`kwk missing after setKwkIfAbsent (user_id=${userId})`);
  }
  return current;
}
```

### 3. functions/api/auth/enc-meta.ts — getOrCreateKwk reads/writes D1, not KV

Replace the KV-backed implementation:

```ts
async function getOrCreateKwk(
  db: D1Database,
  userId: string,
): Promise<string> {
  const existing = await getKwk(db, userId);
  if (existing) return existing;

  const raw = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(Array.from(raw, (b) => String.fromCharCode(b)).join(""));
  return setKwkIfAbsent(db, userId, b64);
}
```

- Drop the `KWK_PREFIX` constant and the KV `.get`/`.put` calls entirely.
- `onRequestGet` now calls `getOrCreateKwk(ctx.env.DB, user.id)` instead of
  `getOrCreateKwk(ctx.env.SESSIONS, user.id)`. `ctx.env.SESSIONS` remains
  used elsewhere in this file only via `requireUser` for session-cookie
  lookup — unrelated to the KWK and unaffected by this change.
- Update the imports: add `getKwk, setKwkIfAbsent` to the
  `../../_lib/db` import alongside the existing `getWrappedDek,
  setWrappedDekIfAbsent`.
- Update the file's header comment (currently: "KWK ... stored in KV under
  kwk:<user_id>") to say the KWK is stored in D1 alongside the wrapped DEK,
  and note both now live in the same database (no longer two separate
  storage backends).

### 4. web/src/encryption.ts — comment-only update

Lines 4/6 currently describe "KWK ... stored in KV on the server" as part of
the two-key model comment block. Update to reflect that the KWK is now
stored in D1. No behavioral change — the client still fetches `{ kwk,
wrapped_dek }` from the same `GET /api/auth/enc-meta` response shape, so
`initEncryption()` itself needs no code changes.

### 5. web/src/AboutModal.tsx — correct the security narrative

Update the "Two-layer key system" and "Cross-device sync" sections:
- The KWK bullet currently says "stored in our session store (Cloudflare
  KV)" — change to reflect it's stored in the database (Cloudflare D1)
  alongside the wrapped DEK.
- The paragraph claiming "an attacker would need simultaneous access to
  both the session store (KWK) and the database (wrapped DEK) — neither
  alone is sufficient" is no longer accurate once both live in D1 access to
  D1 alone now yields both the KWK and the wrapped DEK. Rewrite this
  paragraph honestly: e.g. explain the DEK's plaintext bytes are generated
  and used only in the browser and are never transmitted or stored
  server-side in any form, so a database compromise yields the wrapped DEK
  and the KWK together but never the plaintext DEK reconstructed
  server-side (the server never performs the unwrap). Do not leave stale
  "two independent storage systems" claims in the copy.
- Update "Cross-device sync" copy ("fetches the KWK from our session
  store") to say it fetches both the KWK and wrapped DEK from the server in
  one call.
- The "Limitations" paragraph ("An operator with simultaneous access to
  both storage systems could reconstruct the DEK") should be revised since
  there is now only one storage system holding both key materials — an
  operator with D1 access alone can reconstruct the DEK. State this
  plainly rather than implying two systems are still required.

## Tests

### functions/__tests__/db.test.ts
- Add `0003_users_kwk.sql` to the `migrationSql` join list (mirroring how
  `0002_users_wrapped_dek.sql` was added).
- Import `getKwk, setKwkIfAbsent` alongside the existing db imports.
- Add a `describe("getKwk / setKwkIfAbsent", ...)` block mirroring the
  `getWrappedDek / setWrappedDekIfAbsent` block: (a) returns null before any
  KWK is set, (b) stores and returns the value on first call, (c) second
  call with a different value is a no-op — both calls' return values equal
  the first-stored value and `getKwk` confirms it afterward (this is the
  concrete regression test for the TASK-118 race).

### functions/__tests__/enc-meta.test.ts
- Add `0003_users_kwk.sql` to the `migrationSql` join list.
- Remove the "stores the KWK in KV under kwk:<user_id>" test (no longer
  applicable — the KWK is no longer in KV). Replace it with "stores the KWK
  in the users table" asserting `getKwk(db, user.id)` returns a non-null
  32-byte-decoding value after the first GET, using the already-imported
  `getKwk` from `_lib/db` (or query D1 directly via the mock, matching
  existing test style in this file).
- Add a new test: "two concurrent first calls converge on the same KWK"
  — call `getOrCreateKwk`'s effect twice via two `onRequestGet` invocations
  that both observe `existing === null` before either write lands (simulate
  by calling `setKwkIfAbsent` directly with two different generated values,
  matching the no-op-on-second-call test style already used for
  `setWrappedDekIfAbsent` in db.test.ts) — or, simpler and sufficient:
  extend the existing "is idempotent — returns the same KWK on repeated
  calls" test's intent by directly unit-testing `setKwkIfAbsent`'s
  no-op-on-second-write behavior in db.test.ts (covered above); the
  enc-meta-level test only needs to confirm the endpoint itself now reads
  from D1, not KV.
- The existing "is idempotent — returns the same KWK on repeated calls"
  test needs no changes; it exercises the same behavior through the new
  storage path.
- `kvStore` fixture (`createKVMock`) stays — still used for session
  cookies via `mintSession`/`requireUser` — only the KWK-specific
  assertions against it are removed.

### web/src/AboutModal.test.tsx (if it exists — check first)
- If a snapshot or text-assertion test exists for the security-copy
  paragraphs being changed, update it to match the new wording. Grep for an
  existing test file before assuming one exists; if none exists, no test
  changes needed here (this component's tests, if any, are unlikely to
  assert on exact prose).

## Verification

- `nix develop -c bash -c "cd web && pnpm test:functions"` (covers
  db.test.ts and enc-meta.test.ts)
- `nix develop -c bash -c "cd web && pnpm test run"` (full web suite,
  covers encryption.test.ts / sync-encryption.integration.test.ts and any
  AboutModal test, confirming no regressions from the comment/copy changes)
- `nix develop -c bash -c "cd web && pnpm tsc --noEmit"`
- `nix develop -c bash -c "web/node_modules/.bin/tsc --project functions/tsconfig.json --noEmit"`
- `nix develop -c bash -c "web/node_modules/.bin/tsc --project functions/__tests__/tsconfig.json --noEmit"`
- `nix develop -c bash -c "cd web && pnpm lint"`
- Grep for any remaining `kwk:` KV-prefix references or `KWK_PREFIX` to
  confirm the KV path was fully removed, and grep AboutModal.tsx /
  encryption.ts for stale "session store" / "Cloudflare KV" KWK wording.
- Manually re-read the new AboutModal.tsx copy end-to-end for internal
  consistency (no leftover claim of two separate storage backends for the
  two keys).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the plan:
- migrations/0003_users_kwk.sql: adds users.kwk TEXT column.
- functions/_lib/db.ts: added getKwk() and setKwkIfAbsent() mirroring the
  race-safe UPDATE ... WHERE kwk IS NULL pattern already used by
  setWrappedDekIfAbsent.
- functions/api/auth/enc-meta.ts: getOrCreateKwk() now reads/writes the KWK
  through D1 (getKwk/setKwkIfAbsent) instead of KV; dropped KWK_PREFIX and
  the kv.get/kv.put calls. SESSIONS KV binding is untouched (still used by
  requireUser for session cookies). Updated the file header comment.
- web/src/encryption.ts: updated the two-layer key system comment to
  describe the KWK as stored in D1, and clarified the plaintext-DEK-never-
  leaves-the-browser guarantee that still holds.
- web/src/AboutModal.tsx: rewrote the "Two-layer key system", "Cross-device
  sync", and "Limitations" copy to stop claiming two independent storage
  backends (KV + D1) protect the DEK — both keys now live in D1 — and to
  correctly state that only the browser-only plaintext-DEK property remains
  as the defense-in-depth layer.
- AGENTS.md: updated the migrations table/file-tree listings and the
  Encryption section to describe the KWK's new home in D1 and reference
  TASK-118 for why it moved.
- Tests: functions/__tests__/db.test.ts gained a
  "getKwk / setKwkIfAbsent" describe block (null-before-set, store+retrieve,
  and the concurrent-second-call-is-a-no-op regression test for the race
  this ticket closes). functions/__tests__/enc-meta.test.ts now loads the
  0003 migration, replaced the KV-assertion test with one that reads the
  KWK back via getKwk(db, userId), and dropped the now-unused kvStore
  fixture variable (kv itself is still used for session cookies).

Verification run: pnpm test:functions (75 passed), pnpm test run (429
passed), pnpm tsc --noEmit, tsc --project functions/tsconfig.json --noEmit,
tsc --project functions/__tests__/tsconfig.json --noEmit, pnpm lint (only
pre-existing unrelated warnings in App.tsx), pnpm prettier --check on all
touched files. Grepped for kwk: / KWK_PREFIX / "session store" / "Cloudflare
KV" (KWK context) — no stale references remain.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the KWK from Cloudflare KV into D1 (new users.kwk column, migration
0003), reusing the setWrappedDekIfAbsent conditional-write pattern so
concurrent first-logins from two devices converge on one KWK instead of
each generating and keeping its own. Updated enc-meta.ts, AGENTS.md,
encryption.ts, and AboutModal.tsx's security copy to reflect that both the
KWK and wrapped DEK now live in D1 (no longer two independent storage
backends), while preserving the still-true guarantee that the plaintext DEK
never leaves the browser. Added regression tests for the race in
db.test.ts and enc-meta.test.ts.
<!-- SECTION:FINAL_SUMMARY:END -->
