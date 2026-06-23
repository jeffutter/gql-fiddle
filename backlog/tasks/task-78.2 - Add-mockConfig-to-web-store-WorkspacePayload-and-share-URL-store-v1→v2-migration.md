---
id: TASK-78.2
title: >-
  Add mockConfig to web store, WorkspacePayload, and share URL (store v1→v2
  migration)
status: Done
assignee: []
created_date: '2026-06-23 03:23'
updated_date: '2026-06-23 03:39'
labels:
  - task
  - web
  - store
dependencies: []
parent_task_id: TASK-78
priority: high
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire `mockConfig: string` (raw YAML, default `""`) into the Zustand workspace store, the `WorkspacePayload` type in `share.ts`, and localStorage persistence. Specific changes: add `mockConfig` field and `setMockConfig` action to `WorkspaceState`; add `mockConfig` to `partialize`; bump store version from 1 to 2 with a migration that spreads `mockConfig: ""` for v1 payloads; add optional `mockConfig?: string` to `WorkspacePayload` in `share.ts`; update `encode`/`decode` to include `mockConfig` and handle absence for backward compat; update `computeOverrides` in `store.ts` to include `mockConfig` in the diff. Add/extend unit tests in `store.test.ts` and `share.test.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added mockConfig: string field and setMockConfig action to WorkspaceState. Added mockConfig to partialize. Bumped store version 1→2 with migration. Added mockConfig? to WorkspacePayload in share.ts. Updated decode() for backward compat. Updated computeOverrides to diff mockConfig. Updated snapshotCurrentToStep and copyShareUrl/createTour in App.tsx. Added tests in store.test.ts and share.test.ts.
<!-- SECTION:NOTES:END -->
