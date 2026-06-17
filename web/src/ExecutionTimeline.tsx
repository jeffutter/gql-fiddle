import { useState } from "react";
import type { PlanNode } from "./core/types";
import { planToTimeline } from "./planToTimeline";

// Layout constants — all sizes in SVG user units (≈ px at 1:1 scale).
const ROW_HEIGHT = 36;
const ROW_PADDING = 6;
const BAR_HEIGHT = ROW_HEIGHT - ROW_PADDING * 2;
const COL_WIDTH = 180;
const LABEL_WIDTH = 110;
const CHART_PADDING = 12;
// Horizontal gap on each side of a bar within its column
const BAR_GAP = 4;
const TOOLTIP_WIDTH = 200;
const TOOLTIP_HEIGHT_BASE = 46;
const TOOLTIP_HEIGHT_ENTITY = 62;
const TOOLTIP_FONT = 11;

interface TooltipState {
  x: number;
  y: number;
  service: string;
  label: string;
  isEntityFetch: boolean;
}

/**
 * Renders the query plan as a horizontal Gantt-style SVG chart — one row per
 * subgraph, bars positioned by execution depth.
 *
 * Parallel fetches share the same horizontal column; sequential fetches occupy
 * increasing columns left to right. The critical path (longest purely sequential
 * chain) is highlighted in the accent colour.
 *
 * The component takes a resolved PlanNode; null/error guards live in App.tsx,
 * matching the pattern used by SequenceDiagram.
 */
export function ExecutionTimeline({ node }: { node: PlanNode }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { items, services, maxDepth } = planToTimeline(node);

  if (items.length === 0) {
    return <p className="empty-state">No fetch nodes found in this plan.</p>;
  }

  const svgWidth = LABEL_WIDTH + maxDepth * COL_WIDTH + CHART_PADDING * 2;
  const svgHeight = services.length * ROW_HEIGHT + CHART_PADDING * 2;

  const hasEntityFetch = items.some((i) => i.isEntityFetch);
  const hasCriticalPath = maxDepth > 0 && items.some((i) => i.isOnCriticalPath);

  function barX(depthStart: number) {
    return LABEL_WIDTH + depthStart * COL_WIDTH + BAR_GAP;
  }
  function barY(serviceIndex: number) {
    return CHART_PADDING + serviceIndex * ROW_HEIGHT + ROW_PADDING;
  }
  function barWidth(depthStart: number, depthEnd: number) {
    return (depthEnd - depthStart) * COL_WIDTH - BAR_GAP * 2;
  }

  return (
    <div>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ display: "block", fontFamily: "var(--font-ui)", overflow: "visible" }}
        aria-label="Execution timeline"
      >
        {/* Alternating row background stripes */}
        {services.map((svc, rowIdx) => (
          <rect
            key={`row-bg-${svc}`}
            x={0}
            y={CHART_PADDING + rowIdx * ROW_HEIGHT}
            width={svgWidth}
            height={ROW_HEIGHT}
            fill={rowIdx % 2 === 0 ? "var(--surface)" : "var(--surface-2)"}
          />
        ))}

        {/* Vertical depth-column gridlines */}
        {Array.from({ length: maxDepth + 1 }, (_, col) => (
          <line
            key={`grid-${col}`}
            x1={LABEL_WIDTH + col * COL_WIDTH}
            y1={CHART_PADDING}
            x2={LABEL_WIDTH + col * COL_WIDTH}
            y2={CHART_PADDING + services.length * ROW_HEIGHT}
            stroke="var(--border)"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
        ))}

        {/* Row labels */}
        {services.map((svc, rowIdx) => (
          <text
            key={`label-${svc}`}
            x={LABEL_WIDTH - BAR_GAP * 2}
            y={barY(rowIdx) + BAR_HEIGHT / 2}
            fill="var(--text-muted)"
            fontSize={11}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {svc}
          </text>
        ))}

        {/* Bars */}
        {items.map((item) => {
          const rowIdx = services.indexOf(item.service);
          const x = barX(item.depthStart);
          const y = barY(rowIdx);
          const w = barWidth(item.depthStart, item.depthEnd);
          const h = BAR_HEIGHT;

          // Three-way bar color: entity fetch > critical path > normal
          const barFill = item.isEntityFetch
            ? "var(--entity-fetch)"
            : item.isOnCriticalPath
              ? "var(--accent)"
              : "var(--surface-3)";
          const barStroke = item.isEntityFetch
            ? "var(--entity-fetch)"
            : item.isOnCriticalPath
              ? "var(--accent-hover)"
              : "var(--border-strong)";
          const textFill = item.isEntityFetch
            ? "var(--entity-fetch-contrast)"
            : item.isOnCriticalPath
              ? "var(--accent-contrast)"
              : "var(--text)";

          const tooltipHeight = item.isEntityFetch ? TOOLTIP_HEIGHT_ENTITY : TOOLTIP_HEIGHT_BASE;
          // Clamp tooltip so it doesn't overflow the SVG right edge.
          const tipX = x + w / 2 - TOOLTIP_WIDTH / 2;
          const clampedTipX = Math.max(0, Math.min(tipX, svgWidth - TOOLTIP_WIDTH));
          // Place tooltip above bar; flip below if at top.
          const tipY = y > tooltipHeight + 4 ? y - tooltipHeight - 4 : y + h + 4;

          return (
            <g
              key={item.id}
              onMouseEnter={() =>
                setTooltip({
                  x: clampedTipX,
                  y: tipY,
                  service: item.service,
                  label: item.label,
                  isEntityFetch: item.isEntityFetch,
                })
              }
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: "default" }}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={4}
                fill={barFill}
                stroke={barStroke}
                strokeWidth={1}
              />
              {/* Bar label — truncate via SVG clipPath-free approach: use narrow rect */}
              <text
                x={x + w / 2}
                y={y + h / 2}
                fill={textFill}
                fontSize={TOOLTIP_FONT}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {(() => {
                  const maxChars = Math.max(3, Math.floor(w / 6.5));
                  return item.label.length > maxChars
                    ? item.label.slice(0, maxChars - 1) + "…"
                    : item.label;
                })()}
              </text>
            </g>
          );
        })}

        {/* Hover tooltip — rendered last so it draws on top */}
        {tooltip && (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={tooltip.x}
              y={tooltip.y}
              width={TOOLTIP_WIDTH}
              height={tooltip.isEntityFetch ? TOOLTIP_HEIGHT_ENTITY : TOOLTIP_HEIGHT_BASE}
              rx={4}
              fill="var(--surface-3)"
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text
              x={tooltip.x + 8}
              y={tooltip.y + 14}
              fill="var(--text-muted)"
              fontSize={TOOLTIP_FONT}
            >
              {tooltip.service}
            </text>
            <text
              x={tooltip.x + 8}
              y={tooltip.y + 30}
              fill="var(--text)"
              fontSize={TOOLTIP_FONT}
              fontWeight="600"
            >
              {tooltip.label}
            </text>
            {tooltip.isEntityFetch && (
              <text
                x={tooltip.x + 8}
                y={tooltip.y + 48}
                fill="var(--entity-fetch)"
                fontSize={TOOLTIP_FONT}
              >
                [E] Entity fetch
              </text>
            )}
          </g>
        )}
      </svg>
      {(hasCriticalPath || hasEntityFetch) && (
        <div className="timeline-legend">
          {hasCriticalPath && (
            <span className="timeline-legend__item">
              <svg width="12" height="12" aria-hidden="true">
                <rect width="12" height="12" rx="2" fill="var(--accent)" />
              </svg>
              Critical path
            </span>
          )}
          {hasEntityFetch && (
            <span className="timeline-legend__item">
              <svg width="12" height="12" aria-hidden="true">
                <rect width="12" height="12" rx="2" fill="var(--entity-fetch)" />
              </svg>
              Entity fetch (_entities)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
