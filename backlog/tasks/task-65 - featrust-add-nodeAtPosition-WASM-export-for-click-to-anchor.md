---
id: TASK-65
title: 'feat(rust): add nodeAtPosition WASM export for click-to-anchor'
status: To Do
assignee: []
created_date: '2026-06-20 03:13'
labels:
  - feat
  - rust
  - wasm
  - tour
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
- [ ] #1 nodeAtPosition is exported from the WASM module and callable from TypeScript
- [ ] #2 Clicking the type declaration line (e.g. 'type Product @key...') returns { typeName: 'Product' } with no fieldName
- [ ] #3 Clicking a field line inside a type returns { typeName: 'Product', fieldName: 'price' }
- [ ] #4 Clicking whitespace, a directive argument, or a scalar definition returns null
- [ ] #5 Works correctly for interface definitions as well as object types
- [ ] #6 Rust unit tests cover type-level, field-level, and null cases
- [ ] #7 Line/col convention matches Monaco's 1-based positions
<!-- AC:END -->
