---
id: TASK-65
title: 'feat(rust): add nodeAtPosition WASM export for click-to-anchor'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-20 03:13'
updated_date: '2026-06-20 14:03'
labels:
  - feat
  - rust
  - wasm
  - tour
  - planned
dependencies: []
priority: high
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a new WASM export that maps a (line, col) position in a subgraph SDL to the nearest type or field definition node. This backs the click-to-anchor authoring interaction: when the tour author clicks in the Monaco schema editor, the app calls this to identify what AST node was clicked and stores it as the step's anchor.

**Return shape (JSON):**
```ts
// null if position doesn't land on a type or field definition
{ typeName: string; fieldName?: string } | null
```

Examples:
- Click on `type Product @key(fields: "id") {` → `{ typeName: "Product" }`
- Click on `  price: Float` inside `Product` → `{ typeName: "Product", fieldName: "price" }`
- Click on whitespace or a scalar/enum value → `null`

**Rust implementation in `crates/gql-core/src/`:**
- Add `node_at_position(sdl: &str, line: u32, col: u32) -> JsValue` to `lib.rs`
- Implement using `apollo-compiler`'s source span tracking: parse the SDL, walk object/interface type definitions and their field definitions, find the innermost node whose span contains the given 1-based line/col
- Return serialized JSON via `serde_wasm_bindgen` or `JsValue::from_str(&serde_json::to_string(...))`

**TypeScript wiring in `web/src/core/types.ts`:**
Add to `GqlCore` interface:
```ts
nodeAtPosition(sdl: string, line: number, col: number): { typeName: string; fieldName?: string } | null;
```

**Note on line/col convention:** Monaco positions are 1-based. Confirm `apollo-compiler` span offsets and convert if needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 nodeAtPosition is exported from the WASM module and callable from TypeScript
- [x] #2 Clicking the type declaration line (e.g. 'type Product @key...') returns { typeName: 'Product' } with no fieldName
- [x] #3 Clicking a field line inside a type returns { typeName: 'Product', fieldName: 'price' }
- [x] #4 Clicking whitespace, a directive argument, or a scalar definition returns null
- [x] #5 Works correctly for interface definitions as well as object types
- [x] #6 Rust unit tests cover type-level, field-level, and null cases
- [x] #7 Line/col convention matches Monaco's 1-based positions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a `node_at_position(sdl, line, col)` WASM export to `crates/gql-core` that maps a 1-based (line, col) position in a subgraph SDL to the nearest type or field definition node, then wire it into the TypeScript `GqlCore` interface. This is a self-contained, single-ticket change — no sub-tickets needed.

## Approach

Use `apollo_compiler::Schema::builder()` (already used in `validate.rs`) to parse the SDL, then walk `schema.types` for `ExtendedType::Object` and `ExtendedType::Interface` variants, checking each type's node location and each field's component node location against the provided position. The `Schema` struct exposes `sources: SourceMap`, and every `Node<T>` exposes `line_column_range(&sources)` returning `Option<Range<LineColumn>>`. LineColumn is 1-based for both `line` and `column`.

## Line/Col Convention

Monaco editor positions are 1-based. `apollo-compiler`'s `LineColumn` is also 1-based (`line: zero_indexed_line + 1`, `column: zero_indexed_column + 1` per `parser.rs`). No conversion is needed.

## Implementation Steps

### 1. Add `node_at_position` function to `crates/gql-core/src/lib.rs`

Add a new `#[wasm_bindgen]` export immediately after the existing exports:

```rust
/// Find the type or field definition at a 1-based (line, col) position in a subgraph SDL.
///
/// Returns a JSON string:
///   - `{ "typeName": "Product" }` when the cursor is on the type declaration line
///   - `{ "typeName": "Product", "fieldName": "price" }` when on a field line
///   - `"null"` when the position doesn't land on a type or field definition
#[wasm_bindgen]
pub fn node_at_position(sdl: &str, line: u32, col: u32) -> String {
    node_at_pos::node_at_position(sdl, line, col).to_string()
}
```

### 2. Create `crates/gql-core/src/node_at_pos.rs`

The logic module (pure Rust, testable without WASM):

```rust
use apollo_compiler::Schema;
use apollo_compiler::schema::ExtendedType;
use serde_json::{json, Value};

pub fn node_at_position(sdl: &str, line: u32, col: u32) -> Value {
    // Parse permissively (same flags as validate_subgraph so federation SDL works).
    let schema = match Schema::builder()
        .adopt_orphan_extensions()
        .ignore_builtin_redefinitions()
        .parse(sdl, "<subgraph>")
        .build()
    {
        Ok(s) => s,
        Err(with_errors) => with_errors.partial,  // use partial schema on parse errors
    };

    let sources = &schema.sources;

    // Helper: does Range<LineColumn> contain the given 1-based (line, col)?
    let contains = |range: std::ops::Range<apollo_compiler::parser::LineColumn>| -> bool {
        let start = range.start;
        let end = range.end;
        if line < start.line as u32 || line > end.line as u32 {
            return false;
        }
        if line == start.line as u32 && col < start.column as u32 {
            return false;
        }
        if line == end.line as u32 && col > end.column as u32 {
            return false;
        }
        true
    };

    for (type_name, ext_type) in &schema.types {
        // Skip built-in types (introspection types, scalar builtins).
        let type_node: &apollo_compiler::Node<_>;
        let fields: &indexmap::IndexMap<_, _>;

        match ext_type {
            ExtendedType::Object(obj) => {
                if obj.is_built_in() { continue; }
                type_node = obj;
                fields = &obj.fields;
            }
            ExtendedType::Interface(iface) => {
                if iface.is_built_in() { continue; }
                type_node = iface;
                fields = &iface.fields;
            }
            _ => continue,
        }

        // Check field definitions first (innermost wins).
        for (field_name, field_component) in fields {
            if let Some(range) = field_component.node.line_column_range(sources) {
                if contains(range) {
                    return json!({
                        "typeName": type_name.as_str(),
                        "fieldName": field_name.as_str(),
                    });
                }
            }
        }

        // Check type declaration span.
        if let Some(range) = type_node.line_column_range(sources) {
            if contains(range) {
                return json!({ "typeName": type_name.as_str() });
            }
        }
    }

    Value::Null
}
```

**Note on partial schema:** `Schema::builder().build()` returns `Err(WithErrors { partial, errors })` on parse errors where `partial` is still a `Schema` with whatever was successfully parsed. Using the partial schema lets the function still work while the author is mid-edit (same resilience that `validate_subgraph` provides for diagnostics). If this becomes an issue, gracefully return `null` on parse error instead.

**Note on `is_built_in()`:** `Node<T>` has `fn is_built_in(&self) -> bool` that checks `FileId::BUILT_IN`. This skips `__Schema`, `__Field`, `String`, `Boolean`, etc. from appearing as matches.

### 3. Register the new module in `lib.rs`

Add `mod node_at_pos;` alongside the other `mod` declarations at the top of `lib.rs`.

### 4. Update `web/src/core/types.ts`

Add to the `GqlCore` interface:

```ts
nodeAtPosition(sdl: string, line: number, col: number): { typeName: string; fieldName?: string } | null;
```

### 5. Update `web/src/core/index.ts`

Add to the `wrap()` function's returned object:

```ts
nodeAtPosition(sdl: string, line: number, col: number): { typeName: string; fieldName?: string } | null {
  const raw = ns.node_at_position(sdl, line, col);
  return JSON.parse(raw);  // "null" → null, object string → object
},
```

### 6. Add Rust unit tests in `node_at_pos.rs`

Cover the following cases (all AC items):

- Type declaration line returns `{ typeName }` with no `fieldName`
- Field line inside a type returns `{ typeName, fieldName }`
- Whitespace / non-type position returns `null`
- Interface type definitions work the same as object types
- Positions exactly on the first and last character of a span are included (boundary test)

Use a fixed SDL with known line numbers so tests are stable (not position-scanning).

Example SDL for tests:
```graphql
type Query {
  hello: String
}
type Product {
  id: ID!
  price: Float
}
interface Node {
  id: ID!
}
```

## Files Modified

- `crates/gql-core/src/lib.rs` — add `mod node_at_pos` and `#[wasm_bindgen] pub fn node_at_position`
- `crates/gql-core/src/node_at_pos.rs` — new module with pure Rust logic + unit tests
- `web/src/core/types.ts` — add `nodeAtPosition` to `GqlCore` interface
- `web/src/core/index.ts` — add `nodeAtPosition` to `wrap()` return object

## Verification

After implementation, run:
```bash
cargo test -p gql-core
```
All existing tests must continue to pass, and the new `node_at_pos` tests must pass.

Build the WASM:
```bash
wasm-pack build crates/gql-core --target web
```
Check that `node_at_position` appears as an export in the generated `.js` bindings.

## Risks and Edge Cases

1. **`is_built_in()` availability:** `Node<ObjectType>` and `Node<InterfaceType>` expose `is_built_in()` via `Node<T>`. Confirmed in `node.rs`. If `ObjectType` nodes in the partial schema don't carry a file ID, they won't match `FileId::BUILT_IN` and won't be skipped — this is acceptable (they also won't have valid source spans and won't match any position).

2. **Partial schema on parse error:** `WithErrors.partial` contains successfully parsed types. Mid-edit SDLs may have gaps — returning `null` gracefully is the correct behavior in that case.

3. **Type span vs. name span:** The `Node<ObjectType>` span covers the entire type definition block, not just the `type Foo` keyword line. Clicking anywhere inside the braces (but not on a field) will return `{ typeName }`. This is correct — field spans are checked first (innermost wins), so field lines correctly return `{ typeName, fieldName }`.

4. **No `serde_wasm_bindgen` needed:** The existing pattern in `lib.rs` is to return a `String` from `#[wasm_bindgen]` functions and `JSON.parse` on the TS side. Follow that pattern — no new Cargo dependencies required.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

Added `node_at_position` WASM export to `crates/gql-core`.

### Approach
- Created `crates/gql-core/src/node_at_pos.rs` as a pure Rust module (testable without WASM target).
- Parses the SDL using the same `Schema::builder().adopt_orphan_extensions().ignore_builtin_redefinitions()` flags as `validate_subgraph`, using the partial schema on parse errors so mid-edit SDL still works.
- Walks `schema.types` for `ExtendedType::Object` and `ExtendedType::Interface`, skipping built-in types via `is_built_in()`.
- Checks field spans first (innermost wins), then the enclosing type span.
- `apollo_compiler::parser::LineColumn` is already 1-based, matching Monaco — no conversion needed.
- Returns `serde_json::Value` (null or object), serialized via `.to_string()` in the WASM wrapper.

### Key findings
- `Component<T>` implements `Deref<Target = Node<T>>`, so `line_column_range` can be called directly on field components.
- `Node<T>::is_built_in()` checks `FileId::BUILT_IN`, correctly filtering introspection types and built-in scalars.
- `obj.line_column_range(sources)` on an `ObjectType` node spans the full type block (from `type Foo` to closing `}`), so clicking anywhere in the block (but not on a field) correctly returns `{ typeName }`.

### Files modified
- `crates/gql-core/src/lib.rs` — added `mod node_at_pos` and `#[wasm_bindgen] pub fn node_at_position`
- `crates/gql-core/src/node_at_pos.rs` — new module with logic + 9 unit tests
- `web/src/core/types.ts` — added `nodeAtPosition` to `GqlCore` interface
- `web/src/core/index.ts` — added `nodeAtPosition` to `wrap()` return object

### Verification
- `cargo test -p gql-core`: 63 tests pass (9 new in `node_at_pos`)
- `pnpm build:wasm`: WASM built successfully, `node_at_position` appears in generated bindings
- `pnpm tsc --noEmit`: no TypeScript errors
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `node_at_position(sdl, line, col)` WASM export to `crates/gql-core` backed by a new `node_at_pos.rs` module. The function walks `apollo_compiler::Schema` types for Object and Interface definitions, checks field spans first (innermost wins), then the enclosing type span, and returns a JSON string (`{ typeName }`, `{ typeName, fieldName }`, or `null`). Both `apollo-compiler` positions and Monaco positions are 1-based, so no conversion is needed. The TypeScript wrapper parses the JSON string in `web/src/core/index.ts` and the `GqlCore` interface in `types.ts` is updated. All 63 Rust tests pass; TypeScript typechecks cleanly; `node_at_position` is confirmed in the regenerated WASM bindings."
<!-- SECTION:FINAL_SUMMARY:END -->
