---
id: TASK-78
title: Add YAML Mock Config panel to control fake data generation
status: To Do
assignee: []
created_date: '2026-06-23 02:56'
labels:
  - feature
  - mock
  - ui
dependencies: []
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
- [ ] #1 User can open a Mock Config tab in the query panel (right-aligned, visually distinct from query tabs)
- [ ] #2 Mock Config tab shows a Monaco YAML editor with a comment placeholder when empty
- [ ] #3 YAML config is persisted to localStorage and survives page refresh
- [ ] #4 YAML config is included in share URLs (WorkspacePayload.mockConfig)
- [ ] #5 Store migration v1→v2 sets mockConfig: '' for existing saved workspaces
- [ ] #6 `enum` override: field returns a value from the list, chosen by hash % list.len() (still deterministic)
- [ ] #7 `unionType` override: union/interface field resolves to the named concrete type; falls back to hash-pick if the name is not a valid member
- [ ] #8 `value` override: field always emits the specified scalar
- [ ] #9 `null` override: nullable field always emits JSON null; NonNull fields ignore it
- [ ] #10 YAML parse errors show a non-blocking warning banner above the results panel; query still runs with defaults
- [ ] #11 Invalid `unionType` names fall back silently to hash-pick (no crash)
- [ ] #12 execute_mock WASM signature updated to accept mock_config as 4th JSON string argument
- [ ] #13 Passing mock_config='{}' produces identical output to the current behaviour (no regression)
<!-- AC:END -->
