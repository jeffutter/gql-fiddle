import { useEffect, useRef, useState } from "react";
import { loader } from "@monaco-editor/react";
import * as _monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import Editor from "@monaco-editor/react";
import { useWorkspace } from "./store";
import { loadCore } from "./core";
import type { ComposeResult, Diagnostic } from "./core/types";

const COMPOSE_DEBOUNCE_MS = 300;

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
  const { subgraphs, activeSubgraph, setActiveSubgraph, setSubgraphSdl, query, supergraphSdl } =
    useWorkspace();
  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const editorRef = useState<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useState<typeof _monaco | null>(null);
  const [editor, setEditor] = editorRef;
  const [monacoInstance, setMonacoInstance] = monacoRef;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced composition effect.
  useEffect(() => {
    if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
    composeTimeoutRef.current = setTimeout(async () => {
      const core = await loadCore();
      const result = core.compose(subgraphs);
      if (result.ok) {
        useWorkspace.getState().setComposeResult(result.supergraph_sdl, null, result.hints.length);
      } else {
        useWorkspace.getState().setComposeResult(null, result.errors, 0);
      }
      setCompose(result);
    }, COMPOSE_DEBOUNCE_MS);
    return () => {
      if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
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
          {compose === null ? (
            <pre style={{ whiteSpace: "pre-wrap" }}>Loading core…</pre>
          ) : compose.ok ? (
            <>
              <pre style={{ whiteSpace: "pre-wrap" }}>{compose.supergraph_sdl}</pre>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>
                Composition:{" "}
                {compose.hints.length === 0
                  ? "0 errors"
                  : `0 errors, ${compose.hints.length} hints`}
              </p>
            </>
          ) : (
            <>
              <div
                style={{
                  backgroundColor: "#fee2e2",
                  borderLeft: "3px solid #dc2626",
                  padding: 8,
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              >
                {compose.errors.map((e) => (
                  <div key={e.code} style={{ fontFamily: "monospace", fontSize: 13 }}>
                    {`${e.code}: ${e.message}`}
                  </div>
                ))}
              </div>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {supergraphSdl ?? "No valid composition yet"}
              </pre>
            </>
          )}
        </div>
      </section>
      <section>
        <h2>Query</h2>
        <pre style={{ fontFamily: "monospace" }}>{query}</pre>
      </section>
    </main>
  );
}
