/**
 * planToFieldRanges — maps each field selection in the original query to the
 * subgraph (Fetch node service) that resolves it.
 *
 * Strategy:
 * 1. Collect all Fetch nodes from the PlanNode tree.
 * 2. For each Fetch, parse its `operation` string with graphql-js to learn
 *    *which* fields it resolves (field names / paths).
 * 3. Parse the original query and walk its AST to find matching fields by
 *    name, using the original AST's `loc` for accurate positions.
 *
 * This dual-parse approach is necessary because the Fetch operation is a
 * router-generated sub-selection: positions in it do not correspond to the
 * original query positions. We match by field name at each level instead.
 *
 * Edge cases handled:
 * - Fetch operation strings that fail to parse are skipped silently.
 * - The original query that fails to parse returns an empty array.
 * - Alias fields: the `loc` of the alias keyword is used when present.
 * - Inline fragments: traversed recursively.
 * - Fragment spreads: the `FragmentDefinition` is looked up and traversed.
 * - Fields in multiple Fetches (e.g. `__typename`): last Fetch's color wins.
 */

import { parse, Kind } from "graphql";
import type {
  DocumentNode,
  SelectionSetNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  FragmentSpreadNode,
} from "graphql";
import type { PlanNode } from "./core/types";

export interface FieldRange {
  /** 1-based line number in the original query string. */
  line: number;
  /** 1-based column. */
  col: number;
  /** Token length (characters). */
  len: number;
  /** The subgraph service that resolves this field. */
  service: string;
}

// ---------------------------------------------------------------------------
// Collect Fetch nodes
// ---------------------------------------------------------------------------

interface FetchEntry {
  service: string;
  operation: string;
}

function collectFetches(node: PlanNode, out: FetchEntry[] = []): FetchEntry[] {
  switch (node.kind) {
    case "Fetch":
      out.push({ service: node.service, operation: node.operation });
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

// ---------------------------------------------------------------------------
// Extract field names from a Fetch operation AST
// ---------------------------------------------------------------------------

/**
 * Walk a SelectionSet and return all field names (or alias names) it contains,
 * recursively entering fields, inline fragments, and all nesting levels.
 * Fragment spreads are left as-is since sub-operations rarely contain them.
 */
function fetchFieldNames(selectionSet: SelectionSetNode): Set<string> {
  const names = new Set<string>();
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      names.add(sel.alias?.value ?? sel.name.value);
      if (sel.selectionSet) {
        fetchFieldNames(sel.selectionSet).forEach((n) => names.add(n));
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT && sel.selectionSet) {
      fetchFieldNames(sel.selectionSet).forEach((n) => names.add(n));
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Walk original query AST and record positions for matched fields
// ---------------------------------------------------------------------------

function walkSelectionSet(
  selectionSet: SelectionSetNode,
  matchedFieldNames: Set<string>,
  service: string,
  fragments: Record<string, FragmentDefinitionNode>,
  results: Map<string, FieldRange>,
  // For entity fetches: maps typeName → fields the entity fetch resolves for
  // that type. When entering `... on TypeName` in the original query, the
  // walk switches to those type-specific fields so only the fields the entity
  // fetch actually resolves are attributed to it (not generic keys like `id`
  // that the root fetch also selects).
  entityFragmentFields?: Map<string, Set<string>>,
): void {
  for (const sel of selectionSet.selections) {
    switch (sel.kind) {
      case Kind.FIELD: {
        const fieldSel = sel as FieldNode;
        const responseName = fieldSel.alias?.value ?? fieldSel.name.value;
        const fieldName = fieldSel.name.value;
        const isMatch = matchedFieldNames.has(responseName) || matchedFieldNames.has(fieldName);
        if (isMatch && fieldSel.loc) {
          const startToken = fieldSel.loc.startToken;
          // Last fetch wins: entity fetches (which come after the root fetch) override
          // the root fetch's generic attribution for shared fields like `id`/`__typename`.
          results.set(`${startToken.line}:${startToken.column}`, {
            line: startToken.line,
            col: startToken.column,
            len: startToken.end - startToken.start,
            service,
          });
        }
        if (fieldSel.selectionSet) {
          walkSelectionSet(
            fieldSel.selectionSet,
            matchedFieldNames,
            service,
            fragments,
            results,
            entityFragmentFields,
          );
        }
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        const inlineSel = sel as InlineFragmentNode;
        if (inlineSel.selectionSet) {
          const typeName = inlineSel.typeCondition?.name.value;
          // If this entity fetch has type-specific fields for this fragment,
          // use those instead of the general set so nested fields like `id` are
          // only attributed to this service when it actually resolves them.
          const typeFields =
            typeName && entityFragmentFields?.has(typeName)
              ? entityFragmentFields.get(typeName)!
              : matchedFieldNames;
          walkSelectionSet(
            inlineSel.selectionSet,
            typeFields,
            service,
            fragments,
            results,
            entityFragmentFields,
          );
        }
        break;
      }
      case Kind.FRAGMENT_SPREAD: {
        const spreadSel = sel as FragmentSpreadNode;
        const fragment = fragments[spreadSel.name.value];
        if (fragment) {
          walkSelectionSet(
            fragment.selectionSet,
            matchedFieldNames,
            service,
            fragments,
            results,
            entityFragmentFields,
          );
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a `FieldRange` for each field selection in `originalQuery` that
 * appears in at least one Fetch node of `root`.
 *
 * When a field appears in multiple Fetch nodes (e.g. `__typename`), the
 * *last* Fetch's service color wins — acceptable for the educational use case.
 *
 * Returns an empty array if the original query cannot be parsed.
 */
export function planToFieldRanges(root: PlanNode, originalQuery: string): FieldRange[] {
  // Parse the original query first — bail out if it fails.
  let originalDoc: DocumentNode;
  try {
    originalDoc = parse(originalQuery, { noLocation: false });
  } catch {
    return [];
  }

  // Build a fragment lookup map for the original query.
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const def of originalDoc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragments[def.name.value] = def;
    }
  }

  // Collect all Fetch nodes from the plan.
  const fetches = collectFetches(root);
  if (fetches.length === 0) return [];

  // For each Fetch: parse its operation, extract field names it resolves, then
  // walk the original query AST and record positions.
  // We use a Map keyed by "service::line:col" so later Fetches overwrite earlier
  // ones for the same position (last Fetch wins).
  const results = new Map<string, FieldRange>();

  for (const fetch of fetches) {
    // The WASM plan serializer wraps operation strings in JSON quotes;
    // unwrap before passing to the GraphQL parser.
    let opStr = fetch.operation;
    if (opStr.startsWith('"') && opStr.endsWith('"')) {
      try {
        opStr = JSON.parse(opStr) as string;
      } catch {
        /* leave as-is */
      }
    }
    let fetchDoc: DocumentNode;
    try {
      fetchDoc = parse(opStr, { noLocation: false });
    } catch {
      // Malformed sub-operation — skip without crashing.
      continue;
    }

    const matchedNames = new Set<string>();
    // For entity fetches: typeName → fields the fetch resolves for that type.
    const entityFragmentFields = new Map<string, Set<string>>();
    let isEntityFetch = false;

    for (const def of fetchDoc.definitions) {
      if (def.kind === Kind.OPERATION_DEFINITION) {
        // Detect entity fetch by looking for a top-level `_entities` field.
        for (const sel of def.selectionSet.selections) {
          if (sel.kind === Kind.FIELD && (sel as FieldNode).name.value === "_entities") {
            isEntityFetch = true;
            const entitiesField = sel as FieldNode;
            if (entitiesField.selectionSet) {
              for (const fragSel of entitiesField.selectionSet.selections) {
                if (
                  fragSel.kind === Kind.INLINE_FRAGMENT &&
                  fragSel.typeCondition &&
                  fragSel.selectionSet
                ) {
                  entityFragmentFields.set(
                    fragSel.typeCondition.name.value,
                    fetchFieldNames(fragSel.selectionSet),
                  );
                }
              }
            }
            break;
          }
        }
        if (!isEntityFetch) {
          fetchFieldNames(def.selectionSet).forEach((n) => matchedNames.add(n));
        }
      } else if (def.kind === Kind.FRAGMENT_DEFINITION) {
        fetchFieldNames(def.selectionSet).forEach((n) => matchedNames.add(n));
      }
    }

    if (matchedNames.size === 0 && entityFragmentFields.size === 0) continue;

    // Walk original query definitions and record positions.
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

/**
 * Collect unique service names from a PlanNode tree in first-encounter order.
 * Exported so App.tsx can derive the legend without importing planToMermaid.
 */
export function collectServiceNames(root: PlanNode): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of collectFetches(root)) {
    if (!seen.has(f.service)) {
      seen.add(f.service);
      out.push(f.service);
    }
  }
  return out;
}
