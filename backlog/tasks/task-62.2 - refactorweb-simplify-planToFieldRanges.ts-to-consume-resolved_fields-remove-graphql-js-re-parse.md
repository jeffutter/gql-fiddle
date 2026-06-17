---
id: TASK-62.2
title: >-
  refactor(web): simplify planToFieldRanges.ts to consume resolved_fields,
  remove graphql-js re-parse
status: Done
assignee: []
created_date: '2026-06-17 04:32'
updated_date: '2026-06-17 12:00'
labels:
  - architecture
  - web
  - planned
dependencies:
  - TASK-62.1
references:
  - web/src/planToFieldRanges.ts
  - web/src/core/types.ts
  - web/src/App.tsx
parent_task_id: TASK-62
priority: medium
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

This is the web half of TASK-62. TASK-62.1 annotates each `PlanNode::Fetch` with `resolved_fields: [{ field_name, type_condition }]`. This task strips the `graphql-js` re-parsing from `planToFieldRanges.ts` and replaces it with a straight traversal over the pre-computed data.

## Goal

`planToFieldRanges.ts` should no longer parse operation strings with `graphql-js`. It should:
1. Walk the plan tree collecting `Fetch` nodes (unchanged)
2. Read `resolved_fields` from each Fetch node (new)
3. Parse the *original user query* once with `graphql-js` — only to get source positions for Monaco decorations (this part stays)
4. Match `field_name` + `type_condition` from `resolved_fields` against the original query AST positions

## Implementation guidance

**`web/src/core/types.ts`** — add to the `Fetch` variant (done in TASK-62.1):
```ts
resolved_fields: Array<{ field_name: string; type_condition: string | null }>
```

**`web/src/planToFieldRanges.ts`**:
- Remove: all `graphql-js` parsing of Fetch sub-operation strings
- Remove: `_entities` detection heuristics
- Remove: inline-fragment string scanning
- Keep: single parse of the original query for `loc` source positions
- Keep: Monaco `FieldRange` output shape (so `App.tsx` callers are unchanged)
- New: for each Fetch node, iterate `resolved_fields`; for each entry look up matching field positions in the original query AST using `field_name` and `type_condition` as the selector

## Verification

- Monaco editor field coloring works correctly for both simple and entity-fetch query plans
- No `graphql-js` parse calls remain on Fetch sub-operation strings
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm typecheck passes with no TypeScript errors
- [ ] #2 pnpm test passes with no regressions
- [ ] #3 No graphql-js parse calls remain on Fetch sub-operation strings in planToFieldRanges.ts
- [ ] #4 Monaco editor field coloring works correctly for simple (non-entity) queries
- [ ] #5 Monaco editor field coloring works correctly for entity-fetch queries (fields attributed to correct subgraph)
- [ ] #6 collectServiceNames() still works correctly for the legend in App.tsx
- [ ] #7 Graceful degradation: if resolved_fields is absent the function returns an empty array rather than crashing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

Once TASK-62.1 ships, each `Fetch` node in the plan JSON carries `resolved_fields: [{field_name, type_condition}]`. This task strips all `graphql-js` sub-operation re-parsing from `planToFieldRanges.ts` and replaces it with a direct traversal over that pre-computed data. The original query is still parsed once with `graphql-js` — only to get `loc` source positions for Monaco editor decorations.

---

### Step 1: Update `core/types.ts` — add `resolved_fields` to the `Fetch` variant

File: `web/src/core/types.ts`

Locate the `PlanNode` union type (around line 82) and extend the `Fetch` branch:

```ts
| {
    kind: "Fetch";
    service: string;
    operation: string;
    operation_kind: string;
    requires?: RequiresSelection[];
    resolved_fields?: Array<{ field_name: string; type_condition: string | null }>;
  }
```

The field is optional (`?`) because older cached plan responses without the field must still parse correctly. The Rust side emits `skip_serializing_if = "Vec::is_empty"` so an empty list also means the key is absent.

---

### Step 2: Refactor `planToFieldRanges.ts`

File: `web/src/planToFieldRanges.ts`

#### 2a. Remove the `FetchEntry.operation` field and sub-operation parsing

The `collectFetches` helper currently returns `{ service, operation }` pairs. Change the shape to `{ service, resolvedFields }`:

```ts
interface FetchEntry {
  service: string;
  resolvedFields: Array<{ field_name: string; type_condition: string | null }>;
}

function collectFetches(node: PlanNode, out: FetchEntry[] = []): FetchEntry[] {
  switch (node.kind) {
    case "Fetch":
      out.push({
        service: node.service,
        resolvedFields: node.resolved_fields ?? [],
      });
      break;
    case "Sequence":
    case "Parallel":
      node.nodes.forEach((n) => collectFetches(n, out));
      break;
    case "Flatten":
      collectFetches(node.node, out);
      break;
    case "Subscription":
      collectFetches(node.primary, out);
      if (node.rest) collectFetches(node.rest, out);
      break;
    case "Defer":
      if (node.primary) collectFetches(node.primary, out);
      node.deferred.forEach((d) => {
        if (d.node) collectFetches(d.node, out);
      });
      break;
    case "Condition":
      if (node.ifBranch) collectFetches(node.ifBranch, out);
      if (node.elseBranch) collectFetches(node.elseBranch, out);
      break;
  }
  return out;
}
```

#### 2b. Delete dead code

Remove entirely:
- `fetchFieldNames()` function (lines 95–108) — extracted field names from sub-operation ASTs
- All `graphql-js` parse calls on `fetch.operation` strings (the large block inside the `for (const fetch of fetches)` loop starting around line 238–292)
- The `isEntityFetch` / `entityFragmentFields` logic derived from sub-operation parsing
- The JSON-unwrapping of `opStr` (`if (opStr.startsWith('"') ...)`) — no longer needed

Keep:
- `import { parse, Kind } from "graphql"` — still needed for parsing the original query
- The type imports (`DocumentNode`, `SelectionSetNode`, `FieldNode`, etc.) — still needed for `walkSelectionSet`
- `walkSelectionSet()` — unchanged; it still matches fields by name in the original query AST
- The single `parse(originalQuery)` call at the top of `planToFieldRanges()`

#### 2c. Rewrite the main loop in `planToFieldRanges()`

Replace the sub-operation parsing loop with a loop that reads `resolvedFields` directly:

```ts
export function planToFieldRanges(root: PlanNode, originalQuery: string): FieldRange[] {
  let originalDoc: DocumentNode;
  try {
    originalDoc = parse(originalQuery, { noLocation: false });
  } catch {
    return [];
  }

  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const def of originalDoc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments[def.name.value] = def;
    }
  }

  const fetches = collectFetches(root);
  if (fetches.length === 0) return [];

  const results = new Map<string, FieldRange>();

  for (const fetch of fetches) {
    if (fetch.resolvedFields.length === 0) continue;

    // Partition resolved_fields into:
    //   - matchedNames: plain fields (type_condition === null)
    //   - entityFragmentFields: typeName → field names (for entity fetches)
    const matchedNames = new Set<string>();
    const entityFragmentFields = new Map<string, Set<string>>();

    for (const rf of fetch.resolvedFields) {
      if (rf.type_condition === null) {
        matchedNames.add(rf.field_name);
      } else {
        let typeSet = entityFragmentFields.get(rf.type_condition);
        if (!typeSet) {
          typeSet = new Set();
          entityFragmentFields.set(rf.type_condition, typeSet);
        }
        typeSet.add(rf.field_name);
      }
    }

    const isEntityFetch = entityFragmentFields.size > 0;

    for (const def of originalDoc.definitions) {
      if (def.kind === Kind.OPERATION_DEFINITION && def.selectionSet) {
        walkSelectionSet(
          def.selectionSet,
          matchedNames,
          fetch.service,
          fragments,
          results,
          isEntityFetch ? entityFragmentFields : undefined,
        );
      }
    }
  }

  return Array.from(results.values());
}
```

`walkSelectionSet()` signature and body are **unchanged** — it already accepts `matchedNames` and `entityFragmentFields` in exactly the shape this loop produces.

#### 2d. Update `collectServiceNames()`

`collectServiceNames()` currently calls `collectFetches()` and reads `.service`. That remains valid — the return type of `collectFetches` still includes `service`. No change needed here beyond ensuring the `FetchEntry` interface change doesn't break the `for (const f of collectFetches(root))` loop (it won't — only `f.service` is accessed there).

---

### Step 3: Remove unused imports

After the refactor, these graphql-js types may no longer be needed at the top of `planToFieldRanges.ts`:

```ts
// Keep — still used by walkSelectionSet:
import type { SelectionSetNode, FieldNode, FragmentDefinitionNode, InlineFragmentNode, FragmentSpreadNode } from "graphql";

// Remove if no longer referenced:
// (none expected — all the above are still used in walkSelectionSet)
```

Run `tsc --noEmit` or `pnpm typecheck` to confirm no dead imports remain.

---

### Step 4: Verify

1. Run TypeScript type check: `pnpm typecheck` (or `pnpm tsc --noEmit`)
2. Run unit tests: `pnpm test`
3. Manual smoke test in the app:
   - Open the app with a two-subgraph schema
   - Execute a query that touches both subgraphs
   - Confirm Monaco editor shows field decorations colored by subgraph
   - Execute a query with entity fetches (e.g. `@key` types) and confirm entity fields are attributed to the correct subgraph

---

### Notes

- `walkSelectionSet()` is not modified at all. The only changes are: how `FetchEntry` is shaped, and how the per-fetch `matchedNames`/`entityFragmentFields` sets are built.
- If `resolved_fields` is absent (e.g. a stale WASM build), `node.resolved_fields ?? []` degrades gracefully — `resolvedFields` is empty, the fetch is skipped, and no decorations appear. No crash.
- `collectServiceNames()` in the same file is called by `App.tsx` for the legend. It reads `f.service` from `collectFetches()` output — unaffected by this change.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Updated web/src/core/types.ts to add resolved_fields?: Array<{field_name, type_condition}> to the Fetch PlanNode variant. Refactored planToFieldRanges.ts: removed FetchEntry.operation field, fetchFieldNames() helper, all graphql-js parse calls on sub-operation strings, _entities detection heuristics. New collectFetches() reads resolved_fields from each Fetch node; main loop partitions them into matchedNames (type_condition null) vs entityFragmentFields (type_condition set). walkSelectionSet() unchanged. Updated test fixtures to supply resolved_fields and added entity fetch + graceful-degradation tests. pnpm test: 195/195 pass. tsc --noEmit: no errors.
<!-- SECTION:NOTES:END -->
