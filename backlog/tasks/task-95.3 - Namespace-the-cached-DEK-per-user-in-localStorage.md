---
id: TASK-95.3
title: Namespace the cached DEK per user in localStorage
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 20:18'
labels:
  - review
  - planned
dependencies: []
parent_task_id: TASK-95
priority: medium
ordinal: 140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/encryption.ts:16 caches the plaintext DEK under a single localStorage key (gql-fiddle-dek) shared by the anonymous/offline key and every authenticated user. Two users on one browser profile collide on one DEK entry; an anonymous-mode key can be silently adopted as the server DEK; logout does not clear it. Fix: namespace the cache key by user id (gql-fiddle-dek:<userId>), clear it on logout, and document the localStorage tradeoff in the file header (weakens the guarantee only against a local/XSS attacker, not the server).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 two users on one browser keep distinct cached DEKs
- [x] #2 logout clears the current user's cached DEK
- [x] #3 the anonymous key no longer collides with an authenticated DEK
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Namespace the localStorage-cached DEK per user and clear it on logout.

Files touched: web/src/encryption.ts, web/src/sync.ts, web/src/auth.ts,
web/src/encryption.test.ts, web/src/sync-encryption.integration.test.ts.

1. web/src/encryption.ts
   - Replace the single `DEK_CACHE_KEY = "gql-fiddle-dek"` constant with a
     prefix + helper: `const DEK_CACHE_PREFIX = "gql-fiddle-dek:";` and
     `function dekCacheKey(userId: string | null): string { return DEK_CACHE_PREFIX + (userId ?? "anon"); }`.
   - Add module-level `let currentUserId: string | null = null;` (starts in
     the anon namespace before any login, mirroring the existing `dekPromise`
     module-level pattern).
   - Update `loadLocalKey()` to read/write via `dekCacheKey(currentUserId)`
     instead of the raw constant (both the cache-hit read and the
     generate-and-store fallback).
   - Change `initEncryption()` to `initEncryption(userId: string): Promise<void>`
     and set `currentUserId = userId` as its first statement (before the
     try), so every localStorage access for the rest of that call — the
     final `localStorage.setItem(...)` at the end of the success path, and
     the `loadLocalKey()` fallback calls in the catch branches — goes through
     the newly-scoped key.
   - Add `export function clearCachedKey(): void` that removes
     `localStorage.getItem(dekCacheKey(currentUserId))`'s entry, then resets
     `currentUserId = null` and `dekPromise = null` so a subsequent
     `getOrCreateKey()` call (e.g. before the next login) falls back into the
     anon namespace instead of reusing the logged-out user's state.
   - Update the file header comment to document the localStorage tradeoff:
     caching the DEK client-side weakens confidentiality only against a
     local/XSS attacker with script execution in the page's origin or
     physical access to the browser profile — never against the server,
     which never sees the DEK. Namespacing by user id prevents one user's
     cached DEK from colliding with another's on a shared browser profile;
     the entry is cleared on explicit logout, not on any timer.

2. web/src/sync.ts (onLogin, the `await initEncryption();` call)
   - Change to `await initEncryption(useAuth.getState().user!.id);`. onLogin
     only runs when the auth subscriber observes a transition into
     `status === "authed"`, and `setAuth()` only ever sets `status: "authed"`
     in the same call where `user` is non-null, so the non-null assertion is
     safe here and consistent with the rest of onLogin already assuming an
     authed user.

3. web/src/auth.ts (logout())
   - Import `clearCachedKey` from "./encryption".
   - Call `clearCachedKey()` in the existing `finally` block (alongside
     `setAuth(null)`), so the just-logged-out user's cached DEK is removed
     before any other user can log in on the same browser profile.

4. Tests
   - web/src/encryption.test.ts: update every `initEncryption()` call site to
     pass a fixed test user id (e.g. `initEncryption("u1")`) to match the new
     required parameter. Add: (a) a test that `initEncryption("u1")` and
     `initEncryption("u2")` (two different server DEKs) populate distinct
     `localStorage` keys (`gql-fiddle-dek:u1` / `gql-fiddle-dek:u2`) with no
     collision; (b) a test that `clearCachedKey()` after `initEncryption("u1")`
     removes only `gql-fiddle-dek:u1`, and a following `getOrCreateKey()`
     (anon path, no `initEncryption` call) generates/reads
     `gql-fiddle-dek:anon` rather than colliding with `u1`'s prior entry.
   - web/src/sync-encryption.integration.test.ts: replace the two
     `localStorage.removeItem("gql-fiddle-dek")` calls (beforeEach/afterEach)
     with a namespace-aware clear (the tests use a fixed `user.id: "u1"`, so
     `localStorage.removeItem("gql-fiddle-dek:u1")`, or more robustly iterate
     `Object.keys(localStorage)` and remove any key starting with
     `"gql-fiddle-dek:"` to stay resilient to the exact scheme).

5. Verification
   - `nix develop -c bash -c "cd web && pnpm test"` — full web suite green,
     including the new namespacing/logout tests.
   - Confirms all three acceptance criteria: #1 two users on one browser get
     distinct cached DEKs (dekCacheKey namespacing); #2 logout clears the
     current user's cached DEK (clearCachedKey wired into auth.ts logout);
     #3 the anon key never collides with an authenticated DEK (separate
     "anon" namespace, never written by initEncryption(userId)).

No further sub-tickets needed — single self-contained change confined to
encryption.ts/sync.ts/auth.ts plus their existing test files, comparable in
scope to sibling tasks TASK-95.1/TASK-95.2 which were each implemented as a
single leaf task without further decomposition.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per plan:

- web/src/encryption.ts: replaced DEK_CACHE_KEY with DEK_CACHE_PREFIX +
  dekCacheKey(userId) helper (falls back to "anon" namespace). Added
  module-level currentUserId (mirrors dekPromise pattern). loadLocalKey()
  reads/writes via dekCacheKey(currentUserId). initEncryption(userId) now
  requires a userId param, sets currentUserId first, and every localStorage
  access downstream (success path + fallback catch branches) goes through
  the namespaced key. Added exported clearCachedKey() that removes the
  current namespace's entry and resets currentUserId/dekPromise to null.
  Updated file header to document the localStorage tradeoff (weakens
  confidentiality only against a local/XSS attacker, never the server;
  cleared on explicit logout only).
- web/src/sync.ts: onLogin's initEncryption() call now passes
  useAuth.getState().user!.id (non-null assertion safe: onLogin only runs
  on transition into status === "authed", which setAuth() only sets when
  user is non-null).
- web/src/auth.ts: logout()'s finally block now also calls clearCachedKey()
  after setAuth(null), so the logged-out user's cached DEK is removed before
  another user can log in on the same browser profile.
- web/src/encryption.test.ts: updated all initEncryption() call sites to
  initEncryption("u1"); added a new "per-user DEK cache namespacing" describe
  block with two tests: (a) two different users produce distinct, non-
  colliding localStorage entries; (b) clearCachedKey() removes only the
  current user's entry, and a subsequent getOrCreateKey() (anon path)
  reads/writes gql-fiddle-dek:anon without colliding with the cleared user's
  prior key.
- web/src/sync-encryption.integration.test.ts: replaced the two
  localStorage.removeItem("gql-fiddle-dek") calls with a new
  clearAllCachedDeks() helper that iterates Object.keys(localStorage) and
  removes any key starting with "gql-fiddle-dek:", staying resilient to the
  exact namespace scheme.

Verification: `nix develop -c bash -c "cd web && pnpm test"` — 393/393 tests
passing across 18 files. `pnpm exec tsc --noEmit` clean. `pnpm lint` — 0
errors (2 pre-existing unrelated warnings in App.tsx). `prettier --check` on
all touched files passes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Namespaced the localStorage-cached DEK by user id (gql-fiddle-dek:<userId>, falling back to gql-fiddle-dek:anon), wired a new clearCachedKey() into logout, and updated encryption.test.ts / sync-encryption.integration.test.ts to cover distinct per-user caching, logout clearing, and anon/authed non-collision. Full web test suite (393 tests), tsc, lint, and prettier all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
