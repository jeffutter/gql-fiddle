---
id: TASK-57.1
title: Install @xyflow/react and elkjs dependencies
status: Done
assignee: []
created_date: '2026-06-16 21:53'
updated_date: '2026-06-16 22:02'
labels:
  - task
  - planned
dependencies: []
references:
  - web/package.json
parent_task_id: TASK-57
priority: high
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add `@xyflow/react` (v12) and `elkjs` to the web package dependencies. These are required by the Type Graph tab (TASK-57). Neither package is currently installed.\n\nRun from the `web/` directory:\n\n```\npnpm add @xyflow/react elkjs\npnpm add -D @types/elkjs\n```\n\nVerify both packages appear in `web/package.json` under `dependencies`. `elkjs` is loaded via dynamic `import()` at runtime (lazy) so it belongs in `dependencies`, not `devDependencies`.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Run from the `web/` directory:

```sh
pnpm add @xyflow/react elkjs
pnpm add -D @types/elkjs
```

Verify both packages appear in `web/package.json` under `dependencies`. `@xyflow/react` and `elkjs` are runtime dependencies. `@types/elkjs` is a dev dependency for TypeScript types.

No other files need changing in this sub-task.
<!-- SECTION:PLAN:END -->
