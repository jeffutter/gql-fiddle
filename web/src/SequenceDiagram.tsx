import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PlanNode } from "./core/types";
import { planToMermaid } from "./planToMermaid";
import { MERMAID_THEME_VARIABLES } from "./monacoTheme";

// Rendering approach: Mermaid is dynamically imported on first render so the
// ~200 KB library stays out of the initial bundle. mermaid.initialize() is
// called once with startOnLoad:false; subsequent renders call mermaid.render()
// with a unique ID. Direct SVG was the alternative, but the 7-variant PlanNode
// type (especially nested Parallel → par/end blocks) would require non-trivial
// layout arithmetic; Mermaid handles this automatically.
let mermaidInitialized = false;

export function SequenceDiagram({
  node,
  containerRef: externalRef,
}: {
  node: PlanNode;
  // Optional: lets a parent reach the rendered <svg> (e.g. for image export)
  // without a global document query. Falls back to an internal ref.
  containerRef?: RefObject<HTMLDivElement | null>;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = externalRef ?? internalRef;
  const [error, setError] = useState<string | null>(null);
  const idCounter = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "base",
            themeVariables: MERMAID_THEME_VARIABLES,
          });
          mermaidInitialized = true;
        }
        const definition = planToMermaid(node);
        // Each render call must receive a unique ID within the page session.
        const id = `seq-diagram-${idCounter.current++}`;
        const { svg } = await mermaid.render(id, definition);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
    // containerRef is stable (a ref object); listed to satisfy exhaustive-deps.
  }, [node, containerRef]);

  if (error) {
    return (
      <div className="callout callout--error" style={{ margin: 8 }}>
        Failed to render sequence diagram: {error}
      </div>
    );
  }

  return <div ref={containerRef} style={{ overflow: "auto", padding: 8 }} />;
}
