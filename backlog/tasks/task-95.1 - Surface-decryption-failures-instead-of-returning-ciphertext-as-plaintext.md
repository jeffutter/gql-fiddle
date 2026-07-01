---
id: TASK-95.1
title: Surface decryption failures instead of returning ciphertext as plaintext
status: Backlog
assignee: []
created_date: '2026-07-01 00:29'
labels:
  - review
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
- [ ] #1 a CE1: value that fails to decrypt yields a surfaced error or skipped row, never the raw ciphertext
- [ ] #2 legacy no-prefix plaintext still round-trips
- [ ] #3 a unit test covers wrong-key decryption
<!-- AC:END -->
