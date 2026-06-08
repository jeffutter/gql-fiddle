import { useEffect, useRef, useState } from "react";
import { loader } from "@monaco-editor/react";
import * as _monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import Editor from "@monaco-editor/react";
import { useWorkspace } from "./store";
import { loadCore } from "./core";
import type { ComposeResult, Diagnostic } from "./core/types";

// Configure Monaco to load workers from node_modules (required for Vite).
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
loader.config({ monaco: _monaco });

// Placeholder three-pane shell. Editors (Monaco + monaco-graphql), the query
// plan visualizer, and live recomposition are wired up across milestones 1-3.
// For now it exercises the store and the (stubbed) core end-to-end.

function diagnosticToMarker(
  diagnostic: Diagnostic,
  monacoInstance: typeof _monaco,
): _monaco.editor.IMarkerData {
  return {
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.col,
    endLineNumber: diagnostic.line,
    endColumn: diagnostic.col + Math.max(diagnostic.len, 1),
    message: diagnostic.message,
    severity:
      diagnostic.severity === "error"
        ? monacoInstance.MarkerSeverity.Error
        : monacoInstance.MarkerSeverity.Warning,
  };
}

export default function App() {
  const { subgraphs, activeSubgraph, setActiveSubgraph, setSubgraphSdl, query } = useWorkspace();
  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const editorRef = useState<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useState<typeof _monaco | null>(null);
  const [editor, setEditor] = editorRef;
  const [monacoInstance, setMonacoInstance] = monacoRef;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCore().then((core) => {
      if (!cancelled) setCompose(core.compose(subgraphs));
    });
    return () => {
      cancelled = true;
    };
  }, [subgraphs]);

  // Debounced validation effect.
  useEffect(() => {
    const currentSdl = subgraphs[activeSubgraph]?.sdl ?? "";
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      void (async () => {
        const core = await loadCore();
        const result = core.validateSubgraph(currentSdl);
        if (editor && monacoInstance) {
          const model = editor.getModel();
          if (model) {
            monacoInstance.editor.setModelMarkers(
              model,
              "validation",
              result.diagnostics.map((d) => diagnosticToMarker(d, monacoInstance)),
            );
          }
        }
      })();
    }, 300);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [editor, monacoInstance, activeSubgraph, subgraphs]);

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
            onMount={(ed, m) => {
              setEditor(ed);
              setMonacoInstance(m);
            }}
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
