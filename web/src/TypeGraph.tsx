/**
 * TypeGraph.tsx — Interactive schema type graph using @xyflow/react + elkjs.
 *
 * Renders the composed supergraph as a node-link diagram where:
 *  - Nodes = GraphQL types (Object, Interface, Union, Input, Scalar, Enum)
 *  - Edges = field return-type references
 *  - Color = owning subgraph (same palette as Field Attribution and Entity Ownership Graph)
 *
 * Known limitation: On schemas with 100+ types the graph can become unwieldy.
 * The subgraph filter and scalar/enum toggle are the primary usability mitigations.
 */

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useState, memo } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import type { Node, Edge, NodeProps } from "@xyflow/react";
import type { ELK, ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";
import { schemaToTypeGraph } from "./schemaToTypeGraph";
import type { TypeKind } from "./schemaToTypeGraph";
import { subgraphColorVar } from "./subgraphColors";

// ---------------------------------------------------------------------------
// ELK singleton — loaded lazily on first render.
// ---------------------------------------------------------------------------

let elkInstance: ELK | null = null;

async function getElk(): Promise<ELK> {
  if (!elkInstance) {
    // Dynamic import keeps ELK (~1.5 MB) out of the initial bundle.
    const mod = await import("elkjs/lib/elk.bundled.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ElkConstructor = (mod as any).default ?? mod;
    elkInstance = new ElkConstructor() as ELK;
  }
  return elkInstance;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 160;
const NODE_HEIGHT_DEFAULT = 44;
const NODE_HEIGHT_SMALL = 28; // for Scalar/Enum

// ---------------------------------------------------------------------------
// Custom node renderer
// ---------------------------------------------------------------------------

interface TypeNodeData extends Record<string, unknown> {
  label: string;
  kind: TypeKind;
  subgraph: string | null;
  dimmed: boolean;
}

const KIND_LABEL: Record<TypeKind, string> = {
  object: "object",
  interface: "interface",
  union: "union",
  input: "input",
  scalar: "scalar",
  enum: "enum",
};

const TypeGraphNode = memo(function TypeGraphNode({ data }: NodeProps) {
  const d = data as TypeNodeData;
  const colorVar = d.subgraph ? subgraphColorVar(d.subgraph) : "var(--text-muted)";
  const isSmall = d.kind === "scalar" || d.kind === "enum";

  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: isSmall ? NODE_HEIGHT_SMALL : NODE_HEIGHT_DEFAULT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: `1.5px solid color-mix(in srgb, ${colorVar} 55%, transparent)`,
        background: `color-mix(in srgb, ${colorVar} 18%, var(--surface-2))`,
        opacity: d.dimmed ? 0.2 : 1,
        transition: "opacity 0.15s ease",
        cursor: "pointer",
        userSelect: "none",
        padding: "0 8px",
        boxSizing: "border-box",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} />
      <span
        style={{
          fontSize: isSmall ? 10 : 12,
          fontWeight: 600,
          color: "var(--text)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {d.label}
      </span>
      {!isSmall && (
        <span
          style={{
            fontSize: 9,
            color: "var(--text-muted)",
            marginTop: 2,
          }}
        >
          {KIND_LABEL[d.kind]}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} />
    </div>
  );
});

// Register nodeTypes outside the component for a stable reference (ReactFlow requirement).
const nodeTypes = { typeGraphNode: TypeGraphNode };

// ---------------------------------------------------------------------------
// Inner component — uses useReactFlow, must be inside ReactFlowProvider
// ---------------------------------------------------------------------------

interface TypeGraphInnerProps {
  supergraphSdl: string;
}

function TypeGraphInner({ supergraphSdl }: TypeGraphInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showScalarsEnums, setShowScalarsEnums] = useState(false);
  const [subgraphFilters, setSubgraphFilters] = useState<Set<string>>(new Set());
  const [layoutReady, setLayoutReady] = useState(
    () => schemaToTypeGraph(supergraphSdl).nodes.length === 0,
  );
  const { fitView } = useReactFlow();

  const graph = useMemo(() => schemaToTypeGraph(supergraphSdl), [supergraphSdl]);

  const [prevSdl, setPrevSdl] = useState(supergraphSdl);
  if (prevSdl !== supergraphSdl) {
    setPrevSdl(supergraphSdl);
    setSelectedNodeId(null);
    setSubgraphFilters(new Set());
  }

  // ---------------------------------------------------------------------------
  // Filter and layout effect — fires when filters or graph data changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (graph.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // Step 1: Apply scalar/enum toggle.
    let filteredNodes = graph.nodes;
    if (!showScalarsEnums) {
      filteredNodes = filteredNodes.filter((n) => n.kind !== "scalar" && n.kind !== "enum");
    }

    // Step 2: Apply subgraph filter.
    if (subgraphFilters.size > 0) {
      const inSubgraph = new Set(
        filteredNodes
          .filter((n) => n.subgraphs.some((sg) => subgraphFilters.has(sg)))
          .map((n) => n.id),
      );
      // Include direct neighbors (one hop away via edges).
      const neighbors = new Set<string>(inSubgraph);
      for (const edge of graph.edges) {
        if (inSubgraph.has(edge.sourceType)) neighbors.add(edge.targetType);
        if (inSubgraph.has(edge.targetType)) neighbors.add(edge.sourceType);
      }
      filteredNodes = filteredNodes.filter((n) => neighbors.has(n.id));
    }

    const nodeIds = new Set(filteredNodes.map((n) => n.id));

    // Filter edges — only keep edges where both source and target are in the filtered set.
    const filteredEdges = graph.edges.filter(
      (e) => nodeIds.has(e.sourceType) && nodeIds.has(e.targetType),
    );

    let cancelled = false;

    // Step 3: Run ELK layout.
    void (async () => {
      setLayoutReady(false);
      try {
        const elk = await getElk();

        const elkNodes: ElkNode[] = filteredNodes.map((n) => ({
          id: n.id,
          width: NODE_WIDTH,
          height:
            n.kind === "scalar" || n.kind === "enum" ? NODE_HEIGHT_SMALL : NODE_HEIGHT_DEFAULT,
        }));

        const elkEdges: ElkExtendedEdge[] = filteredEdges.map((e) => ({
          id: e.id,
          sources: [e.sourceType],
          targets: [e.targetType],
        }));

        const elkGraph: ElkNode = {
          id: "root",
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "DOWN",
            "elk.layered.spacing.nodeNodeBetweenLayers": "60",
            "elk.spacing.nodeNode": "40",
            "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
          },
          children: elkNodes,
          edges: elkEdges,
        };

        const laid = await elk.layout(elkGraph);

        // Build ReactFlow nodes with ELK positions.
        const rfNodes: Node[] = (laid.children ?? []).map((elkN) => {
          const n = filteredNodes.find((fn) => fn.id === elkN.id)!;
          return {
            id: n.id,
            type: "typeGraphNode",
            position: { x: elkN.x ?? 0, y: elkN.y ?? 0 },
            data: {
              label: n.typeName,
              kind: n.kind,
              subgraph: n.subgraph,
              dimmed: false,
            } satisfies TypeNodeData,
          };
        });

        // Build ReactFlow edges.
        const rfEdges: Edge[] = filteredEdges.map((e) => ({
          id: e.id,
          source: e.sourceType,
          target: e.targetType,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--text-muted)",
            width: 12,
            height: 12,
          },
          style: { stroke: "var(--text-muted)", strokeWidth: 1.5 },
          animated: false,
        }));

        if (!cancelled) {
          setNodes(rfNodes);
          setEdges(rfEdges);
          setLayoutReady(true);
          // Fit after layout is applied.
          setTimeout(() => fitView({ duration: 300, padding: 0.1 }), 50);
        }
      } catch (err) {
        console.error("ELK layout error:", err);
        if (!cancelled) setLayoutReady(true);
      }
    })();

    return () => {
      cancelled = true;
      setLayoutReady(true);
    };
  }, [graph, showScalarsEnums, subgraphFilters, setNodes, setEdges, fitView]);

  // ---------------------------------------------------------------------------
  // Node click → highlight neighbors / dim others
  // ---------------------------------------------------------------------------
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, clickedNode: Node) => {
      const newSelectedId = selectedNodeId === clickedNode.id ? null : clickedNode.id;
      setSelectedNodeId(newSelectedId);

      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            dimmed:
              newSelectedId !== null &&
              n.id !== newSelectedId &&
              !edges.some(
                (e) =>
                  (e.source === newSelectedId && e.target === n.id) ||
                  (e.target === newSelectedId && e.source === n.id),
              ),
          },
        })),
      );

      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          style: {
            ...e.style,
            stroke:
              newSelectedId === null || e.source === newSelectedId || e.target === newSelectedId
                ? "var(--text-muted)"
                : "var(--border)",
            opacity:
              newSelectedId === null || e.source === newSelectedId || e.target === newSelectedId
                ? 1
                : 0.15,
          },
        })),
      );
    },
    [selectedNodeId, edges, setNodes, setEdges],
  );

  // Clear selection when clicking on the canvas background.
  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, dimmed: false },
      })),
    );
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        style: { ...e.style, stroke: "var(--text-muted)", opacity: 1 },
      })),
    );
  }, [setNodes, setEdges]);

  const toggleSubgraph = useCallback((sg: string) => {
    setSubgraphFilters((prev) => {
      const next = new Set(prev);
      if (next.has(sg)) next.delete(sg);
      else next.add(sg);
      return next;
    });
  }, []);

  // Double-click on canvas background → fit view.
  // ReactFlow doesn't expose an onPaneDoubleClick prop, so we attach a handler
  // to the container div and check that the target is the pane itself.
  const handleContainerDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      // Only fit view when clicking on the pane background (not on nodes/controls).
      if (
        target.classList.contains("react-flow__pane") ||
        target.classList.contains("react-flow__background")
      ) {
        fitView({ duration: 300, padding: 0.1 });
      }
    },
    [fitView],
  );

  const { subgraphs } = graph;

  return (
    <div
      className="type-graph-root"
      style={{ width: "100%", height: "100%", position: "relative" }}
      onDoubleClick={handleContainerDoubleClick}
    >
      {/* Controls bar */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          maxWidth: "calc(100% - 16px)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 8px",
          fontSize: 12,
        }}
      >
        {subgraphs.length > 0 && (
          <>
            <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" }}>
              Subgraphs:
            </span>
            {subgraphs.map((sg) => (
              <label
                key={sg}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  cursor: "pointer",
                  color: subgraphFilters.has(sg) ? "var(--text)" : "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                <input
                  type="checkbox"
                  checked={subgraphFilters.has(sg)}
                  onChange={() => toggleSubgraph(sg)}
                />
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: subgraphColorVar(sg),
                    flexShrink: 0,
                  }}
                />
                {sg}
              </label>
            ))}
            <span
              style={{ width: 1, height: 14, background: "var(--border)", flexShrink: 0 }}
              aria-hidden
            />
          </>
        )}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showScalarsEnums}
            onChange={(e) => setShowScalarsEnums(e.target.checked)}
          />
          Scalars &amp; Enums
        </label>
      </div>

      {/* Loading spinner */}
      {!layoutReady && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
            background: "rgba(15, 24, 38, 0.5)",
          }}
        >
          <span
            className="spinner"
            aria-label="Computing layout"
            style={{ width: 24, height: 24, borderWidth: 3 }}
          />
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} color="var(--border)" gap={20} size={1} />
        <Controls />
        <MiniMap
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
          }}
          maskColor="rgba(15, 24, 38, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component — wraps in ReactFlowProvider
// ---------------------------------------------------------------------------

export interface TypeGraphProps {
  supergraphSdl: string;
}

export function TypeGraph({ supergraphSdl }: TypeGraphProps) {
  return (
    <ReactFlowProvider>
      <TypeGraphInner supergraphSdl={supergraphSdl} />
    </ReactFlowProvider>
  );
}
