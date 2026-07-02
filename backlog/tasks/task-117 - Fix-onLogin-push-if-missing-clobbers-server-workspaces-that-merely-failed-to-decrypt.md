---
id: TASK-117
title: >-
  Fix: onLogin push-if-missing clobbers server workspaces that merely failed to
  decrypt
status: To Do
assignee: []
created_date: '2026-07-01 20:50'
labels:
  - review-fix
dependencies: []
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduced by TASK-95.1's change to pullWorkspaces() (web/src/sync.ts): rows that
throw DecryptionError are now silently omitted from the returned rows/cursor
result instead of being included (previously they came back with garbage
plaintext, but were still present in the array).

initEncryption's onLogin() flow (web/src/sync.ts, "Push workspaces that exist
locally but not on the server" loop, ~lines 261-274) builds
`remoteIds = new Set(rows.map((r) => r.id))` from that same filtered array,
then treats any local workspace whose id is absent from remoteIds as
"local-only, never pushed" and pushes it with `pushWorkspace(bumped)` using
its current (unbumped) version.

Every workspace gets a client-generated UUID at creation time (see
makeDefaultWorkspace in web/src/store.ts), independent of sync state, so a
workspace that was previously synced under a *different* DEK (e.g. this
device lost a first-login DEK race, or its cached DEK is otherwise stale)
will still be present locally with the same id as the server row. If that
server row now fails to decrypt on this login (wrong key), it's dropped from
`rows`/`remoteIds`, so the onLogin loop misclassifies it as "not on server"
and PUTs the local copy — which the server accepts (version >= stored) —
overwriting the previously-working encrypted server row with content
encrypted under this client's (deviant) key.

Net effect: a decrypt failure on login silently destroys the server's (and
every other device's) copy of that workspace, instead of merely skipping it
as intended by TASK-95.1/95.2. This is worse than the original bug those
tickets fixed.

Suggested fix: pullWorkspaces() (or onLogin) needs to track ids of rows that
existed on the server but failed to decrypt, separately from rows that
genuinely don't exist server-side, and exclude the former from the
"push as new" loop (e.g. surface skipped ids alongside `rows`/`cursor` and
have onLogin subtract them from the "needs push" set, or skip pushing
entirely and surface a user-visible warning instead).
<!-- SECTION:DESCRIPTION:END -->
