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
import { decode, encode } from "./share";
import type { WorkspacePayload } from "./share";
import type { ComposeResult, Diagnostic, MockResult, PlanResult } from "./core/types";
import { PlanTree } from "./PlanTree";

// Singleton monaco-graphql API — initialized once on first successful compose.
let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;

const COMPOSE_DEBOUNCE_MS = 300;

const isBoxDrawingLine = (line: string) => /[─-╿]/.test(line);

function ErrorMessage({ text }: { text: string }) {
  return (
    <pre style={{ fontFamily: "monospace", fontSize: 13, margin: 0 }}>
      {text.split("\n").map((line, i) => (
        <span
          key={i}
          style={{
            display: "block",
            whiteSpace: isBoxDrawingLine(line) ? "pre" : "pre-wrap",
            overflowX: isBoxDrawingLine(line) ? "auto" : "visible",
          }}
        >
          {line}
        </span>
      ))}
    </pre>
  );
}

// Configure Monaco to load workers from node_modules (required for Vite).
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "graphql") return new GraphQLWorker();
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};
loader.config({ monaco: _monaco });
// Expose Monaco for Playwright e2e tests (dev server only).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__monaco = _monaco;
}

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
    queryTabs,
    activeQueryTab,
    setActiveQueryTab,
    addQueryTab,
    removeQueryTab,
    renameQueryTab,
    setQueryTabQuery,
    setQueryTabVariables,
    supergraphSdl,
    seed,
    setSeed,
    resetToDefaults,
    renameSubgraph,
  } = useWorkspace();
  const currentQuery = queryTabs[activeQueryTab]?.query ?? "";
  const currentVariables = queryTabs[activeQueryTab]?.variables ?? "{}";
  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingQueryTab, setRenamingQueryTab] = useState<number | null>(null);
  const [renameQueryValue, setRenameQueryValue] = useState("");
  const [mockResult, setMockResult] = useState<MockResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [rightTab, setRightTab] = useState<"sdl" | "plan">("sdl");
  const [varError, setVarError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [supergraphCollapsed, setSupergraphCollapsed] = useState(true);
  const editorRef = useState<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useState<typeof _monaco | null>(null);
  const [editor, setEditor] = editorRef;
  const [monacoInstance, setMonacoInstance] = monacoRef;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hashUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore workspace from URL hash on mount (once only).
  useEffect(() => {
    const hash = location.hash;
    if (!hash.startsWith("#w=")) return;
    try {
      const payload = decode(hash);
      useWorkspace.setState({
        subgraphs: payload.subgraphs,
        queryTabs: payload.queryTabs,
        activeQueryTab: payload.activeQueryTab ?? 0,
        seed: payload.seed,
        activeSubgraph: 0,
      });
    } catch (err) {
      console.warn("Failed to restore workspace from URL hash:", err);
    }
  }, []);

  // Debounced workspace → location.hash update.
  useEffect(() => {
    if (hashUpdateRef.current) clearTimeout(hashUpdateRef.current);
    hashUpdateRef.current = setTimeout(() => {
      const state = useWorkspace.getState();
      const payload: WorkspacePayload = {
        subgraphs: state.subgraphs,
        queryTabs: state.queryTabs,
        activeQueryTab: state.activeQueryTab,
        seed: state.seed,
      };
      location.hash = encode(payload);
    }, COMPOSE_DEBOUNCE_MS);
    return () => {
      if (hashUpdateRef.current) clearTimeout(hashUpdateRef.current);
    };
  }, [subgraphs, queryTabs, activeQueryTab, seed]);

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

  function copyForLLM() {
    const parts: string[] = [];

    parts.push("## Subgraphs");
    for (const sg of subgraphs) {
      parts.push(`\n### Subgraph: ${sg.name}\n\`\`\`graphql\n${sg.sdl}\n\`\`\``);
    }

    if (compose !== null && !compose.ok && compose.errors.length > 0) {
      parts.push("\n## Composition Errors");
      for (const e of compose.errors) {
        parts.push(`- ${e.code}: ${e.message}`);
      }
    }

    parts.push(`\n## Query\n\`\`\`graphql\n${currentQuery}\n\`\`\``);

    const trimmedVars = currentVariables.trim();
    if (trimmedVars && trimmedVars !== "{}") {
      parts.push(`\n## Variables\n\`\`\`json\n${trimmedVars}\n\`\`\``);
    }

    if (mockResult !== null) {
      parts.push(
        `\n## Query Results\n\`\`\`json\n${JSON.stringify(mockResult.data, null, 2)}\n\`\`\``,
      );
      if ((mockResult.errors?.length ?? 0) > 0) {
        parts.push("\n## Query Errors");
        for (const e of mockResult.errors!) {
          parts.push(`- ${e.message}`);
        }
      }
    }

    const text = parts.join("\n");
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <main
      style={{ display: "grid", gridTemplateRows: "1fr 1fr", height: "100vh", gap: 8, padding: 8 }}
    >
      {/* Top row: subgraph editor + supergraph schema */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <h2 style={{ margin: 0 }}>Subgraphs</h2>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                onClick={copyForLLM}
                style={{
                  padding: "2px 8px",
                  fontSize: 12,
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: "transparent",
                  color: copied ? "#16a34a" : "#6b7280",
                  borderColor: copied ? "#86efac" : "#d1d5db",
                }}
              >
                {copied ? "Copied!" : "Copy for LLM"}
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm("Reset all subgraphs, query, variables, and seed to defaults?")
                  ) {
                    resetToDefaults();
                  }
                }}
                style={{
                  padding: "2px 8px",
                  fontSize: 12,
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: "transparent",
                  color: "#6b7280",
                }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
          <nav style={{ display: "flex", gap: 4, flexShrink: 0, margin: "4px 0" }}>
            {subgraphs.map((sg, i) => (
              <button
                key={i}
                onClick={() => setActiveSubgraph(i)}
                aria-pressed={i === activeSubgraph}
                style={{
                  backgroundColor: i === activeSubgraph ? "#e5e7eb" : "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {renamingIndex === i ? (
                  <input
                    value={renameValue}
                    autoFocus
                    size={Math.max(renameValue.length, 3)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => {
                      const trimmed = renameValue.trim();
                      if (trimmed) renameSubgraph(i, trimmed);
                      setRenamingIndex(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = renameValue.trim();
                        if (trimmed) renameSubgraph(i, trimmed);
                        setRenamingIndex(null);
                      } else if (e.key === "Escape") {
                        setRenamingIndex(null);
                      }
                      e.stopPropagation();
                    }}
                    style={{
                      fontSize: 13,
                      border: "none",
                      outline: "1px solid #2563eb",
                      borderRadius: 2,
                      padding: "0 2px",
                      background: "white",
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingIndex(i);
                      setRenameValue(sg.name);
                    }}
                    title="Double-click to rename"
                  >
                    {sg.name}
                  </span>
                )}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSubgraph(i);
                  }}
                  style={{
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
          <div data-testid="subgraph-editor" style={{ flex: 1, minHeight: 0 }}>
            <Editor
              path={`sg-${activeSubgraph}`}
              value={subgraphs[activeSubgraph]?.sdl ?? ""}
              language="plaintext"
              height="100%"
              onChange={(value) => setSubgraphSdl(activeSubgraph, value ?? "")}
              onMount={(ed, m) => {
                setEditor(ed);
                setMonacoInstance(m);
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <nav style={{ display: "flex", gap: 4, flexShrink: 0, margin: "0 0 4px" }}>
            <button
              onClick={() => setRightTab("sdl")}
              aria-pressed={rightTab === "sdl"}
              style={{
                backgroundColor: rightTab === "sdl" ? "#e5e7eb" : "transparent",
                border: "1px solid #d1d5db",
                borderRadius: 4,
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Supergraph SDL
            </button>
            <button
              onClick={() => setRightTab("plan")}
              aria-pressed={rightTab === "plan"}
              style={{
                backgroundColor: rightTab === "plan" ? "#e5e7eb" : "transparent",
                border: "1px solid #d1d5db",
                borderRadius: 4,
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Query Plan
            </button>
          </nav>

          {rightTab === "sdl" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setSupergraphCollapsed((c) => !c)}
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    border: "1px solid #d1d5db",
                    borderRadius: 4,
                    cursor: "pointer",
                    background: "transparent",
                    color: "#6b7280",
                  }}
                  aria-expanded={!supergraphCollapsed}
                >
                  {supergraphCollapsed ? "▶ Show" : "▼ Hide"}
                </button>
              </div>
              {!supergraphCollapsed && (
                <div style={{ flex: 1, overflow: "auto", marginTop: 4 }}>
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
                          <ErrorMessage key={i} text={`${e.code}: ${e.message}`} />
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
              )}
              {supergraphCollapsed && compose !== null && !compose.ok && (
                <div
                  style={{
                    backgroundColor: "#fee2e2",
                    borderLeft: "3px solid #dc2626",
                    padding: "4px 8px",
                    borderRadius: 4,
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                >
                  {compose.errors.map((e, i) => (
                    <ErrorMessage key={i} text={`${e.code}: ${e.message}`} />
                  ))}
                </div>
              )}
            </>
          )}

          {rightTab === "plan" && (
            <div style={{ flex: 1, overflow: "auto" }}>
              {planResult === null ? (
                <p style={{ fontSize: 13, color: "#6b7280" }}>Run a query to see the plan.</p>
              ) : planResult.ok ? (
                <PlanTree node={planResult.query_plan} />
              ) : (
                <div
                  style={{
                    backgroundColor: "#fee2e2",
                    borderLeft: "3px solid #dc2626",
                    padding: 8,
                    borderRadius: 4,
                  }}
                >
                  {planResult.errors.map((e, i) => (
                    <ErrorMessage key={i} text={e.message} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Bottom row: query editor + variables + results */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <h2 style={{ margin: "0 0 4px", flexShrink: 0 }}>Query</h2>
          <nav style={{ display: "flex", gap: 4, flexShrink: 0, margin: "4px 0" }}>
            {queryTabs.map((tab, i) => (
              <button
                key={i}
                onClick={() => setActiveQueryTab(i)}
                aria-pressed={i === activeQueryTab}
                style={{
                  backgroundColor: i === activeQueryTab ? "#e5e7eb" : "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {renamingQueryTab === i ? (
                  <input
                    value={renameQueryValue}
                    autoFocus
                    size={Math.max(renameQueryValue.length, 3)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameQueryValue(e.target.value)}
                    onBlur={() => {
                      const trimmed = renameQueryValue.trim();
                      if (trimmed) renameQueryTab(i, trimmed);
                      setRenamingQueryTab(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = renameQueryValue.trim();
                        if (trimmed) renameQueryTab(i, trimmed);
                        setRenamingQueryTab(null);
                      } else if (e.key === "Escape") {
                        setRenamingQueryTab(null);
                      }
                      e.stopPropagation();
                    }}
                    style={{
                      fontSize: 13,
                      border: "none",
                      outline: "1px solid #2563eb",
                      borderRadius: 2,
                      padding: "0 2px",
                      background: "white",
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingQueryTab(i);
                      setRenameQueryValue(tab.name);
                    }}
                    title="Double-click to rename"
                  >
                    {tab.name}
                  </span>
                )}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    removeQueryTab(i);
                  }}
                  style={{
                    cursor: "pointer",
                    color: i === activeQueryTab ? "#1f2937" : "#6b7280",
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            <button onClick={() => addQueryTab()}>+</button>
          </nav>
          <div data-testid="query-editor" style={{ flex: 1, minHeight: 0 }}>
            <Editor
              language="graphql"
              path={`query-${activeQueryTab}.graphql`}
              value={currentQuery}
              onChange={(v) => setQueryTabQuery(activeQueryTab, v ?? "")}
              height="100%"
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <h2 style={{ margin: 0, flexShrink: 0 }}>Variables</h2>
          <label
            htmlFor="variables-textarea"
            style={{ fontSize: 12, color: "#6b7280", flexShrink: 0 }}
          >
            Variables (JSON)
          </label>
          <textarea
            id="variables-textarea"
            aria-label="variables"
            value={currentVariables}
            onChange={(e) => setQueryTabVariables(activeQueryTab, e.target.value)}
            style={{
              flex: 1,
              fontFamily: "monospace",
              fontSize: 13,
              padding: 8,
              border: "1px solid #d1d5db",
              borderRadius: 4,
              resize: "none",
              minHeight: 0,
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
                flexShrink: 0,
              }}
            >
              {varError}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
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
                  parsedVariables = JSON.parse(currentVariables) as Record<string, unknown>;
                } catch {
                  setVarError("Invalid variables JSON");
                  return;
                }
                setVarError(null);
                if (supergraphSdl === null) return;
                void (async () => {
                  const core = await loadCore();
                  const [execResult, plan] = await Promise.all([
                    Promise.resolve(
                      core.executeMock(supergraphSdl, currentQuery, parsedVariables, seed),
                    ),
                    Promise.resolve(core.plan(supergraphSdl, currentQuery)),
                  ]);
                  setMockResult(execResult);
                  setPlanResult(plan);
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
            <p style={{ fontSize: 12, color: "#6b7280", margin: 0, flexShrink: 0 }}>
              Run is disabled until composition succeeds.
            </p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <h2 style={{ margin: "0 0 4px", flexShrink: 0 }}>Results</h2>
          {mockResult === null ? (
            <p style={{ fontSize: 13, color: "#6b7280" }}>No results yet. Click Run.</p>
          ) : (
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  backgroundColor: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 4,
                  padding: 8,
                  fontSize: 13,
                  margin: 0,
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
                    <ErrorMessage key={i} text={e.message} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
