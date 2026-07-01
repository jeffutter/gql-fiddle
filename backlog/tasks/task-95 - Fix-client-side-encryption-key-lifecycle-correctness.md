---
id: TASK-95
title: Fix client-side encryption key lifecycle correctness
status: Blocked
assignee: []
created_date: '2026-07-01 00:27'
updated_date: '2026-07-01 16:03'
labels:
  - review
  - planned
dependencies:
  - TASK-95.1
  - TASK-95.2
  - TASK-95.3
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent tracking ticket. Crypto primitives in web/src/encryption.ts (AES-256-GCM, unique random IVs, KWK/DEK split) are sound, but the key lifecycle has correctness gaps that can cause silent, unrecoverable data corruption. Subtasks address decrypt-failure handling, first-login DEK race, and per-user DEK caching.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Pure tracking ticket -- no direct implementation of its own. All three key-lifecycle
correctness gaps found in the web/src/encryption.ts code review are fully delegated
to sub-tickets, each independently testable and shippable:

1. TASK-95.1 (surface decryption failures instead of silently returning ciphertext
   as plaintext) -- must land first. decrypt() currently falls back to returning
   the raw CE1:/E1: string when aesGcmDecrypt() returns null, which corrupts
   downstream JSON parsing and can leak ciphertext into UI (e.g. a workspace
   name). This also gates TASK-95.2's "adopt the server DEK" behavior, since a
   caller can't safely tell wrong-key-for-known-prefix apart from genuine legacy
   plaintext until this is fixed.
2. TASK-95.2 (make wrapped-DEK PUT idempotent + adopt server DEK on first login)
   -- already declares TASK-95.1 as a dependency (server functions/api/auth/enc-meta.ts
   onRequestPut currently always overwrites wrapped_dek; setWrappedDek in
   functions/_lib/db.ts needs a conditional-write / read-back-if-exists path, and
   the client initEncryption() needs to adopt whatever wrapped_dek the PUT
   response returns rather than assuming its own generated DEK won the race).
3. TASK-95.3 (namespace the cached localStorage DEK per user + clear on logout)
   -- independent of the other two; touches DEK_CACHE_KEY handling in
   web/src/encryption.ts (loadLocalKey/initEncryption) and the logout path that
   currently never clears gql-fiddle-dek.

Suggested execution order: TASK-95.1 -> TASK-95.2, with TASK-95.3 done any time
(no shared code with the other two beyond encryption.ts).

Integration/verification once all three are done:
- Re-read web/src/encryption.ts and functions/api/auth/enc-meta.ts end-to-end and
  confirm the three fixes compose cleanly (decrypt() never returns ciphertext as
  plaintext, the enc-meta PUT/adopt flow is race-free, and the localStorage cache
  key is consistently namespaced by user id everywhere it's read/written/cleared).
- Run the full web test suite (nix develop -c bash -c "cd web && pnpm test") plus
  any new regression tests added by each sub-ticket (wrong-key decrypt, two
  simulated first-login devices, two users on one browser profile).
- Manually verify via the dev server: a tampered/wrong-key CE1: value surfaces an
  error instead of garbage; two browsers racing first login converge on one DEK
  and both can decrypt prior uploads; logging out one user and into another on
  the same browser does not expose or collide with the first user's cached DEK.
- No further direct work on TASK-95 itself; close it once all three sub-tickets
  are Done.
<!-- SECTION:PLAN:END -->
