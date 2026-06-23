---
id: TASK-80
title: >-
  fix(tours): clicking a union type in the schema editor does not set a step
  anchor
status: To Do
assignee: []
created_date: '2026-06-23 19:01'
labels:
  - fix
  - tours
  - rust
  - web
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
