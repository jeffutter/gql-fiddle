---
id: TASK-99
title: 'Enforce payload cap by bytes, pre-parse, and bound workspace name'
status: Backlog
assignee: []
created_date: '2026-07-01 00:27'
labels:
  - review
dependencies: []
priority: medium
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-DEF-1.00, SEC-ERR-1.00. functions/api/workspaces/[id].ts:23-47 checks payload.length (UTF-16 code units, not bytes), parses the whole body into memory before the size check, and leaves name unbounded. On the Workers free tier this is a memory/CPU DoS vector and lets stored size exceed the documented 1 MB contract. Fix: reject early on the Content-Length header, measure payload bytes with TextEncoder, and add a bound on name length.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a >1 MB body is rejected with 413 before the full JSON parse
- [ ] #2 multi-byte payloads are measured in bytes, not UTF-16 length
- [ ] #3 an oversized name is rejected with 400
<!-- AC:END -->
