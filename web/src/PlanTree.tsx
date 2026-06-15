import type { DeferredBranch, PlanNode } from "./core/types";

const INDENT = 16;

export function PlanTree({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  const indent = depth * INDENT;

  switch (node.kind) {
    case "Fetch":
      return (
        <div style={{ paddingLeft: indent }}>
          <div className="plan-node__label">
            <strong>Fetch</strong> <span className="plan-node__service">{node.service}</span>{" "}
            <span className="badge badge--neutral">{node.operation_kind}</span>
          </div>
          <pre className="plan-node__op">{node.operation}</pre>
        </div>
      );

    case "Sequence":
    case "Parallel":
      return (
        <div style={{ paddingLeft: indent }}>
          <div className="plan-node__label" style={{ fontWeight: 600 }}>
            {node.kind}
          </div>
          {node.nodes.map((child, i) => (
            <PlanTree key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      );

    case "Flatten":
      return (
        <div style={{ paddingLeft: indent }}>
          <div className="plan-node__label">
            <strong>Flatten</strong>{" "}
            <span className="plan-node__meta">@ {node.path.join(".")}</span>
          </div>
          <PlanTree node={node.node} depth={depth + 1} />
        </div>
      );

    case "Subscription":
      return (
        <div style={{ paddingLeft: indent }}>
          <div className="plan-node__label" style={{ fontWeight: 600 }}>
            Subscription
          </div>
          <PlanTree node={node.primary} depth={depth + 1} />
          {node.rest && <PlanTree node={node.rest} depth={depth + 1} />}
        </div>
      );

    case "Defer":
      return (
        <div style={{ paddingLeft: indent }}>
          <div className="plan-node__label" style={{ fontWeight: 600 }}>
            Defer
          </div>
          {node.primary && <PlanTree node={node.primary} depth={depth + 1} />}
          {node.deferred.map((branch, i) => (
            <DeferBranch key={i} branch={branch} depth={depth + 1} />
          ))}
        </div>
      );

    case "Condition":
      return (
        <div style={{ paddingLeft: indent }}>
          <div className="plan-node__label">
            <strong>Condition</strong>{" "}
            <span className="plan-node__meta">{node.conditionVariable}</span>
          </div>
          {node.ifBranch && (
            <>
              <div className="plan-node__meta" style={{ paddingLeft: (depth + 1) * INDENT }}>
                if:
              </div>
              <PlanTree node={node.ifBranch} depth={depth + 2} />
            </>
          )}
          {node.elseBranch && (
            <>
              <div className="plan-node__meta" style={{ paddingLeft: (depth + 1) * INDENT }}>
                else:
              </div>
              <PlanTree node={node.elseBranch} depth={depth + 2} />
            </>
          )}
        </div>
      );
  }
}

function DeferBranch({ branch, depth }: { branch: DeferredBranch; depth: number }) {
  return (
    <div style={{ paddingLeft: depth * INDENT }}>
      {branch.label && <div className="plan-node__meta">label: {branch.label}</div>}
      {branch.node && <PlanTree node={branch.node} depth={depth} />}
    </div>
  );
}
