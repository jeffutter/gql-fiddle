---
id: TASK-118
title: 'Fix: KWK creation race can leave two devices with different key-wrapping keys'
status: To Do
assignee: []
created_date: '2026-07-01 20:50'
labels:
  - review-fix
dependencies: []
ordinal: 149000
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
