import { useEffect, useRef, useState } from "react";
import { loader } from "@monaco-editor/react";
import * as _monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import GraphQLWorker from "monaco-graphql/esm/graphql.worker?worker";
import { initializeMode } from "monaco-graphql/initializeMode";
import type { MonacoGraphQLAPI } from "monaco-graphql";
import Editor from "@monaco-editor/react";
import { useWorkspace } from "./store";
import { loadCore } from "./core";
import type { ComposeResult, Diagnostic, MockResult } from "./core/types";

// Singleton monaco-graphql API — initialized once on first successful compose.
let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;

const COMPOSE_DEBOUNCE_MS = 300;

// Configure Monaco to load workers from node_modules (required for Vite).
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "graphql") return new GraphQLWorker();
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
  const {
    subgraphs,
    activeSubgraph,
    setActiveSubgraph,
    setSubgraphSdl,
    addSubgraph,
    removeSubgraph,
    query,
    setQuery,
    supergraphSdl,
    variables,
    setVariables,
    seed,
    setSeed,
  } = useWorkspace();
  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const [mockResult, setMockResult] = useState<MockResult | null>(null);
  const [varError, setVarError] = useState<string | null>(null);
  const editorRef = useState<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useState<typeof _monaco | null>(null);
  const [editor, setEditor] = editorRef;
  const [monacoInstance, setMonacoInstance] = monacoRef;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus the editor whenever the active subgraph changes (e.g. after adding).
  useEffect(() => {
    if (editor) {
      editor.focus();
    }
  }, [editor, activeSubgraph]);
  const composeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced composition effect.
  useEffect(() => {
    if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
    composeTimeoutRef.current = setTimeout(async () => {
      const core = await loadCore();
      const result = core.compose(subgraphs);
      if (result.ok) {
        useWorkspace.getState().setComposeResult(result.supergraph_sdl, null, result.hints.length);
        if (!monacoGraphQLAPI) {
          monacoGraphQLAPI = initializeMode();
        }
        monacoGraphQLAPI.setSchemaConfig([
          {
            documentString: result.api_schema_sdl,
            uri: "api-schema.graphql",
            fileMatch: ["**/*.graphql"],
          },
        ]);
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
                style={{
                  backgroundColor: i === activeSubgraph ? "#e5e7eb" : "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {sg.name}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSubgraph(i);
                  }}
                  style={{
                    marginLeft: 6,
                    cursor: "pointer",
                    color: i === activeSubgraph ? "#1f2937" : "#6b7280",
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            <button
              onClick={() => {
                let n = 1;
                while (subgraphs.some((s) => s.name === `subgraph-${n}`)) n++;
                addSubgraph(`subgraph-${n}`);
              }}
            >
              +
            </button>
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
                {compose.errors.map((e, i) => (
                  <div key={i} style={{ fontFamily: "monospace", fontSize: 13 }}>
                    {`${e.code}: ${e.message}`}
                  </div>
                ))}
              </div>
              {supergraphSdl !== null ? (
                <>
                  <span
                    style={{
                      backgroundColor: "#fef3c7",
                      color: "#92400e",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: "1px solid #fcd34d",
                      marginBottom: 4,
                    }}
                  >
                    stale
                  </span>
                  <pre style={{ whiteSpace: "pre-wrap", opacity: 0.5, color: "#6b7280" }}>
                    {supergraphSdl}
                  </pre>
                </>
              ) : (
                <pre style={{ whiteSpace: "pre-wrap" }}>No valid composition yet</pre>
              )}
            </>
          )}
        </div>
      </section>
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <h2>Query</h2>
          <div style={{ flex: 1 }}>
            <Editor
              language="graphql"
              path="query.graphql"
              value={query}
              onChange={(v) => setQuery(v ?? "")}
              height="300px"
            />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2>Variables</h2>
          <label htmlFor="variables-textarea" style={{ fontSize: 12, color: "#6b7280" }}>
            Variables (JSON)
          </label>
          <textarea
            id="variables-textarea"
            aria-label="variables"
            value={variables}
            onChange={(e) => setVariables(e.target.value)}
            style={{
              flex: 1,
              fontFamily: "monospace",
              fontSize: 13,
              padding: 8,
              border: "1px solid #d1d5db",
              borderRadius: 4,
              resize: "none",
              minHeight: 120,
            }}
          />
          {varError !== null && (
            <div
              role="alert"
              style={{
                backgroundColor: "#fee2e2",
                borderLeft: "3px solid #dc2626",
                color: "#991b1b",
                padding: "6px 10px",
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              {varError}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label htmlFor="seed-input" style={{ fontSize: 13 }}>
              Seed:
            </label>
            <input
              id="seed-input"
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              style={{
                width: 80,
                padding: "4px 6px",
                border: "1px solid #d1d5db",
                borderRadius: 4,
                fontSize: 13,
              }}
            />
            <button
              onClick={() => {
                let parsedVariables: Record<string, unknown>;
                try {
                  parsedVariables = JSON.parse(variables) as Record<string, unknown>;
                } catch {
                  setVarError("Invalid variables JSON");
                  return;
                }
                setVarError(null);
                if (supergraphSdl === null) return;
                void (async () => {
                  const core = await loadCore();
                  const result = core.executeMock(supergraphSdl, query, parsedVariables, seed);
                  setMockResult(result);
                })();
              }}
              disabled={supergraphSdl === null}
              style={{
                padding: "4px 12px",
                backgroundColor: supergraphSdl === null ? "#d1d5db" : "#2563eb",
                color: supergraphSdl === null ? "#6b7280" : "white",
                border: "none",
                borderRadius: 4,
                cursor: supergraphSdl === null ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              Run
            </button>
          </div>
          {supergraphSdl === null && (
            <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>
              Run is disabled until composition succeeds.
            </p>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>Results</h2>
          {mockResult === null ? (
            <p style={{ fontSize: 13, color: "#6b7280" }}>No results yet. Click Run.</p>
          ) : (
            <>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  backgroundColor: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 4,
                  padding: 8,
                  fontSize: 13,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(mockResult.data, null, 2)}
              </pre>
              {(mockResult.errors?.length ?? 0) > 0 && (
                <div
                  style={{
                    backgroundColor: "#fee2e2",
                    borderLeft: "3px solid #dc2626",
                    padding: 8,
                    borderRadius: 4,
                    marginTop: 8,
                  }}
                >
                  {mockResult.errors!.map((e, i) => (
                    <div key={i} style={{ fontFamily: "monospace", fontSize: 13 }}>
                      {e.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
