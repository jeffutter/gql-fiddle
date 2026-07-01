---
id: TASK-95
title: Fix client-side encryption key lifecycle correctness
status: Backlog
assignee: []
created_date: '2026-07-01 00:27'
labels:
  - review
dependencies: []
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parent tracking ticket. Crypto primitives in web/src/encryption.ts (AES-256-GCM, unique random IVs, KWK/DEK split) are sound, but the key lifecycle has correctness gaps that can cause silent, unrecoverable data corruption. Subtasks address decrypt-failure handling, first-login DEK race, and per-user DEK caching.
<!-- SECTION:DESCRIPTION:END -->
