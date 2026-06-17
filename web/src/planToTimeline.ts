import type { PlanNode } from "./core/types";

/** Extract the first top-level field name from a GraphQL operation string. */
function topLevelField(operation: string): string {
  const m = operation.match(/\{\s*([_A-Za-z][_0-9A-Za-z]*)/);
  return m ? m[1] : "…";
}

/**
 * If `operation` is an _entities fetch, return the inline-fragment type names
 * that are DIRECT CHILDREN of the _entities selection set (e.g. ["Product"]).
 * Nested inline fragments like `... on NavigationInteraction` inside a
 * Product fragment are intentionally excluded.
 * Returns an empty array for non-entity operations.
 */
function extractEntityTypes(operation: string): string[] {
  if (topLevelField(operation) !== "_entities") return [];

  const entitiesIdx = operation.indexOf("_entities");
  if (entitiesIdx === -1) return [];

  // Skip past the arguments (balanced parentheses).
  let i = entitiesIdx + "_entities".length;
  while (i < operation.length && /\s/.test(operation[i])) i++;
  if (operation[i] === "(") {
    let parenDepth = 1;
    i++;
    while (i < operation.length && parenDepth > 0) {
      if (operation[i] === "(") parenDepth++;
      else if (operation[i] === ")") parenDepth--;
      i++;
    }
  }

  // Expect the opening brace of the _entities selection set.
  while (i < operation.length && /\s/.test(operation[i])) i++;
  if (operation[i] !== "{") return [];
  i++; // consume `{`

  // Collect inline-fragment type names at depth 0 only (direct children of _entities).
  const types: string[] = [];
  let depth = 0;
  while (i < operation.length) {
    const ch = operation[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) {
      const m = operation.slice(i).match(/^\.\.\.\s*on\s+([_A-Za-z][_0-9A-Za-z]*)/);
      if (m) {
        types.push(m[1]);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }

  return [...new Set(types)];
}

export interface TimelineItem {
  /** Stable React key, e.g. "users-0". */
  id: string;
  /** Subgraph name — determines which row the bar occupies. */
  service: string;
  /** First top-level field from the fetch's operation string, or entity type names for entity fetches. */
  label: string;
  /** 0-based column where the bar begins. */
  depthStart: number;
  /** Exclusive end column (always depthStart + 1 for leaf fetches). */
  depthEnd: number;
  /** True when this item lies on the critical (longest sequential) path. */
  isOnCriticalPath: boolean;
  /** True when this fetch is an _entities call (federation entity resolution). */
  isEntityFetch: boolean;
}

export interface TimelineData {
  items: TimelineItem[];
  /** Ordered unique service names — one SVG row per entry. */
  services: string[];
  /** Total number of depth columns. */
  maxDepth: number;
}

/**
 * Walk the PlanNode tree and produce a flat list of TimelineItems ready for
 * SVG layout.
 *
 * Returns `{ items: [], services: [], maxDepth: 0 }` for plan trees that
 * contain no Fetch nodes (e.g. an empty Sequence).
 */
export function planToTimeline(root: PlanNode): TimelineData {
  const items: Omit<TimelineItem, "isOnCriticalPath">[] = [];
  let counter = 0;

  /**
   * Recursively walk a node starting at `depthStart`.
   * Returns the exclusive depth reached by this subtree.
   */
  function walk(node: PlanNode, depthStart: number): number {
    switch (node.kind) {
      case "Fetch": {
        const id = `${node.service}-${counter++}`;
        const isEntityFetch = topLevelField(node.operation) === "_entities";
        const label = isEntityFetch
          ? extractEntityTypes(node.operation).join(", ") || "_entities"
          : topLevelField(node.operation);
        items.push({
          id,
          service: node.service,
          label,
          depthStart,
          depthEnd: depthStart + 1,
          isEntityFetch,
        });
        return depthStart + 1;
      }

      case "Sequence": {
        let depth = depthStart;
        for (const child of node.nodes) {
          depth = walk(child, depth);
        }
        return depth;
      }

      case "Parallel": {
        if (node.nodes.length === 0) return depthStart;
        let maxEnd = depthStart;
        for (const child of node.nodes) {
          const end = walk(child, depthStart);
          if (end > maxEnd) maxEnd = end;
        }
        return maxEnd;
      }

      case "Flatten":
        return walk(node.node, depthStart);

      case "Subscription": {
        const afterPrimary = walk(node.primary, depthStart);
        return node.rest ? walk(node.rest, afterPrimary) : afterPrimary;
      }

      case "Defer": {
        const afterPrimary = node.primary ? walk(node.primary, depthStart) : depthStart;
        // Deferred branches run concurrently (parallel to primary).
        let maxEnd = afterPrimary;
        for (const branch of node.deferred) {
          if (branch.node) {
            const end = walk(branch.node, depthStart);
            if (end > maxEnd) maxEnd = end;
          }
        }
        return maxEnd;
      }

      case "Condition": {
        const ifEnd = node.ifBranch ? walk(node.ifBranch, depthStart) : depthStart;
        const elseEnd = node.elseBranch ? walk(node.elseBranch, depthStart) : depthStart;
        return Math.max(ifEnd, elseEnd);
      }
    }
  }

  const maxDepth = walk(root, 0);

  // Collect ordered unique service names in first-encounter order.
  const seen = new Set<string>();
  const services: string[] = [];
  for (const item of items) {
    if (!seen.has(item.service)) {
      seen.add(item.service);
      services.push(item.service);
    }
  }

  // Critical path detection:
  // A depth column is "sequential" (not parallel) when it has exactly one
  // occupant. Items at such columns form the longest sequential chain.
  // An item is on the critical path when every column from 0 to its depthEnd-1
  // is sequential, and the item's depthEnd reaches the global maxDepth via
  // sequential steps.
  //
  // This heuristic is exact for all real query plan shapes (Sequence-of-Parallels)
  // and avoids needing parent links after the flat walk.
  const depthCount = new Map<number, number>();
  for (const item of items) {
    depthCount.set(item.depthStart, (depthCount.get(item.depthStart) ?? 0) + 1);
  }

  // Find the deepest sequential column reachable from depth 0 without
  // passing through any parallel column.
  let criticalEnd = 0;
  for (let d = 0; d < maxDepth; d++) {
    if ((depthCount.get(d) ?? 0) === 1) {
      criticalEnd = d + 1;
    } else {
      // Parallel column breaks the sequential chain.
      break;
    }
  }

  const finalItems: TimelineItem[] = items.map((item) => ({
    ...item,
    isOnCriticalPath:
      criticalEnd === maxDepth &&
      maxDepth > 0 &&
      (depthCount.get(item.depthStart) ?? 0) === 1 &&
      item.depthEnd <= criticalEnd,
  }));

  return { items: finalItems, services, maxDepth };
}
