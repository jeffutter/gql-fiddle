---
id: TASK-80
title: >-
  fix(tours): clicking a union type in the schema editor does not set a step
  anchor
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 19:01'
updated_date: '2026-06-23 19:51'
labels:
  - fix
  - tours
  - rust
  - web
  - planned
dependencies: []
priority: medium
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When authoring a tour step, clicking on a `union` definition in the schema editor silently does nothing — no anchor is set. The same gap prevents the gutter decoration from appearing if a union anchor were somehow already stored.

## Root cause

Two places only handle `Object` and `Interface`, skipping `Union`:

### 1. `crates/gql-core/src/node_at_pos.rs`

The `match ext_type` block (around line 53) has arms for `ExtendedType::Object` and `ExtendedType::Interface` but falls through to `_ => {}` for `ExtendedType::Union`. Union types have no fields (only member types), so the fix is a new arm that checks the union's span and returns `{ "typeName": "..." }` when the click lands on it:

```rust
ExtendedType::Union(union_def) => {
    if union_def.is_built_in() {
        continue;
    }
    if let Some(range) = union_def.line_column_range(sources) {
        if contains(range) {
            return json!({ "typeName": type_name.as_str() });
        }
    }
}
```

Add a unit test covering a `union SearchResult = Product | Review` SDL to verify the fix.

### 2. `web/src/App.tsx` — anchor decoration effect (around line 447)

The regex that locates the type declaration line for the gutter dot:

```ts
new RegExp(`^(type|interface)\\s+${anchor.typeName}[\\s{@]`)
```

must also match `union`:

```ts
new RegExp(`^(type|interface|union)\\s+${anchor.typeName}[\\s{@]`)
```

The same `type|interface` pattern appears on line 432 (field-level search, inside a type block) — that one does not need changing since unions have no fields.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clicking on a union keyword line or union name in the schema editor sets the step anchor to that union type
- [ ] #2 The gutter dot decoration appears on the correct union declaration line after the anchor is set
- [ ] #3 Clicking the same union line again clears the anchor (toggle behavior, consistent with object/interface types)
- [ ] #4 A unit test in node_at_pos.rs covers union type click resolution
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

This is a focused two-file fix with one new unit test. No sub-tickets are needed — all changes must ship together for the feature to be complete.

The bug has two independent gaps that both need closing:

1. **Rust (`node_at_pos.rs`):** The `match ext_type` block handles `Object` and `Interface` but falls through to `_ => {}` for `ExtendedType::Union`. Clicking anywhere in a union definition returns `null` instead of the expected `{ "typeName": "..." }`.

2. **TypeScript (`App.tsx`):** The regex used to locate the declaration line for the gutter dot decoration only matches `type` and `interface` keywords, so even if a union anchor were somehow stored, the decoration would never appear.

## File 1: `crates/gql-core/src/node_at_pos.rs`

Add a new match arm between the `Interface` arm and the `_ => {}` fallthrough (around line 100):

```rust
ExtendedType::Union(union_def) => {
    if union_def.is_built_in() {
        continue;
    }
    if let Some(range) = union_def.line_column_range(sources) {
        if contains(range) {
            return json!({ "typeName": type_name.as_str() });
        }
    }
}
```

Notes on the API:
- `Node<UnionType>` has both `is_built_in()` and `line_column_range(sources)` via the `Node<T>` blanket impl in `apollo-compiler-1.32.0/src/node.rs`.
- Unions have no fields (only `members`), so there is no inner loop — the entire block resolves to `typeName` only, matching `Object`/`Interface` type-level (non-field) resolution.
- Pattern matches `ExtendedType::Union(union_def)` where `union_def: &Node<UnionType>`.

Also add a new unit test in the `#[cfg(test)]` block. Extend `TEST_SDL` or use a separate constant:

```rust
#[test]
fn union_type_line_returns_type_name() {
    let sdl = "\
type Query {\n\
  search: SearchResult\n\
}\n\
union SearchResult = Product | Review\n\
type Product {\n\
  id: ID!\n\
}\n\
type Review {\n\
  body: String\n\
}\n";
    // Line 4: `union SearchResult = Product | Review`
    let result = node_at_position(sdl, 4, 7);
    assert_eq!(result["typeName"].as_str().unwrap(), "SearchResult");
    assert!(result.get("fieldName").is_none(), "unions have no fields");
}
```

Verify with: `cargo test -p gql-core node_at_pos`

## File 2: `web/src/App.tsx` — anchor decoration effect (~line 447)

Change the regex in the `else` branch (type/interface declaration line search):

```ts
// Before:
new RegExp(`^(type|interface)\\s+${anchor.typeName}[\\s{@]`)

// After:
new RegExp(`^(type|interface|union)\\s+${anchor.typeName}[\\s{@]`)
```

Do NOT change the `type|interface` regex on line ~432 (the field-search `inType` guard). That guard intentionally excludes unions because unions have no field declarations to search within.

## Verification

1. Run Rust unit tests: `cargo test -p gql-core`
2. Run TypeScript build/lint: `cd web && npm run build` (or equivalent)
3. Manual smoke test in the app:
   - Open schema editor with a union type (e.g. `union SearchResult = Product | Review`)
   - In tour authoring mode, click the union keyword line → anchor should be set to `{ typeName: "SearchResult" }`
   - Verify the gutter dot appears on the union declaration line
   - Click the same line again → anchor should clear (toggle behavior)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

Fixed two independent gaps that prevented union types from working as tour step anchors:

1. ****: Added  arm in the  block. Unions have no fields (only member types), so the arm checks the union's span and returns  when the click position falls within it. Also added  unit test covering a  SDL.

2. **** (~line 448): Extended the type-declaration regex from  to  so the gutter dot decoration correctly locates union declaration lines. The field-search regex at ~line 432 was intentionally left unchanged since unions have no fields.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed union type click resolution in both Rust and TypeScript: added ExtendedType::Union arm in node_at_pos.rs so clicking a union type sets the anchor, added a unit test covering that case, and extended the App.tsx gutter decoration regex to also match union keyword so the gutter dot appears on union declaration lines.
<!-- SECTION:FINAL_SUMMARY:END -->
