import type { PlanNode, RequiresSelection } from "./core/types";

/** Walk the tree and return unique service names in first-encounter order. */
function collectParticipants(
  node: PlanNode,
  seen = new Set<string>(),
  out: string[] = [],
): string[] {
  switch (node.kind) {
    case "Fetch":
      if (!seen.has(node.service)) {
        seen.add(node.service);
        out.push(node.service);
      }
      break;
    case "Sequence":
    case "Parallel":
      node.nodes.forEach((n) => collectParticipants(n, seen, out));
      break;
    case "Flatten":
      collectParticipants(node.node, seen, out);
      break;
    case "Subscription":
      collectParticipants(node.primary, seen, out);
      if (node.rest) collectParticipants(node.rest, seen, out);
      break;
    case "Defer":
      if (node.primary) collectParticipants(node.primary, seen, out);
      node.deferred.forEach((d) => {
        if (d.node) collectParticipants(d.node, seen, out);
      });
      break;
    case "Condition":
      if (node.ifBranch) collectParticipants(node.ifBranch, seen, out);
      if (node.elseBranch) collectParticipants(node.elseBranch, seen, out);
      break;
  }
  return out;
}

/** Extract the first top-level field name from a GraphQL operation string. */
function topLevelSelection(operation: string): string {
  const m = operation.match(/\{\s*([_A-Za-z][_0-9A-Za-z]*)/);
  return m ? m[1] : "…";
}

/** Flatten RequiresSelection recursively to a comma-separated list of field names. */
function formatRequires(requires: RequiresSelection[]): string {
  function fields(sel: RequiresSelection): string[] {
    if (sel.kind === "Field") {
      return [sel.alias ?? sel.name, ...(sel.selections ?? []).flatMap(fields)];
    }
    return (sel.selections ?? []).flatMap(fields);
  }
  return requires.flatMap(fields).join(", ");
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
        lines.push(`  Note right of ${node.service}: requires: ${formatRequires(node.requires)}`);
      }
      return lines;
    }

    case "Sequence":
      return node.nodes.flatMap((n) => emitLines(n));

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

    case "Subscription":
      return [...emitLines(node.primary), ...(node.rest ? emitLines(node.rest) : [])];

    case "Defer":
      return [
        ...(node.primary ? emitLines(node.primary) : []),
        ...node.deferred.flatMap((d) => (d.node ? emitLines(d.node) : [])),
      ];

    case "Condition":
      return [
        ...(node.ifBranch ? emitLines(node.ifBranch) : []),
        ...(node.elseBranch ? emitLines(node.elseBranch) : []),
      ];
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
  const participants = collectParticipants(root);
  const header = [
    "sequenceDiagram",
    "  participant Router",
    ...participants.map((s) => `  participant ${s}`),
  ];
  return [...header, ...emitLines(root)].join("\n");
}
