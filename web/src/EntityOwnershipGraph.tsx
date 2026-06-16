import { useState } from "react";
import type { EntityGraph, EntityEdge } from "./schemaToEntityGraph";
import { subgraphColorVar } from "./subgraphColors";

// ---------------------------------------------------------------------------
// Layout constants — all sizes in SVG user units (≈ px at 1:1 scale).
// ---------------------------------------------------------------------------

const CLUSTER_PADDING = 16;
const CLUSTER_HEADER_HEIGHT = 28;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 36;
const NODE_SPACING = 10;
const CLUSTER_COLS = 3;
const CLUSTER_COL_GAP = 60;
const CLUSTER_ROW_GAP = 60;
const SVG_PADDING = 24;

const TOOLTIP_WIDTH = 260;
const TOOLTIP_HEIGHT = 36;
const TOOLTIP_FONT = 11;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number;
  y: number;
  text: string;
}

interface ClusterLayout {
  subgraph: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NodeLayout {
  id: string;
  typeName: string;
  subgraph: string;
  keyFields: string[];
  x: number;
  y: number;
  cx: number;
  cy: number;
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

function computeLayout(graph: EntityGraph): {
  clusters: ClusterLayout[];
  nodes: NodeLayout[];
  svgWidth: number;
  svgHeight: number;
} {
  const { subgraphs, nodes } = graph;

  // Group nodes by subgraph.
  const nodesBySubgraph = new Map<string, typeof nodes>();
  for (const sg of subgraphs) nodesBySubgraph.set(sg, []);
  for (const n of nodes) nodesBySubgraph.get(n.subgraph)?.push(n);

  // Compute per-cluster size.
  const clusterSizes = new Map<string, { w: number; h: number }>();
  for (const sg of subgraphs) {
    const cnt = nodesBySubgraph.get(sg)?.length ?? 0;
    const w = NODE_WIDTH + CLUSTER_PADDING * 2;
    const h =
      CLUSTER_HEADER_HEIGHT +
      CLUSTER_PADDING +
      cnt * NODE_HEIGHT +
      Math.max(0, cnt - 1) * NODE_SPACING +
      CLUSTER_PADDING;
    clusterSizes.set(sg, { w, h });
  }

  // Arrange clusters in a grid (up to CLUSTER_COLS columns).
  const clusters: ClusterLayout[] = [];
  let rowX = SVG_PADDING;
  let rowY = SVG_PADDING;
  let rowMaxH = 0;
  let col = 0;

  for (const sg of subgraphs) {
    const { w, h } = clusterSizes.get(sg)!;
    if (col > 0 && col >= CLUSTER_COLS) {
      // Wrap to next row.
      rowX = SVG_PADDING;
      rowY += rowMaxH + CLUSTER_ROW_GAP;
      rowMaxH = 0;
      col = 0;
    }

    clusters.push({ subgraph: sg, x: rowX, y: rowY, width: w, height: h });
    rowX += w + CLUSTER_COL_GAP;
    rowMaxH = Math.max(rowMaxH, h);
    col++;
  }

  // Compute node positions.
  const nodeLayouts: NodeLayout[] = [];
  for (const cl of clusters) {
    const sgNodes = nodesBySubgraph.get(cl.subgraph) ?? [];
    sgNodes.forEach((n, idx) => {
      const nx = cl.x + CLUSTER_PADDING;
      const ny =
        cl.y + CLUSTER_HEADER_HEIGHT + CLUSTER_PADDING + idx * (NODE_HEIGHT + NODE_SPACING);
      nodeLayouts.push({
        ...n,
        x: nx,
        y: ny,
        cx: nx + NODE_WIDTH / 2,
        cy: ny + NODE_HEIGHT / 2,
      });
    });
  }

  const svgWidth = clusters.reduce((max, c) => Math.max(max, c.x + c.width), 0) + SVG_PADDING;
  const svgHeight = clusters.reduce((max, c) => Math.max(max, c.y + c.height), 0) + SVG_PADDING;

  return { clusters, nodes: nodeLayouts, svgWidth, svgHeight };
}

// ---------------------------------------------------------------------------
// Edge rendering helpers
// ---------------------------------------------------------------------------

/**
 * Determine if a given edge has a reverse counterpart (making it bidirectional).
 */
function isBidirectional(edge: EntityEdge, edges: EntityEdge[]): boolean {
  return edges.some(
    (e) =>
      e.id !== edge.id &&
      e.sourceSubgraph === edge.targetSubgraph &&
      e.targetSubgraph === edge.sourceSubgraph,
  );
}

/**
 * Build a cubic Bezier path string connecting two node centers, routing via
 * control points outside of the clusters.
 *
 * For bidirectional pairs the two curves are offset so both are visible.
 */
function edgePath(
  srcNode: NodeLayout | undefined,
  tgtNode: NodeLayout | undefined,
  bidirectional: boolean,
  isReverse: boolean,
): string {
  if (!srcNode || !tgtNode) return "";

  // Use the right edge of source and left edge of target.
  const x1 = srcNode.x + NODE_WIDTH;
  const y1 = srcNode.cy;
  const x2 = tgtNode.x;
  const y2 = tgtNode.cy;

  // Control point horizontal offset — fan bidirectional curves apart slightly.
  const cpOff = bidirectional ? (isReverse ? 60 : -60) : 0;
  const cpX1 = (x1 + x2) / 2 + cpOff;
  const cpX2 = cpX1;

  return `M ${x1} ${y1} C ${cpX1} ${y1} ${cpX2} ${y2} ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EntityOwnershipGraphProps {
  graph: EntityGraph;
}

export function EntityOwnershipGraph({ graph }: EntityOwnershipGraphProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  if (graph.nodes.length === 0) {
    return <p className="empty-state">No entity types found.</p>;
  }

  const { clusters, nodes: nodeLayouts, svgWidth, svgHeight } = computeLayout(graph);

  // Build a lookup: "SUBGRAPH:TypeName" → NodeLayout
  const nodeById = new Map<string, NodeLayout>();
  for (const n of nodeLayouts) nodeById.set(n.id, n);

  // Arrowhead markers — one standard, one bidirectional.
  const arrowNormal = "arrow-normal";
  const arrowBidir = "arrow-bidir";

  return (
    <div style={{ overflowX: "auto", overflowY: "auto" }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: "block", fontFamily: "var(--font-ui)", overflow: "visible" }}
        aria-label="Entity ownership graph"
      >
        <defs>
          {/* Standard arrowhead */}
          <marker
            id={arrowNormal}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-muted)" />
          </marker>
          {/* Bidirectional arrowhead */}
          <marker
            id={arrowBidir}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--warning)" />
          </marker>
        </defs>

        {/* Subgraph cluster backgrounds */}
        {clusters.map((cl) => {
          const colorVar = subgraphColorVar(cl.subgraph);
          return (
            <g key={`cluster-${cl.subgraph}`}>
              <rect
                x={cl.x}
                y={cl.y}
                width={cl.width}
                height={cl.height}
                rx={8}
                fill={`color-mix(in srgb, ${colorVar} 12%, var(--surface))`}
                stroke={`color-mix(in srgb, ${colorVar} 50%, transparent)`}
                strokeWidth={1.5}
              />
              {/* Cluster header */}
              <rect
                x={cl.x}
                y={cl.y}
                width={cl.width}
                height={CLUSTER_HEADER_HEIGHT}
                rx={8}
                fill={`color-mix(in srgb, ${colorVar} 22%, var(--surface-2))`}
              />
              {/* Mask bottom corners of header */}
              <rect
                x={cl.x}
                y={cl.y + CLUSTER_HEADER_HEIGHT - 8}
                width={cl.width}
                height={8}
                fill={`color-mix(in srgb, ${colorVar} 22%, var(--surface-2))`}
              />
              <text
                x={cl.x + cl.width / 2}
                y={cl.y + CLUSTER_HEADER_HEIGHT / 2}
                fill={colorVar}
                fontSize={12}
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ userSelect: "none" }}
              >
                {cl.subgraph}
              </text>
            </g>
          );
        })}

        {/* Entity nodes */}
        {nodeLayouts.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={5}
              fill="var(--surface-2)"
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text
              x={n.cx}
              y={n.cy - 6}
              fill="var(--text)"
              fontSize={11}
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ userSelect: "none", pointerEvents: "none" }}
            >
              {n.typeName}
            </text>
            <text
              x={n.cx}
              y={n.cy + 8}
              fill="var(--text-muted)"
              fontSize={10}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ userSelect: "none", pointerEvents: "none" }}
            >
              @key({n.keyFields.join(", ")})
            </text>
          </g>
        ))}

        {/* Edges — rendered after nodes so arrows overlay clusters */}
        {graph.edges.map((edge) => {
          // Find the best source/target node layouts.
          // Source: entity node in the sourceSubgraph (any type that happens to have a
          // field referencing targetType — we use the first node in the source cluster).
          const srcNode = nodeLayouts.find((n) => n.subgraph === edge.sourceSubgraph);
          const tgtNode = nodeLayouts.find(
            (n) => n.subgraph === edge.targetSubgraph && n.typeName === edge.typeName,
          );

          const bidir = isBidirectional(edge, graph.edges);
          // Determine ordering for curve offset — use id comparison for stability.
          const isReverse =
            bidir &&
            graph.edges.findIndex((e) => e.id === edge.id) >
              graph.edges.findIndex(
                (e) =>
                  e.sourceSubgraph === edge.targetSubgraph &&
                  e.targetSubgraph === edge.sourceSubgraph,
              );

          const d = edgePath(srcNode, tgtNode, bidir, isReverse);
          if (!d) return null;

          const stroke = bidir ? "var(--warning)" : "var(--text-muted)";
          const marker = bidir ? `url(#${arrowBidir})` : `url(#${arrowNormal})`;

          // Compute midpoint for tooltip hit area.
          const midX = srcNode && tgtNode ? (srcNode.x + NODE_WIDTH + tgtNode.x) / 2 : 0;
          const midY = srcNode && tgtNode ? (srcNode.cy + tgtNode.cy) / 2 : 0;

          return (
            <g
              key={edge.id}
              onMouseEnter={() =>
                setTooltip({
                  x: midX - TOOLTIP_WIDTH / 2,
                  y: midY - TOOLTIP_HEIGHT - 6,
                  text: `Resolved via @key(fields: "${edge.keyFields}")`,
                })
              }
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: "default" }}
            >
              {/* Wider invisible hit area */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                style={{ pointerEvents: "stroke" }}
              />
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                markerEnd={marker}
                style={{ pointerEvents: "none" }}
              />
            </g>
          );
        })}

        {/* Tooltip — rendered last so it draws on top */}
        {tooltip && (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={tooltip.x}
              y={tooltip.y}
              width={TOOLTIP_WIDTH}
              height={TOOLTIP_HEIGHT}
              rx={4}
              fill="var(--surface-3)"
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text
              x={tooltip.x + 10}
              y={tooltip.y + TOOLTIP_HEIGHT / 2}
              fill="var(--text)"
              fontSize={TOOLTIP_FONT}
              dominantBaseline="middle"
              style={{ userSelect: "none" }}
            >
              {tooltip.text}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
