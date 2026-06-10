---
id: TASK-16
title: Implement deterministic mock execution (execute_mock)
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-10 17:22'
labels: []
milestone: m-2
dependencies:
  - TASK-14
documentation:
  - backlog/docs/doc-1 - GraphQL-Playground-Design.md
priority: high
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the mock.rs stub. Walk the operation against the API schema and return fake but well-shaped data. The same schema+operation+seed MUST always produce identical data. There is NO plan/federated execution: resolve fields against the single API schema.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A valid query returns data shaped exactly like the selection set (all requested fields present, correctly nested)
- [x] #2 Lists have length 3; non-null fields are never null; abstract types resolve to one allowed concrete type
- [x] #3 @skip/@include are honored via variables
- [x] #4 Two calls with identical schema+operation+seed return byte-identical JSON
- [x] #5 nix develop -c cargo build passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

## Phase 1: Fix apollo-compiler 1.32.0 API mismatches in mock.rs

The existing mock.rs has 7 compile errors. The `Type` enum variants changed and several constructors/methods were renamed:

**Known Type enum (v1.32.0):**
```rust
enum Type {
    Named(NamedType),           // nullable named type
    NonNullNamed(NamedType),    // non-null named type
    List(Box<Type>),            // nullable list
    NonNullList(Box<Type>),     // non-null list
}
// Convenience methods: type.non_null(), type.nullable(), type.list()
type NamedType = Name;  // alias
```

**Fix 1 (L228): Inline fragment type condition access.**
`InlineFragment.type_condition` is `Option<Name>`, NOT an object with `.type_name` field.
Change: `tc.type_name == *object_type` to `*tc == *object_type` (direct Name comparison).
For interfaces where a concrete type implements the interface, use:
  `schema.is_subtype(tc.as_str(), object_type.as_ref())` instead of equality.

**Fix 2 (L320): NonNullType constructor.**
`Type::NonNull(inner)` does not exist. The enum variant is `NonNullNamed(NamedType)`.
Change: use the convenience method instead:
  `let nn_type = inner_type.non_null();`

**Fix 3 (L336) & Fix 5 (L459): NamedType constructor.**
`Name` is NOT a tuple struct, so `NamedType(name.to_string())` fails.
Change: construct via the `From<String>` impl:
  `let name = Name::from(name.to_string());`
  or simply `name.clone()` if already a `Name`.

**Fix 4 (L409): Scalar value unwrapping.**
`.as_bool()` does not exist on `apollo_compiler::ast::Value`.
Change: `.as_bool()` to `.to_bool()`. Returns `Option<bool>`.
Apply same pattern if other `.as_*` methods are used.

**Fix 6: VariableDefinition access pattern.**
The error says direct fields, no `.node` wrapper. Ensure:
  `var_def.name`, `var_def.ty`, `var_def.default_value`

**Fix 7: Type unwrapping helper alignment.**
Update any match arms that unwrap Type to use the correct variants:
  `Type::Named(nt)` (not `Type::NamedType`)
  `Type::NonNullNamed(nt)` (not `Type::NonNull`)
  `Type::List(inner)` (not `Type::ListType`)
  `Type::NonNullList(inner)`

After fixes, verify with: `cargo build -p gql-core`

## Phase 2: Implement abstract type resolution (Union & Interface)

**In `resolve_field`, before the catch-all object walk:**

a. **Union resolution:**
   - Check if base type is a union: `schema.get_union(base_name)` returns `Option<&UnionType>` 
   - Get `.members: IndexSet<ComponentName>` as concrete type names
   - Collect into sorted Vec for determinism, hash-pick by index:
     `let idx = (hash % members.len()) as usize;`
   - Set `current_type` to chosen member, recurse with that concrete type context

b. **Interface resolution:**
   - Get implementers via `schema.implementers_map()` returning `HashMap<Name, IndexSet<Name>>`
   - Look up interface name to get set of concrete implementing type names
   - Hash-pick one implementer (same hash strategy as union)
   - Set `current_type` to chosen implementer, recurse

c. **Type context propagation:**
   - The recursive walker call must receive the chosen concrete type name
   - Inline fragments use this for `is_subtype` checks against `type_condition`
   - If the query has inline fragments with type conditions matching only some members,
     ensure the hash-picked type is compatible (pick from intersection if needed)

d. **Diagnostics verification:**
   The compile error shows:
     ```
   --> crates/gql-core/src/mock.rs:320:17
       help: there are variants with similar names: `NonNullNamed`, `List`
     --> crates/gql-core/src/mock.rs:459:36
         |
      459 |                             Type::NonNull(NamedType(name.to_string()))
      459 |                             ++++++++++++++++++++^^^^^+++++++++++++++++++++++
       ::: crates/apollo_compiler/src/schema.rs:106:9
     = note: tuple struct construction: `(Name)`
     ```
   This confirms:
   - `Type::NonNull` → `Type::NonNullNamed`
   - `NamedType(string)` → `Name::from(string)` via the type alias

After this, verify with: `cargo build -p gql-core`

## Phase 3: Integration verification and error envelope correctness

a. **Error envelopes:** Confirm all error paths return `{ "data": null, "errors": [{ "message": "..." }] }` 
   (not empty errors array or missing data key)

b. **Success envelope:** Confirm success returns `{ "data": { ... }, "errors": [] }` matching `MockResult`

c. **TypeScript type match:** Verify against `web/src/core/types.ts`:
   ```ts
   MockResult = { data: unknown; errors?: { message: string }[] }
   ```

d. Run full build to confirm WASM compatibility:
   ```bash
   cargo build -p gql-core    # native
   wasm-pack build crates/gql-core --target web  # WASM target
   ```

## Phase 4: Determinism and quality verification

a. **Determinism spot-check:** Call `execute_mock` twice with same inputs in a quick unit test, assert byte-identical JSON strings
b. Run pre-commit checks:
   ```bash
   cargo fmt --check -- crates/gql-core/src/mock.rs
   cargo clippy -p gql-core -- -D warnings
   ```
c. Verify no panics on bad input: malformed schema, empty operation, missing variables should all return error envelopes, not panic

## Key API Reference (apollo-compiler 1.32.0)

**Schema type lookup methods:**
```rust
schema.root_operation(OperationType::Query) -> Option<NamedType>
schema.get_object(name: &NamedType) -> Option<&ObjectType>
schema.get_interface(name: &str) -> Option<&InterfaceType>
schema.get_union(name: &str) -> Option<&UnionType>
schema.get_enum(name: NamedType) -> Option<&EnumType>
schema.implementers_map() -> HashMap<Name, IndexSet<Name>>
schema.is_subtype(maybe_subtype: &str, abstract_type: &str) -> bool
```

**ExecutableDocument fields:**
- `doc.operations` — `IndexMap<Option<Name>, Operation>` 
- `Operation.selection_set` — `SelectionSet { ty: NamedType, selections: Vec<Selection> }`
- `Operation.variable_definitions` — direct access to `.name`, `.ty`, `.default_value`

**Selection variants:**
```rust
enum Selection {
    Field(Node<Field>),                  // field.response_key() -> &Name
    FragmentSpread(Node<FragmentSpread>), // spread.fragment_name: Name
    InlineFragment(Node<InlineFragment>), // frag.type_condition: Option<Name>
}
```

**Value enum for directive evaluation:**
```rust
enum Value { Boolean(bool), String(String), Enum(Name), Int(i64), Float(f64), 
             List(Vec<Value>), Object(Vec<(Name, Value)>), Null, Variable(Name) }
// .to_bool() -> Option<bool>, .to_string() -> &String, etc.
```

## Acceptance Criteria Coverage Map
- **AC#1 (selection shape):** Covered by walk_fields + fragment merging. Fix 7 ensures Type variants are correct for field type lookup.
- **AC#2 (lists = 3, non-null never null):** Covered in resolve_field list handling and Type unwrapping. Phase 2 adds union/interface concrete type picking with deterministic hash.
- **AC#3 (@skip/@include):** Covered in should_skip_field + directive_bool chain. Fix 4 ensures `.to_bool()` works.
- **AC#4 (byte-identical JSON):** Guaranteed by BTreeMap key ordering (default serde_json) + DefaultHasher determinism. Phase 2 adds union/interface determinism via sorted member lists.
- **AC#5 (cargo build passes):** Verified at end of each phase with `cargo build -p gql-core`.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented deterministic mock execution (execute_mock) in mock.rs: a single-schema GraphQL field-walker that resolves operations against the composed API schema, generates values from a hash of (seed, path, field), handles union/interface abstract types by hash-picking concrete members, honors @skip/@include directives via variables, and returns error envelopes on all failure paths. 10 acceptance criteria tests cover selection shape, list length, non-null guarantees, abstract type resolution, directive evaluation, fragment spreads, byte-identical determinism, and seed sensitivity. All Rust and TypeScript quality gates pass.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
### Verified API Corrections (apollo-compiler 1.32.0)

Compiled mock.rs and captured exact errors. The following corrections are confirmed:

| Error Location | Assumed API | Actual API |
|---|---|---|
| L228 | `InlineFragment.type_condition.type_name` | `type_condition: Option<Name>` (direct Name) |
| L320 | `Type::NonNull(inner)` | `Type::NonNullNamed(NamedType)` or `.non_null()` method |
| L336, L459 | `NamedType(name.to_string())` | `Name::from(name.to_string())` (via From<String> impl) |
| L409 | `value.as_bool()` | `value.to_bool() -> Option<bool>` |
| Type enum | `NamedType`, `NonNull`, `ListType` | `Named`, `NonNullNamed`, `List`, `NonNullList` |

### Existing Implementation Status (~400 lines)
- **AC#1 (selection shape):** Covered. walk_fields + fragment merging works.
- **AC#2 (lists = 3, non-null):** Covered. resolve_field unwraps lists correctly.
- **AC#3 (@skip/@include):** Covered. directive_bool chain handles literals, enums, variables, defaults.
- **AC#4 (determinism):** Covered. DefaultHasher + BTreeMap key ordering.

### Remaining Gap: Abstract Type Resolution
Phase 2 must implement union and interface resolution before the catch-all object walk:
- **Union:** `schema.get_union(base_name)?.members` → sorted Vec, hash-pick one member
- **Interface:** `schema.implementers_map()[interface_name]` → hash-pick one implementer
- Concrete type context then propagates to recursive walker for inline fragment `is_subtype` checks

### API Reference Summary (verified against generated docs)
```rust
// Schema lookup methods
schema.root_operation(OperationType::Query) -> Option<NamedType>
schema.get_object(name: &NamedType) -> Option<&ObjectType>      
schema.get_interface(name: &str) -> Option<&InterfaceType>
schema.get_union(name: &str) -> Option<&UnionType>  // .members: IndexSet<ComponentName>
schema.get_enum(name: NamedType) -> Option<&EnumType>
schema.implementers_map() -> HashMap<Name, IndexSet<Name>>
schema.is_subtype(maybe_subtype: &str, abstract_type: &str) -> bool

// ExecutableDocument fields
Operation { .name, .operation_type, .variable_definitions, .selection_set }
SelectionSet { ty: NamedType, selections: Vec<Selection> }
InlineFragment { type_condition: Option<Name>, directives, selection_set }
VariableDefinition { name, ty, default_value }  // direct fields, no .node wrapper
```
