---
id: TASK-78.3
title: >-
  Add Mock Config tab UI, js-yaml dependency, YAML→JSON bridge, and YAML parse
  error banner
status: Done
assignee: []
created_date: '2026-06-23 03:24'
updated_date: '2026-06-23 03:39'
labels:
  - task
  - web
  - ui
dependencies: []
parent_task_id: TASK-78
priority: medium
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Install `js-yaml` (and `@types/js-yaml`) as a web dependency. Add a right-aligned **Mock Config** tab to the query panel tab strip in `App.tsx` (both desktop and mobile layouts). When active, render a Monaco `language: \"yaml\"` editor bound to `mockConfig` from the store, using the same `EDITOR_OPTIONS` and `MONACO_THEME` constants. Add a `parseYamlToJson(yaml: string): string` helper that returns `\"{}\"` on parse failure and sets a `configError` state string. Pass the resulting JSON string as the 4th argument to `core.executeMock`. Render a non-blocking warning callout banner above the results panel when `configError` is non-null. Show a comment-only placeholder when the YAML editor is empty. Update the TypeScript wrapper in `core/index.ts` and `GqlCore` interface in `core/types.ts` to accept the new `mockConfig` argument on `executeMock`.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Installed js-yaml + @types/js-yaml. Updated GqlCore interface and core/index.ts wrapper to accept 4th mockConfig arg. Added showMockConfig state, configError state, parseYamlToJson helper to App.tsx. Updated queryTabStrip to add right-aligned Mock Config tab. Desktop and mobile layouts now conditionally show YAML Monaco editor or query editor based on showMockConfig. Added configError warning banner above results. Updated core/index.test.ts for new arg.
<!-- SECTION:NOTES:END -->
