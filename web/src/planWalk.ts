/**
 * planWalk — owns all knowledge of PlanNode's shape (which variants exist and
 * how to descend into their children). This is the single place to edit when
 * a new PlanNode variant is added to core/types.ts; every consumer that only
 * needs generic descent or a flat list of Fetch leaves builds on top of this
 * module instead of re-encoding the Sequence/Parallel/Flatten/Subscription/
 * Defer/Condition switch itself.
 *
 * Consumers with genuinely per-kind behavior (Mermaid syntax emission,
 * timeline depth folding, JSX rendering) still need their own switch over
 * PlanNode — that's irreducible, since each produces different *output* per
 * kind, not just different descent.
 */

import type { PlanNode } from "./core/types";

export type FetchNode = Extract<PlanNode, { kind: "Fetch" }>;

/** Returns the direct child PlanNodes of any node (`[]` for Fetch leaves). */
export function planChildren(node: PlanNode): PlanNode[] {
  switch (node.kind) {
    case "Fetch":
      return [];
    case "Sequence":
    case "Parallel":
      return node.nodes;
    case "Flatten":
      return [node.node];
    case "Subscription":
      return node.rest ? [node.primary, node.rest] : [node.primary];
    case "Defer": {
      const children: PlanNode[] = [];
      if (node.primary) children.push(node.primary);
      for (const branch of node.deferred) {
        if (branch.node) children.push(branch.node);
      }
      return children;
    }
    case "Condition": {
      const children: PlanNode[] = [];
      if (node.ifBranch) children.push(node.ifBranch);
      if (node.elseBranch) children.push(node.elseBranch);
      return children;
    }
  }
}

/** Pre-order walk that flattens a PlanNode tree to its Fetch leaves. */
export function iterateFetches(root: PlanNode): FetchNode[] {
  const out: FetchNode[] = [];
  (function visit(node: PlanNode) {
    if (node.kind === "Fetch") {
      out.push(node);
      return;
    }
    for (const child of planChildren(node)) visit(child);
  })(root);
  return out;
}

/** Collect unique service names from a PlanNode tree in first-encounter order. */
export function collectServiceNames(root: PlanNode): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of iterateFetches(root)) {
    if (!seen.has(f.service)) {
      seen.add(f.service);
      out.push(f.service);
    }
  }
  return out;
}
