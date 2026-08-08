---
id: TASK-128.1
title: >-
  Recover pre-TASK-118 KWK from legacy KV entry to fix cross-device decryption
  failures
status: Done
assignee:
  - '@ralph'
created_date: '2026-08-08 00:32'
updated_date: '2026-08-08 00:39'
labels:
  - planned
  - bug
  - sync
  - encryption
dependencies: []
documentation:
  - web/src/sync.ts
  - web/src/encryption.ts
  - functions/api/auth/enc-meta.ts
  - functions/_lib/db.ts
  - TASK-118
parent_task_id: TASK-128
priority: high
type: bug
ordinal: 165000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Root cause (confirmed)

`migrations/0002_users_wrapped_dek.sql` (feature: encrypt workspaces) predates
`migrations/0003_users_kwk.sql` (TASK-118, landed 2026-07-02) by a full
release. Any account that already completed key setup — i.e. already had a
`wrapped_dek` row in D1, encrypted under the KWK it fetched from the old
`kwk:<user_id>` KV entry — before TASK-118 shipped is affected:

1. Migration 0003 adds `users.kwk` as a bare nullable column with **no
   backfill** from the old KV entries ("existing users get a KWK lazily on
   next GET just like they got a KV entry lazily before" — this comment in
   TASK-118's plan is wrong for exactly this population: it assumed
   `wrapped_dek` would always be null too, but it wasn't for anyone who had
   already finished setup).
2. The very next `GET /api/auth/enc-meta` these accounts make (i.e. their
   next login, on ANY device) hits the new D1-only `getOrCreateKwk()`, sees
   `kwk IS NULL`, and generates and permanently stores (via
   `setKwkIfAbsent`) a brand-new random KWK that has no relationship to the
   KWK the existing `wrapped_dek` was actually wrapped under.
3. From that point on, `wrapped_dek` is orphaned: no device can ever unwrap
   it again, because the true KWK now only survives in the abandoned
   `kwk:<user_id>` KV entry (which nothing deletes, but nothing reads
   either post-TASK-118).
4. `initEncryption()`'s existing mismatch handler
   (`web/src/encryption.ts:108-116`) silently falls back to a fresh local
   key, so decryption of every one of that account's existing rows fails on
   every device from then on — exactly the reported symptom
   (`Sync: skipping workspace ... decryption failed`).

Verified via `git log` that `wrapped_dek` (migration 0002) predates `kwk`
(migration 0003) by over a month, and the pre-TASK-118 `enc-meta.ts`
(`git show e548e4e^:functions/api/auth/enc-meta.ts`) confirms the legacy KV
key format was `kwk:<user_id>` in the `SESSIONS` namespace, written with no
TTL (so it should still be present for affected accounts).

This is a **different, additive** bug from the one TASK-118 fixed (TASK-118
closed a concurrent-first-login race going forward; this ticket is about a
migration that silently orphaned already-established key pairs). Both can
be true at once — see TASK-128's parent ticket for the full report.

## Why the fix can't just "prefer the legacy KV value whenever it disagrees"

A naive fix — whenever a legacy KV entry exists and differs from the D1
`kwk`, overwrite D1 with the legacy value — is unsafe: an account that
*started* key setup before TASK-118 (so it has a legacy KV entry) but
*finished* it (its `wrapped_dek` PUT) *after* TASK-118 shipped will have a
D1 `kwk` that is correct and already matches its `wrapped_dek`, with an
unrelated, stale legacy KV entry sitting alongside it. The server can never
tell these two cases apart by inspection alone — it never sees the
plaintext DEK, so it cannot verify which KWK actually unwraps
`wrapped_dek`. Only the *browser* can prove that, by trying the decrypt.

## Fix: server offers the legacy key as a fallback; client proves and confirms it

Push the decision to the party that can verify it (client-side decrypt),
per this project's "define errors out of existence" / "pull complexity
downward" conventions — no guessing, no timing-window heuristics.

Full design and code sketch below have already been worked out against the
current source (`functions/_lib/db.ts`, `functions/api/auth/enc-meta.ts`,
`web/src/encryption.ts`) — see the Implementation Plan field.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Logging in on a fresh device as an account whose wrapped_dek predates migration 0003 (TASK-118) decrypts and shows that account's saved workspaces, instead of falling back to an empty/default workspace
- [x] #2 GET /api/auth/enc-meta offers a legacy_kwk candidate whenever a pre-TASK-118 KV entry disagrees with the stored D1 kwk and a wrapped_dek already exists; PUT /api/auth/enc-meta accepts a confirm_kwk field that only takes effect when it matches that account's own legacy KV entry
- [x] #3 web/src/encryption.ts retries an unwrap with legacy_kwk when the primary kwk fails, and on success both adopts the resulting DEK locally and asks the server to persist the confirmed KWK so future logins do not need the fallback
- [x] #4 Regression tests cover: a never-diverged account is untouched by this change, an orphaned account self-heals via the legacy_kwk/confirm_kwk round trip, and a genuinely-corrupted account (neither key unwraps) still falls back safely
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## 1. functions/_lib/db.ts — add `setKwk` (unconditional overwrite)

Add immediately after `setKwkIfAbsent` (~line 253):

```ts
/**
 * Unconditionally overwrite the stored KWK for a user. Unlike
 * setKwkIfAbsent, this has no `IS NULL` guard — it is used only to persist
 * a legacy KWK the client has already cryptographically proven correct by
 * successfully unwrapping the account's wrapped_dek with it (see TASK-128
 * / the `confirm_kwk` flow in enc-meta.ts). Never called on the normal
 * first-login path, where setKwkIfAbsent's conditional write is what keeps
 * concurrent first logins race-safe.
 */
export async function setKwk(
  db: D1Database,
  userId: string,
  kwk: string,
): Promise<void> {
  await db.prepare("UPDATE users SET kwk = ? WHERE id = ?").bind(kwk, userId).run();
}
```

`getOrCreateKwk` itself is NOT touched — it keeps generating a fresh KWK
for genuinely new accounts exactly as today. The repair logic lives
entirely in the request handlers below, not in this low-level helper.

## 2. functions/api/auth/enc-meta.ts

Restore a legacy-KV-prefix constant (read-only now — nothing writes to KV
KWK entries anymore):

```ts
// Legacy location of the KWK before TASK-118 moved key storage into D1.
// Deliberately never deleted by any code path so it survives indefinitely
// as a recovery source for accounts whose D1 kwk was orphaned by migration
// 0003's unbackfilled column (see TASK-128).
const LEGACY_KWK_PREFIX = "kwk:";
```

Update imports: add `setKwk` to the `../../_lib/db` import.

### `onRequestGet`

```ts
export const onRequestGet: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
    if (result instanceof Response) return result;
    const user = result;

    const kwk = await getOrCreateKwk(ctx.env.DB, user.id);
    const wrapped_dek = await getWrappedDek(ctx.env.DB, user.id);

    // If this account already has a wrapped_dek, a legacy (pre-TASK-118)
    // KV-stored KWK might still exist and disagree with the D1 value — the
    // exact orphaning bug TASK-128 exists to fix. Only the client can prove
    // which one actually unwraps wrapped_dek (the server never sees the
    // plaintext DEK), so surface the legacy candidate for the client to try
    // instead of guessing here. Skipped entirely when wrapped_dek is null:
    // there is nothing to reconcile yet for a brand-new account.
    let legacy_kwk: string | null = null;
    if (wrapped_dek !== null) {
      const legacy = await ctx.env.SESSIONS.get(`${LEGACY_KWK_PREFIX}${user.id}`);
      if (legacy && legacy !== kwk) legacy_kwk = legacy;
    }

    return Response.json({ kwk, wrapped_dek, legacy_kwk });
  },
);
```

### `onRequestPut` — extend to accept an optional `confirm_kwk`

`wrapped_dek` becomes optional in the body type; the handler now supports
either or both fields in one request. Replace the body/validation block:

```ts
export const onRequestPut: PagesFunction<Env> = withErrorHandling(
  async (ctx) => {
    const result = await requireUser(ctx.request, ctx.env.SESSIONS, ctx.env.DB);
    if (result instanceof Response) return result;
    const user = result;

    let body: { wrapped_dek?: string; confirm_kwk?: string };
    try {
      body = (await ctx.request.json()) as typeof body;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const { wrapped_dek, confirm_kwk } = body;

    if (confirm_kwk !== undefined) {
      if (typeof confirm_kwk !== "string" || !confirm_kwk) {
        return jsonError("Invalid confirm_kwk", 400);
      }
      // Only ever adopt a value that matches this account's own legacy KV
      // entry — never trust an arbitrary client-supplied KWK. The client
      // only ever echoes back the exact `legacy_kwk` this endpoint gave it
      // after proving locally that it unwraps wrapped_dek; re-checking here
      // against KV (rather than trusting the client's claim) means a buggy
      // or malicious client can at worst no-op this call, never corrupt
      // another value. Best-effort: mismatch/absence silently no-ops
      // instead of erroring, since the caller's current request already
      // succeeded locally regardless of whether this repair lands.
      const legacy = await ctx.env.SESSIONS.get(`${LEGACY_KWK_PREFIX}${user.id}`);
      if (legacy && legacy === confirm_kwk) {
        await setKwk(ctx.env.DB, user.id, confirm_kwk);
        logEvent("data.kwk_repaired", { user_id: user.id });
      }
    }

    if (wrapped_dek === undefined) {
      if (confirm_kwk === undefined) {
        return jsonError("Missing required field: wrapped_dek or confirm_kwk", 400);
      }
      return Response.json({ ok: true });
    }
    if (typeof wrapped_dek !== "string" || !wrapped_dek) {
      return jsonError("Missing required field: wrapped_dek", 400);
    }

    const stored = await setWrappedDekIfAbsent(ctx.env.DB, user.id, wrapped_dek);
    logEvent("data.dek_write", { user_id: user.id });
    return Response.json({ wrapped_dek: stored });
  },
);
```

Existing callers that only ever send `{ wrapped_dek }` are unaffected —
this is purely additive.

## 3. web/src/encryption.ts — client-side legacy fallback + confirm

Update the destructured GET response type to include `legacy_kwk: string | null`.

Inside `initEncryption()`, the `if (wrappedB64)` branch becomes:

```ts
if (wrappedB64) {
  let dekRaw = await aesGcmDecrypt(kwk, wrappedB64);
  if (!dekRaw && legacyKwkB64) {
    // Primary KWK failed to unwrap — try the legacy (pre-TASK-118) KWK the
    // server offered. If it works, this account's wrapped_dek predates
    // migration 0003's unbackfilled kwk column (TASK-128) — tell the
    // server to adopt it as the permanent KWK so future logins (this
    // device and others) skip this fallback.
    const legacyKwk = await importAesGcm(fromBase64(legacyKwkB64));
    dekRaw = await aesGcmDecrypt(legacyKwk, wrappedB64);
    if (dekRaw) {
      void fetch("/api/auth/enc-meta", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_kwk: legacyKwkB64 }),
      }).catch(() => {
        // Best-effort: this device already decrypted successfully either
        // way; a failed repair just means this fallback runs again next
        // login (this device or another) until it succeeds.
      });
    }
  }
  if (dekRaw) {
    dekBytes = fromBase64(new TextDecoder().decode(dekRaw));
  } else {
    // Neither the primary nor legacy KWK unwraps wrapped_dek — genuine
    // corruption/tampering, not the TASK-128 migration gap. Keep local key.
    dekPromise = loadLocalKey();
    return;
  }
} else {
  ...unchanged...
}
```

Update the file-header comment block (lines ~1-22) with one short added
paragraph noting the legacy-KV recovery path and pointing at TASK-128,
mirroring how TASK-118's D1-move was documented there.

## 4. Tests

### functions/__tests__/db.test.ts
Add a `describe("setKwk", ...)` block near the existing `getKwk` /
`setKwkIfAbsent` block:
- "overwrites an existing KWK unconditionally" — set one value via
  `setKwkIfAbsent`, call `setKwk` with a different value, assert `getKwk`
  returns the second value (no `IS NULL` guard, unlike `setKwkIfAbsent`).
- "sets a KWK when previously null" — same shape as `setKwkIfAbsent`'s
  first-call test, confirming `setKwk` also works from an empty column.

### functions/__tests__/enc-meta.test.ts
`createKVMock()`'s returned `store` (already destructured in some tests as
`kvStore`) lets tests seed a legacy entry directly via
`store.set(\`kwk:${userId}\`, legacyValue)`, bypassing the app code —
simulating data left over from before TASK-118. New
`describe("legacy KV KWK recovery (TASK-128)", ...)` block:
- "GET omits legacy_kwk when wrapped_dek is not set yet" — seed a legacy KV
  entry, GET (creates an unrelated fresh D1 kwk since wrapped_dek is null),
  assert `legacy_kwk === null` in the response even though the legacy entry
  exists and differs — nothing to reconcile yet.
- "GET returns legacy_kwk once wrapped_dek exists and it disagrees with the
  D1 kwk" — seed legacy KV entry, GET (fresh D1 kwk, unrelated to legacy),
  PUT a `wrapped_dek`, GET again — assert `legacy_kwk === <seeded value>`
  and `kwk !== legacy_kwk`.
- "GET omits legacy_kwk once it matches the current D1 kwk" (already
  reconciled / never diverged) — seed the KV entry with the SAME value
  `getOrCreateKwk` would already return (i.e. no divergence) — assert
  `legacy_kwk === null`.
- "PUT confirm_kwk repairs the stored KWK when it matches the legacy KV
  value" — seed legacy KV entry + differing D1 kwk + a `wrapped_dek`; PUT
  `{ confirm_kwk: <legacy value> }`; assert `getKwk(db, userId)` now equals
  the legacy value, and a follow-up GET returns `kwk` equal to it and
  `legacy_kwk === null` (fully self-healed).
- "PUT confirm_kwk is a no-op when the value does not match the legacy KV
  entry" — assert D1 `kwk` unchanged, response still 200 `{ ok: true }`.
- "PUT confirm_kwk is a no-op when there is no legacy KV entry at all" —
  same assertion, defends the case of an unrelated/malicious value.
- "PUT with neither wrapped_dek nor confirm_kwk returns 400" — the existing
  "returns 400 for a missing wrapped_dek field" test already covers a body
  with neither key; re-verify it still passes given the branch logic above
  (it will — `wrapped_dek === undefined && confirm_kwk === undefined`),
  no change needed to that test itself.
- "PUT confirm_kwk alongside a wrapped_dek in the same request repairs the
  KWK and stores the wrapped_dek" — sanity check the two branches don't
  interfere with each other when both fields are present.

### web/src/encryption.test.ts
Reuse the existing `wrapDek` helper and `vi.spyOn(globalThis, "fetch")`
pattern already used by "unwraps an existing wrapped DEK from the server"
and "adopts the server's wrapped DEK when it loses the first-login race".
New tests in the `describe("initEncryption", ...)` block:
- "falls back to legacy_kwk when the primary kwk fails to unwrap
  wrapped_dek, adopts the resulting DEK, and confirms it to the server" —
  generate a real `legacyKwkBytes` + `dekBytes`, wrap `dekBytes` under
  `legacyKwkBytes` to get `wrappedDek`; mock GET to return
  `{ kwk: <unrelated random bytes>, wrapped_dek: wrappedDek, legacy_kwk:
  legacyKwkB64 }`; mock PUT to capture its body. After `initEncryption`,
  assert (a) `getOrCreateKey()` resolves to a key that decrypts data
  encrypted with the known `dekBytes` (same assertion style as the
  existing "unwraps" test), and (b) a PUT was sent with body
  `{ confirm_kwk: legacyKwkB64 }`.
- "does not attempt legacy fallback when legacy_kwk is absent" — regression
  guard: GET returns no `legacy_kwk` field (or `null`) with a
  `wrapped_dek` that the primary `kwk` can't unwrap; assert the code falls
  straight to `loadLocalKey()` (same outcome as today, no extra fetch
  calls) — reuses the existing "keep local key" behavior, just asserting
  no PUT fires when there's nothing to confirm.
- "keeps local key when neither the primary nor legacy kwk can unwrap
  wrapped_dek" — genuine corruption/tampering case, both unwraps fail;
  assert same fallback as before (`loadLocalKey()`), no PUT sent.

## 5. Docs

### AGENTS.md
Update the KWK/DEK description (~lines 310-335) and the `enc-meta.ts` file
listings (~lines 130, 422) with a short note on the legacy-KV recovery path
and `confirm_kwk`, mirroring how TASK-118 documented the D1 move. Add a
row/mention referencing TASK-128 next to the existing TASK-118 references
in the migrations table (~lines 95-96, 160-161) if useful for future
readers tracing why `kwk:<user_id>` KV keys still matter.

## Verification

- `nix develop -c bash -c "cd web && pnpm test:functions"` (db.test.ts,
  enc-meta.test.ts)
- `nix develop -c bash -c "cd web && pnpm test run"` (full web suite,
  encryption.test.ts + sync-encryption.integration.test.ts)
- `nix develop -c bash -c "cd web && pnpm tsc --noEmit"`
- `nix develop -c bash -c "web/node_modules/.bin/tsc --project functions/tsconfig.json --noEmit"`
- `nix develop -c bash -c "web/node_modules/.bin/tsc --project functions/__tests__/tsconfig.json --noEmit"`
- `nix develop -c bash -c "cd web && pnpm lint"`
- Manually trace through both scenarios once more against the final diff:
  (a) pre-TASK-118 account with a fully-established, already-completed key
  pair — must NOT be touched by this change (legacy_kwk stays null because
  D1 kwk already matches on their next GET, since it was never orphaned);
  (b) pre-TASK-118 account whose D1 kwk was auto-generated as an orphan —
  must self-heal on next login via the legacy_kwk → confirm_kwk round trip.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented exactly per the recorded plan, no deviations. functions/_lib/db.ts: added setKwk (unconditional overwrite, contrasted in its docstring with setKwkIfAbsent's race-safe conditional write). functions/api/auth/enc-meta.ts: GET now reads the legacy `kwk:<user_id>` KV entry and surfaces it as legacy_kwk only when wrapped_dek exists and it disagrees with the D1 kwk; PUT accepts an optional confirm_kwk that is re-verified against KV server-side (never trusts the client's claim) before calling setKwk. web/src/encryption.ts: initEncryption retries the unwrap with legacy_kwk when the primary kwk fails, adopts the resulting DEK on success, and fires a best-effort PUT {confirm_kwk} (failure swallowed — self-heals again next login). Added regression tests: functions/__tests__/db.test.ts (setKwk describe block), functions/__tests__/enc-meta.test.ts (new 'legacy KV KWK recovery (TASK-128)' describe block covering all divergence/no-divergence/repair/no-op cases), web/src/encryption.test.ts (three new initEncryption cases: legacy fallback success+confirm, no legacy_kwk offered, genuine corruption where neither key works). Updated AGENTS.md migration table, file listings, and the Encryption section with the legacy-KV recovery flow.

Verification: pnpm test:functions (84/84 pass), pnpm test run (452/452 pass), tsc --noEmit (web, functions, functions/__tests__) all clean, pnpm lint clean (2 pre-existing unrelated warnings in useGraphQLPipeline.ts). Manually traced both scenarios from the plan: (a) a fully-established pre-TASK-118 account whose D1 kwk already matches wrapped_dek is untouched (legacy_kwk stays null on GET since there is no divergence); (b) an orphaned account (D1 kwk auto-generated post-migration, unrelated to the legacy KV value) self-heals on next login via the legacy_kwk -> confirm_kwk round trip and its GET returns legacy_kwk === null afterward.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the TASK-128 cross-device decryption failure caused by migration 0003 (TASK-118) leaving `users.kwk` unbackfilled: accounts that had already completed key setup before TASK-118 shipped got an unrelated, freshly-generated KWK on their next login, silently orphaning their existing `wrapped_dek`.

The fix pushes the reconciliation decision to the client, which is the only party that can prove which KWK actually unwraps `wrapped_dek` (the server never sees the plaintext DEK):

- `functions/_lib/db.ts` — added `setKwk`, an unconditional overwrite used only for this proven-correct repair path (contrast with `setKwkIfAbsent`'s race-safe conditional write for normal first login).
- `functions/api/auth/enc-meta.ts` — `GET` now surfaces a `legacy_kwk` candidate (read from the still-present pre-TASK-118 `kwk:<user_id>` KV entry) whenever it disagrees with the D1 `kwk` and a `wrapped_dek` already exists. `PUT` accepts an optional `confirm_kwk` that the server re-verifies against its own KV read before persisting via `setKwk` — never trusts an arbitrary client-supplied value.
- `web/src/encryption.ts` — `initEncryption` retries the unwrap with `legacy_kwk` when the primary `kwk` fails; on success it adopts the DEK locally and fires a best-effort `PUT {confirm_kwk}` so future logins on any device skip the fallback.

Added full regression coverage in `db.test.ts`, `enc-meta.test.ts` (new "legacy KV KWK recovery (TASK-128)" block), and `encryption.test.ts` (legacy-fallback success+confirm, no-legacy-offered regression guard, genuine-corruption fallback). Updated `AGENTS.md`'s migration table, file listings, and Encryption section to document the recovery flow.

Verification: `pnpm test:functions` (84/84), `pnpm test run` (452/452), `tsc --noEmit` clean across web/functions/functions test configs, `pnpm lint` clean (2 pre-existing unrelated warnings). Manually traced both plan scenarios against the final diff — a never-diverged account is untouched, an orphaned account self-heals via the legacy_kwk/confirm_kwk round trip.
<!-- SECTION:FINAL_SUMMARY:END -->
