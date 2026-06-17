/**
 * planToFieldRanges — maps each field selection in the original query to the
 * subgraph (Fetch node service) that resolves it.
 *
 * Strategy:
 * 1. Collect all Fetch nodes from the PlanNode tree.
 * 2. For each Fetch, read `resolved_fields` (pre-computed by the Rust WASM layer)
 *    to learn which fields it resolves and whether they belong to entity fragments.
 * 3. Parse the original query once with graphql-js to get `loc` source positions
 *    for Monaco editor decorations.
 * 4. Walk the original query AST matching field names from `resolved_fields` to
 *    record their source positions.
 *
 * This approach removes all graphql-js re-parsing of Fetch sub-operation strings.
 * The Rust query planner already knows which service resolves each field — we
 * just consume that pre-computed attribution.
 *
 * Edge cases handled:
 * - Fetch nodes with absent/empty `resolved_fields` are skipped gracefully.
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
 * Returns an empty array if the original query cannot be parsed or if all
 * Fetch nodes have no `resolved_fields` (graceful degradation for stale WASM).
 */
export function planToFieldRanges(root: PlanNode, originalQuery: string): FieldRange[] {
  // Parse the original query once — bail out if it fails.
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

  // For each Fetch: read resolved_fields (pre-computed by Rust), partition into
  // plain fields vs entity fragment fields, then walk the original query AST.
  // We use a Map keyed by "line:col" so later Fetches overwrite earlier ones
  // for the same position (last Fetch wins).
  const results = new Map<string, FieldRange>();

  for (const fetch of fetches) {
    if (fetch.resolvedFields.length === 0) continue;

    // Partition resolved_fields into:
    //   matchedNames: plain fields (type_condition === null)
    //   entityFragmentFields: typeName → field names (for entity fetches)
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
