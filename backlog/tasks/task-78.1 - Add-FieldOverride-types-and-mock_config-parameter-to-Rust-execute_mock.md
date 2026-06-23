---
id: TASK-78.1
title: Add FieldOverride types and mock_config parameter to Rust execute_mock
status: Done
assignee: []
created_date: '2026-06-23 03:23'
updated_date: '2026-06-23 03:39'
labels:
  - task
  - rust
  - wasm
dependencies: []
parent_task_id: TASK-78
priority: high
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend `crates/gql-core/src/mock.rs` with the `FieldOverride` and `MockConfig` types, wire a new 4th `mock_config: &str` JSON parameter into `execute_mock`, and apply override logic in the field-walker. Update the WASM binding in `lib.rs` to match. Add Rust unit tests covering all four override variants and the no-regression case.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented FieldOverride struct and MockConfig type alias in mock.rs. Added 4th `mock_config: &str` parameter to execute_mock (JSON string, defaults to {} on parse error). Threaded config through walk_selection_set, walk_fields, resolve_field. Added apply_override function handling all 4 variants. Updated WASM binding in lib.rs. Added 8 unit tests for all override variants. Rebuilt WASM.
<!-- SECTION:NOTES:END -->
