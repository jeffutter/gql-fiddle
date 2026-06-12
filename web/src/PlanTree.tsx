import type { DeferredBranch, PlanNode } from "./core/types";

const INDENT = 16;

export function PlanTree({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  const indent = depth * INDENT;

  switch (node.kind) {
    case "Fetch":
      return (
        <div style={{ paddingLeft: indent }}>
          <div style={{ fontFamily: "monospace", fontSize: 13 }}>
            <strong>Fetch</strong> <span style={{ color: "#2563eb" }}>{node.service}</span>{" "}
            <span
              style={{
                backgroundColor: "#e5e7eb",
                borderRadius: 3,
                padding: "1px 5px",
                fontSize: 11,
              }}
            >
              {node.operation_kind}
            </span>
          </div>
          <pre
            style={{
              margin: "2px 0 4px",
              fontSize: 12,
              backgroundColor: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              padding: "4px 8px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {node.operation}
          </pre>
        </div>
      );

    case "Sequence":
    case "Parallel":
      return (
        <div style={{ paddingLeft: indent }}>
          <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>{node.kind}</div>
          {node.nodes.map((child, i) => (
            <PlanTree key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      );

    case "Flatten":
      return (
        <div style={{ paddingLeft: indent }}>
          <div style={{ fontFamily: "monospace", fontSize: 13 }}>
            <strong>Flatten</strong>{" "}
            <span style={{ color: "#6b7280" }}>@ {node.path.join(".")}</span>
          </div>
          <PlanTree node={node.node} depth={depth + 1} />
        </div>
      );

    case "Subscription":
      return (
        <div style={{ paddingLeft: indent }}>
          <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>Subscription</div>
          <PlanTree node={node.primary} depth={depth + 1} />
          {node.rest && <PlanTree node={node.rest} depth={depth + 1} />}
        </div>
      );

    case "Defer":
      return (
        <div style={{ paddingLeft: indent }}>
          <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>Defer</div>
          {node.primary && <PlanTree node={node.primary} depth={depth + 1} />}
          {node.deferred.map((branch, i) => (
            <DeferBranch key={i} branch={branch} depth={depth + 1} />
          ))}
        </div>
      );

    case "Condition":
      return (
        <div style={{ paddingLeft: indent }}>
          <div style={{ fontFamily: "monospace", fontSize: 13 }}>
            <strong>Condition</strong>{" "}
            <span style={{ color: "#6b7280" }}>{node.conditionVariable}</span>
          </div>
          {node.ifBranch && (
            <>
              <div
                style={{
                  paddingLeft: (depth + 1) * INDENT,
                  fontSize: 12,
                  color: "#6b7280",
                  fontFamily: "monospace",
                }}
              >
                if:
              </div>
              <PlanTree node={node.ifBranch} depth={depth + 2} />
            </>
          )}
          {node.elseBranch && (
            <>
              <div
                style={{
                  paddingLeft: (depth + 1) * INDENT,
                  fontSize: 12,
                  color: "#6b7280",
                  fontFamily: "monospace",
                }}
              >
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
      {branch.label && (
        <div style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>
          label: {branch.label}
        </div>
      )}
      {branch.node && <PlanTree node={branch.node} depth={depth} />}
    </div>
  );
}
