---
id: TASK-104
title: Make WASM export error-envelope shapes consistent and correctly attributed
status: Done
assignee: []
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 00:38'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The six WASM exports use three different failure shapes: compose/plan return {ok:false, errors}; validate_subgraph/validate_query return {diagnostics}; query_shape/node_at_position silently return empty/null. Worst case: validate_query with malformed *supergraph* SDL emits a fake operation diagnostic at (1,1) pointing at the user's query editor when the real fault is the schema (crates/gql-core/src/validate.rs:154-184), underlining the wrong pane. Fix: document the intentional shapes in lib.rs and distinguish 'schema could not be derived/parsed' from 'operation has diagnostics' in validate_query.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 malformed supergraph SDL no longer produces a bogus query diagnostic at (1,1)
- [x] #2 the three envelope conventions are documented in lib.rs
- [x] #3 web/src/core/index.ts handles the schema-error signal
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Root cause

`validate_query` (crates/gql-core/src/validate.rs:151-191) has two independent
failure sources but only one output shape:

1. Schema-side failures — `api_schema::derive_api_schema` fails (bad
   supergraph SDL, e.g. federation Supergraph::new_with_router_specs error) or
   `Schema::parse_and_validate(&api_sdl, ...)` fails (the derived API schema
   itself doesn't parse). Both branches (lines 153-162 and 165-184) fabricate
   a diagnostic at `line:1, col:1` and return it inside the same
   `{ "diagnostics": [...] }` envelope used for real operation diagnostics.
2. Operation-side failures — `ExecutableDocument::parse_and_validate` fails
   against a *valid* API schema (line 187-190) — a real query diagnostic with
   a real position.

`web/src/core/index.ts::validateQuery` (line 34-36) and its only caller,
the query-validation effect in `web/src/App.tsx` (lines 599-624), blindly
apply every returned diagnostic as a Monaco marker on the *query editor*
model. When failure source (1) happens, the (1,1) marker lands on the query
pane even though the real fault is the schema/supergraph — misleading the
user into "fixing" a query that was never wrong.

Note: in the current App.tsx wiring, `supergraphSdl` in the store is only
ever updated on a *successful* compose (`setComposeResult(sdl, ...)`, sdl is
`null` on failure and the setter keeps the previous value — see
store.ts:508-514), so today's UI rarely feeds a malformed supergraph SDL into
`validate_query`. The WASM export's *contract* is still wrong regardless of
today's one caller — `validate_query` is public API surface (also usable by
tests, tools, or future callers such as TourPlayback) and must not conflate
"the operation is broken" with "the schema/supergraph is broken". Fix at the
source.

## Fix

### 1. crates/gql-core/src/validate.rs — split the envelope

Change `validate_query`'s two schema-derivation failure branches (currently
lines 153-162 and 165-184) to return a distinct top-level shape instead of
faking a diagnostic:

```rust
json!({ "schema_error": { "message": <derivation or parse error text> } })
```

Keep the existing `{ "diagnostics": [...] }` shape (empty array or real
positioned diagnostics) for the only-remaining case: the API schema parsed
fine and `ExecutableDocument::parse_and_validate` ran against it (line
187-190) — this is the sole place a genuine *operation* diagnostic can come
from.

Do NOT touch `validate_subgraph` — its Phase 2 fallback to `(1,1,0)` is a
different, already-documented limitation (SubgraphError location fields are
`pub(crate)`) and out of scope per the ticket description.

Update the doc comment above `validate_query` (line 150) to describe the two
possible return shapes and when each occurs.

### 2. crates/gql-core/src/validate.rs — tests

Add unit tests (near the existing `validate_query` tests, ~line 354+):
- `validate_query` with a garbage `supergraph_sdl` (e.g. `"not valid sdl"`)
  returns `{ "schema_error": { "message": ... } }`, NOT `{ "diagnostics": [...] }`,
  and critically does not contain a diagnostic at line 1 col 1 pretending to
  be a query fault.
- Existing `invalid_query_returns_diagnostics` / `unknown_field_diagnostic_has_correct_position`
  continue to pass unchanged (operation-side diagnostics still flow through
  `{ "diagnostics": [...] }`).
- A case where the derived API schema itself fails
  `Schema::parse_and_validate` (if reachable with a hand-built pathological
  supergraph SDL) also returns `schema_error`, not a fake diagnostic — only
  add this if a realistic input can be constructed; otherwise the
  `derive_api_schema` failure path covers the acceptance criterion.

### 3. crates/gql-core/src/lib.rs — document the three envelope conventions

Expand the module doc comment (currently lines 1-11) or add a new `##`
section listing the three conventions used across the six exports, matching
AC#2:

1. **Result envelope** (`compose`, `plan`): `{ ok: true, ... }` on success,
   `{ ok: false, errors: [...] }` on failure.
2. **Diagnostics envelope** (`validate_subgraph`, `validate_query`):
   `{ diagnostics: [...] }` — empty array means valid. `validate_query`
   additionally returns `{ schema_error: { message } }` when the fault is in
   the supergraph/schema rather than the operation (see validate.rs); callers
   MUST check for `schema_error` before treating the payload as query
   diagnostics.
3. **Silent-default envelope** (`query_shape`, `node_at_position`): return an
   empty/null result for invalid input rather than an error — these are
   view-only conveniences (editor hover/tree), not diagnostic surfaces, so
   there's nothing meaningful to report back.

Also update the one-line doc comments on `validate_query` (line 58-59) and
`query_shape`/`node_at_position` if needed for consistency with the new
section.

### 4. web/src/core/types.ts — type the new signal

Add a discriminated return type for `validateQuery`, e.g.:

```ts
export type ValidateQueryResult = { diagnostics: Diagnostic[] } | { schemaError: string };
```

Update `GqlCore.validateQuery` (line 175) to return `ValidateQueryResult`
instead of the current `{ diagnostics: Diagnostic[] }`.

### 5. web/src/core/index.ts — translate the wire shape

Update `validateQuery` (lines 34-36) to inspect the raw JSON before
committing to a shape:

```ts
validateQuery(supergraphSdl: string, operation: string): ValidateQueryResult {
  const raw = json<{ diagnostics?: Diagnostic[]; schema_error?: { message: string } }>(
    ns.validate_query(supergraphSdl, operation),
  );
  return raw.schema_error
    ? { schemaError: raw.schema_error.message }
    : { diagnostics: raw.diagnostics ?? [] };
},
```

### 6. web/src/App.tsx — handle the schema-error signal (AC#3)

In the query-validation effect (lines 599-624): when `result` carries
`schemaError` instead of `diagnostics`, do NOT paint it onto the query
editor. Clear the existing `query-validation` markers on the query model
(the query itself may be fine) instead of leaving stale or bogus markers.
Optionally surface `schemaError` through whatever channel already shows
compose/schema failures (e.g. console.debug or an existing status area) —
keep this minimal; the acceptance criterion only requires that the signal is
handled, not a new UI surface. Concretely:

```ts
const result = core.validateQuery(supergraphSdl, currentQuery);
const markers = "schemaError" in result
  ? [] // fault is in the schema/supergraph, not this query — nothing to underline here
  : result.diagnostics.map((d) => diagnosticToMarker(d, monacoInstance));
...
monacoInstance.editor.setModelMarkers(model, "query-validation", markers);
```

## Verification

- `cargo test -p gql-core validate` — new + existing validate.rs tests pass.
- `cargo test -p gql-core` — full crate suite still green.
- `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings` on the
  crate.
- `pnpm build:wasm` to regenerate `web/src/wasm/` bindings (no signature
  change, but keeps the wasm artifact in sync since validate.rs changed).
- `pnpm tsc --noEmit` — types.ts/index.ts/App.tsx changes typecheck.
- `pnpm test run` — existing web unit tests still pass (check for any test
  asserting the old `{ diagnostics }`-only shape from `validateQuery` and
  update it to the new discriminated type).
- Manual/AC#1 sanity: feed a deliberately malformed supergraph SDL into
  `validate_query` (unit test is sufficient proof; no manual UI repro needed
  since the bug is in the export contract, not reachable via today's UI
  wiring per the note above).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per plan:

1. crates/gql-core/src/validate.rs: split validate_query's schema-derivation
   failure branches (derive_api_schema error, and Schema::parse_and_validate
   error on the derived API schema) to return {"schema_error":{"message":...}}
   instead of fabricating a fake diagnostic at (1,1). Operation-side
   diagnostics (ExecutableDocument::parse_and_validate) still return the
   existing {"diagnostics":[...]} shape unchanged. validate_subgraph was left
   untouched (out of scope per ticket). Added doc comment describing the two
   possible return shapes, plus a new unit test
   malformed_supergraph_sdl_returns_schema_error_not_fake_diagnostic asserting
   no diagnostics envelope and a non-empty schema_error.message for garbage
   supergraph SDL input.

2. crates/gql-core/src/lib.rs: added an "## Envelope conventions" module-doc
   section documenting the three shapes (Result envelope for compose/plan,
   Diagnostics envelope for validate_subgraph/validate_query with the new
   schema_error discriminant, Silent-default envelope for
   query_shape/node_at_position), plus updated the validate_query doc comment.

3. web/src/core/types.ts: added ValidateQueryResult = { diagnostics } |
   { schemaError }, and changed GqlCore.validateQuery's return type to it.

4. web/src/core/index.ts: validateQuery now inspects the raw JSON for a
   schema_error key and returns { schemaError } instead of blindly assuming
   { diagnostics }.

5. web/src/App.tsx: the query-validation effect now checks for schemaError in
   the result; when present it clears query-validation markers (does not
   paint anything on the query editor) and logs via console.debug, since the
   fault is in the schema/supergraph, not the query.

6. web/src/core/index.test.ts: updated the shape assertion for validateQuery
   to check the discriminated union instead of assuming .diagnostics exists
   unconditionally.

Verification: cargo test -p gql-core validate (16 passed), cargo test -p
gql-core (95 passed, 1 ignored), cargo fmt --check and cargo clippy --all-targets
-- -D warnings clean, cargo doc --no-deps clean (no broken intra-doc links),
pnpm build:wasm regenerated web/src/wasm/, pnpm tsc --noEmit clean, pnpm test
run (396 passed across 18 files).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed validate_query's conflated error envelope: schema/supergraph-derivation
failures now return {schema_error:{message}} instead of a fake (1,1) query
diagnostic, so a broken supergraph SDL no longer misleads users into "fixing"
a query that was never wrong. Documented all three WASM export envelope
conventions in lib.rs, and updated the TS core wrapper (types.ts, index.ts)
plus App.tsx's query-validation effect to discriminate on schemaError and
avoid painting schema faults onto the query editor.
<!-- SECTION:FINAL_SUMMARY:END -->
