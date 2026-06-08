import { useEffect, useState } from "react";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import Editor from "@monaco-editor/react";
import { useWorkspace } from "./store";
import { loadCore } from "./core";
import type { ComposeResult } from "./core/types";

// Configure Monaco to load workers from node_modules (required for Vite).
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

// Placeholder three-pane shell. Editors (Monaco + monaco-graphql), the query
// plan visualizer, and live recomposition are wired up across milestones 1-3.
// For now it exercises the store and the (stubbed) core end-to-end.

export default function App() {
  const { subgraphs, activeSubgraph, setActiveSubgraph, setSubgraphSdl, query } = useWorkspace();
  const [compose, setCompose] = useState<ComposeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCore().then((core) => {
      if (!cancelled) setCompose(core.compose(subgraphs));
    });
    return () => {
      cancelled = true;
    };
  }, [subgraphs]);

  return (
    <main
      style={{ display: "grid", gridTemplateRows: "1fr 1fr", height: "100vh", gap: 8, padding: 8 }}
    >
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <h2>Subgraphs</h2>
          <nav style={{ display: "flex", gap: 4 }}>
            {subgraphs.map((sg, i) => (
              <button
                key={sg.name}
                onClick={() => setActiveSubgraph(i)}
                aria-pressed={i === activeSubgraph}
              >
                {sg.name}
              </button>
            ))}
          </nav>
          <Editor
            path={`sg-${activeSubgraph}`}
            value={subgraphs[activeSubgraph]?.sdl ?? ""}
            language="plaintext"
            height="70%"
            onChange={(value) => setSubgraphSdl(activeSubgraph, value ?? "")}
          />
        </div>
        <div>
          <h2>Supergraph</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {compose === null
              ? "Loading core…"
              : compose.ok
                ? compose.supergraph_sdl
                : compose.errors.map((e) => `${e.code}: ${e.message}`).join("\n")}
          </pre>
        </div>
      </section>
      <section>
        <h2>Query</h2>
        <pre style={{ fontFamily: "monospace" }}>{query}</pre>
      </section>
    </main>
  );
}
