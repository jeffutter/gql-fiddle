import type { PlanNode } from "./core/types";
import { formatRequiresSelections } from "./formatRequires";
import { collectServiceNames, planChildren } from "./planWalk";

/** Extract the first top-level field name from a GraphQL operation string. */
function topLevelSelection(operation: string): string {
  const m = operation.match(/\{\s*([_A-Za-z][_0-9A-Za-z]*)/);
  return m ? m[1] : "…";
}

/**
 * Recursively emit Mermaid sequenceDiagram lines for a PlanNode subtree.
 *
 * Design notes:
 * - Flatten path is forwarded as a Note on the inner Fetch rather than a
 *   separate actor, keeping the participant list small.
 * - A single-child Parallel emits its child directly (no par/end wrapper)
 *   because Mermaid requires at least two branches in a par block.
 */
function emitLines(node: PlanNode, flattenPath?: string[]): string[] {
  switch (node.kind) {
    case "Fetch": {
      const label = topLevelSelection(node.operation);
      const lines: string[] = [`  Router->>${node.service}: ${label}`];
      if (flattenPath && flattenPath.length > 0) {
        lines.push(`  Note over Router,${node.service}: flatten @ ${flattenPath.join(".")}`);
      }
      if (node.requires && node.requires.length > 0) {
        lines.push(
          `  Note right of ${node.service}: requires: ${formatRequiresSelections(node.requires)}`,
        );
      }
      lines.push(`  ${node.service}-->>Router: ${label}`);
      return lines;
    }

    case "Parallel": {
      if (node.nodes.length === 0) return [];
      // Single-branch Parallel: Mermaid rejects a par block with < 2 branches.
      if (node.nodes.length === 1) return emitLines(node.nodes[0]);
      const [first, ...rest] = node.nodes;
      const out: string[] = ["  par", ...emitLines(first)];
      for (const n of rest) {
        out.push("  and");
        out.push(...emitLines(n));
      }
      out.push("  end");
      return out;
    }

    case "Flatten":
      return emitLines(node.node, node.path);

    // Sequence/Subscription/Defer/Condition are pure descent (no auxiliary
    // parameter threading like Flatten's path or Parallel's par/and/end
    // wrapping), so they share planChildren's traversal order.
    case "Sequence":
    case "Subscription":
    case "Defer":
    case "Condition":
      return planChildren(node).flatMap((n) => emitLines(n));
  }
}

/**
 * Convert a PlanNode tree to a Mermaid sequenceDiagram definition string.
 *
 * Rendering decision: Mermaid was chosen over hand-rolled SVG because the
 * 7-variant PlanNode type (including nested par/end for Parallel) would
 * require significant layout arithmetic. Dynamic import in SequenceDiagram.tsx
 * keeps the ~200 KB bundle cost out of the initial load.
 */
export function planToMermaid(root: PlanNode): string {
  const participants = collectServiceNames(root);
  const header = [
    "sequenceDiagram",
    "  participant Router",
    ...participants.map((s) => `  participant ${s}`),
  ];
  return [...header, ...emitLines(root)].join("\n");
}
