---
id: TASK-112
title: Fix auto-run ignoring Mock Config edits
status: Done
assignee: []
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 03:04'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/App.tsx:696-709 — the auto-run effect depends on [currentQuery, supergraphSdl, seed] but doRun reads mockConfig via closure (parseYamlToJson(mockConfig) ~line 1149). Editing the Mock Config YAML changes what the mock executor should produce, but the auto-run effect never re-fires, so the user sees no change until they touch the query/seed or click Run. Fix: add mockConfig to the auto-run effect's dependency array.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 editing the Mock Config YAML re-runs the query and updates the Output pane
- [x] #2 no auto-run infinite loop is introduced
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
**Problem:** The auto-run effect (App.tsx:558–570) depends on `[currentQuery, supergraphSdl, seed]`. The `doRun` function (line 968) reads `mockConfig` via closure (`parseYamlToJson(mockConfig)` at line 970). Editing the Mock Config YAML doesn't trigger a re-run.

**Fix:** Add `mockConfig` to the dependency array on line 570:
```diff
-  }, [currentQuery, supergraphSdl, seed]);
+  }, [currentQuery, supergraphSdl, seed, mockConfig]);
```

**Why this is safe:**
- `mockConfig` is a plain string (from `activeWs.mockConfig` at line 265). React's dependency comparison uses `Object.is` — a string change will trigger the effect.
- No infinite loop risk: the effect calls `doRun` which updates state (`setMockResult`, `setPlanResult`, `setIsRunning`), but those state changes don't modify `mockConfig`. The only values in the dep array that could change are the ones the user edits (query text, subgraph SDL, seed, mock config YAML). None of those are written by `doRun`.
- `AUTO_RUN_DEBOUNCE_MS` (300 ms) already guards against rapid re-firing.

**Verification:** Edit Mock Config YAML → query auto-runs → Output pane updates with new mock data.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added `mockConfig` to the auto-run effect dependency array in `web/src/App.tsx:570`. This ensures the effect re-fires when the Mock Config YAML changes, causing `doRun` to read the updated config via closure and re-execute the mock query.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Single-line fix in `web/src/App.tsx`: added `mockConfig` to the auto-run effect's dependency array (`[currentQuery, supergraphSdl, seed, mockConfig]`). The `doRun` function already reads `mockConfig` via closure, so the effect was silently ignoring changes to the Mock Config editor. TypeScript checks pass cleanly.
<!-- SECTION:FINAL_SUMMARY:END -->
