---
id: TASK-78
title: Add YAML Mock Config panel to control fake data generation
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 02:56'
updated_date: '2026-06-23 03:40'
labels:
  - feature
  - mock
  - ui
  - planned
dependencies:
  - TASK-78.1
  - TASK-78.2
  - TASK-78.3
priority: medium
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

The mock executor generates fake data deterministically from a seed, but there is currently no way to control _what_ it generates (e.g. constrain a String to a set of values, or force a union to always resolve to a specific concrete type). Custom GraphQL directives were considered but rejected because they pollute the schema and break copy-paste workflows.

## Solution

Add a separate **Mock Config** YAML panel — entirely out-of-band from the schema — that maps `TypeName.fieldName` keys to generator override rules. The config is stored in the workspace store, persisted to localStorage, and included in share URLs.

---

## Architecture & Data Flow

1. User edits YAML in the new Mock Config panel.
2. On Run, the browser parses YAML → JSON via `js-yaml`.
3. The JSON config string is passed to the Rust WASM as a new 4th argument to `execute_mock`.
4. Inside Rust, the config is deserialized into a `HashMap<String, FieldOverride>`. During field-walking, before falling through to the default generator, the walker checks for a `"TypeName.fieldName"` key and applies the override if found.

---

## YAML Config Format

```yaml
User.role:
  enum: [ADMIN, VIEWER]

Query.search:
  unionType: Product

Product.price:
  value: 42

User.deletedAt:
  null: true
```

### Override types (v1)

| Key | Behaviour |
|---|---|
| `enum: [...]` | Picks from the list by `hash % list.len()` — still deterministic and seed-controlled |
| `unionType: TypeName` | Forces a union/interface field to always resolve to the named concrete type; falls back to hash-pick if the name is invalid |
| `value: <scalar>` | Always emits this exact JSON scalar value |
| `null: true` | Always emits JSON `null` (ignored on NonNull fields) |

---

## Rust Changes (`crates/gql-core/src/mock.rs`)

New types:

```rust
#[derive(Deserialize, Default)]
struct FieldOverride {
    #[serde(rename = "enum")]
    enum_values: Option<Vec<String>>,
    #[serde(rename = "unionType")]
    union_type: Option<String>,
    value: Option<serde_json::Value>,
    #[serde(rename = "null")]
    always_null: Option<bool>,
}

type MockConfig = HashMap<String, FieldOverride>;
```

`execute_mock` gains a 4th parameter `mock_config: &str` (JSON string; `"{}"` when empty). The lookup key used during field-walking is `format!("{object_type}.{field_name}")`.

WASM binding in `lib.rs` updated to match.

---

## Web Store Changes (`web/src/store.ts`)

- New field: `mockConfig: string` (raw YAML, `""` default)
- New action: `setMockConfig: (yaml: string) => void`
- Added to `partialize` (persisted to localStorage)
- `WorkspacePayload` in `share.ts` gains `mockConfig?: string` (optional for backward compat)
- Store version bumps `1 → 2`; migration for v1 spreads in `mockConfig: ""`

---

## UI Changes (`web/src/App.tsx`)

- The query panel tab strip gets a right-aligned **Mock Config** tab (`margin-left: auto`) — visually separated from the query tabs to make clear it is global, not per-query.
- Tab strip shape: `[ Query 1 ] [ Query 2 ] [ + ]          [ Mock Config ]`
- When selected, replaces the query editor with a Monaco editor (`language: "yaml"`) using the same `EDITOR_OPTIONS`.
- Empty config shows a comment-only placeholder explaining the format.
- YAML parse errors surface as a non-blocking warning banner above the results panel; the query still runs with defaults for broken entries.

---

## New Dependency

- `js-yaml` (web) — for parsing the YAML string to a JS object before `JSON.stringify`.

---

## Helper

```ts
function parseYamlToJson(yaml: string): string {
  // Returns "{}" and sets configError state on parse failure.
}
```
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User can open a Mock Config tab in the query panel (right-aligned, visually distinct from query tabs)
- [x] #2 Mock Config tab shows a Monaco YAML editor with a comment placeholder when empty
- [x] #3 YAML config is persisted to localStorage and survives page refresh
- [x] #4 YAML config is included in share URLs (WorkspacePayload.mockConfig)
- [x] #5 Store migration v1→v2 sets mockConfig: '' for existing saved workspaces
- [x] #6 `enum` override: field returns a value from the list, chosen by hash % list.len() (still deterministic)
- [x] #7 `unionType` override: union/interface field resolves to the named concrete type; falls back to hash-pick if the name is not a valid member
- [x] #8 `value` override: field always emits the specified scalar
- [x] #9 `null` override: nullable field always emits JSON null; NonNull fields ignore it
- [x] #10 YAML parse errors show a non-blocking warning banner above the results panel; query still runs with defaults
- [x] #11 Invalid `unionType` names fall back silently to hash-pick (no crash)
- [x] #12 execute_mock WASM signature updated to accept mock_config as 4th JSON string argument
- [x] #13 Passing mock_config='{}' produces identical output to the current behaviour (no regression)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

This feature adds an out-of-band YAML Mock Config panel that lets users control what the deterministic mock executor generates, without polluting the GraphQL schema with directives. Work is split into three sub-tickets executed in the order below.

## Sub-ticket Execution Order

### 1. TASK-78.1 — Rust/WASM layer (do first)
Add `FieldOverride` + `MockConfig` types to `crates/gql-core/src/mock.rs`. Extend the internal `execute_mock` function signature to accept a `mock_config: &str` JSON string (defaulting to `"{}"` when absent). Apply override lookup during field-walking using the key `"{object_type}.{field_name}"`. Update the `#[wasm_bindgen]` export in `lib.rs` to pass the new argument. Add unit tests for all four override variants (`enum`, `unionType`, `value`, `null`) and the no-regression case (`"{}"` → identical output to current behavior).

After this sub-ticket, rebuild WASM: `pnpm build:wasm` from `web/`. The generated `web/src/wasm/gql_core.d.ts` will show `execute_mock` accepting a 4th `string` parameter — this will temporarily break the TypeScript build until TASK-78.3 updates the TS wrapper.

### 2. TASK-78.2 — Web store + share layer (second)
- `web/src/store.ts`: add `mockConfig: string` field (default `""`), `setMockConfig` action, include in `partialize`, bump version 1→2, add v1→v2 migration that spreads `mockConfig: ""`.
- `web/src/share.ts`: add `mockConfig?: string` to `WorkspacePayload` (optional for backward compat), update `encode` to include it, update `decode` to fall back to `""` when absent.
- Update `computeOverrides` in `store.ts` to diff `mockConfig`.
- Extend tests in `store.test.ts` (migration, setMockConfig) and `share.test.ts` (round-trip with and without `mockConfig`, backward compat decode).

### 3. TASK-78.3 — UI layer (last, unblocks full integration)
- Install `js-yaml` + `@types/js-yaml` via `pnpm add js-yaml` + `pnpm add -D @types/js-yaml`.
- Update `GqlCore` interface in `core/types.ts` and `executeMock` wrapper in `core/index.ts` to accept a 4th `mockConfig: string` arg, forwarding it as a JSON string to `execute_mock`.
- Add Mock Config tab button to the query panel tab strip in `App.tsx`, right-aligned via `margin-left: auto`, in both desktop and mobile layouts. Use a `showMockConfig: boolean` state variable to toggle between the query editor and the YAML editor.
- When the Mock Config tab is active, render `<Editor language="yaml" ... value={mockConfig} onChange={(v) => setMockConfig(v ?? "")} />` using `EDITOR_OPTIONS` and `MONACO_THEME`. Placeholder: a comment block explaining the format (shown when the editor value is empty/whitespace only via `defaultValue`).
- Add `parseYamlToJson(yaml: string, setConfigError: (s: string | null) => void): string` — calls `jsYaml.load(yaml)`, catches errors (sets `configError`), returns `JSON.stringify(result) ?? "{}"`.
- In `doRun`, pass `parseYamlToJson(mockConfig, setConfigError)` as the 4th arg.
- Render a `.callout--warning` banner above the results panel when `configError !== null`.

## Integration & Verification
- Run `cargo test -p gql-core` — all Rust tests pass including the new override tests.
- Rebuild WASM, run `pnpm test run` — all TS unit tests pass.
- Manual smoke test: set `User.name: {enum: [Alice, Bob]}` in Mock Config, run the default query, verify `name` fields only contain "Alice" or "Bob"; change seed, verify values change deterministically.
- Verify share URL round-trip: copy share URL with a non-empty Mock Config, open in a new tab, confirm the YAML is restored and execution uses the override.
- Verify backward compat: decode a URL without `mockConfig` — execution uses defaults (equivalent to `"{}"`).
- Verify YAML parse error: enter invalid YAML (e.g. `foo: [unclosed`), click Run — warning banner appears, query runs, results show default values.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All three sub-tickets completed in order: 78.1 (Rust/WASM), 78.2 (web store+share), 78.3 (UI layer).

Key files changed:
- crates/gql-core/src/mock.rs — FieldOverride, MockConfig, apply_override, 4th param
- crates/gql-core/src/lib.rs — WASM export updated
- crates/gql-core/tests/mock.rs — updated all calls
- web/src/wasm/ — rebuilt WASM bindings
- web/src/core/types.ts — GqlCore.executeMock 4th arg
- web/src/core/index.ts — wrapper updated
- web/src/store.ts — mockConfig field, setMockConfig, partialize, v1→2 migration
- web/src/share.ts — WorkspacePayload.mockConfig?, decode backward compat
- web/src/App.tsx — jsYaml import, parseYamlToJson, showMockConfig state, Mock Config tab, YAML editor, configError banner
- web/package.json — js-yaml + @types/js-yaml added

All tests: 71 Rust + 304 TS all passing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the full YAML Mock Config feature across three layers:\n\n**Rust/WASM (TASK-78.1):** Added `FieldOverride` struct and `MockConfig` type to `mock.rs`. Extended `execute_mock` with a 4th `mock_config: &str` JSON parameter. Added `apply_override` function handling all four variants: `enum` (hash-picks from list), `unionType` (forces concrete type, falls back on invalid name), `value` (emits literal JSON), `null` (emits null on nullable fields only). Updated WASM binding in `lib.rs`. Added 8 unit tests covering all variants + no-regression case.\n\n**Web store + share (TASK-78.2):** Added `mockConfig: string` field and `setMockConfig` action to Zustand store. Added to `partialize` for localStorage persistence. Bumped store version 1→2 with migration. Added optional `mockConfig?` to `WorkspacePayload` in `share.ts` with backward-compat decode. Updated `computeOverrides` to diff `mockConfig`.\n\n**UI (TASK-78.3):** Installed `js-yaml` + `@types/js-yaml`. Added right-aligned Mock Config tab to query tab strip (desktop + mobile). Toggle between YAML editor and query editor via `showMockConfig` state. Comment-only placeholder when empty. `parseYamlToJson` helper converts YAML→JSON for `executeMock`, sets `configError` on failure. Non-blocking warning banner above results on parse error.\n\nAll 71 Rust tests + 304 TypeScript tests pass. Cargo fmt, clippy, ESLint, Prettier, tsc all clean."]
<!-- SECTION:FINAL_SUMMARY:END -->
