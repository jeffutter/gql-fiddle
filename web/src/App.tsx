import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
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
import { SequenceDiagram } from "./SequenceDiagram";
import { MONACO_THEME, defineMonacoTheme } from "./monacoTheme";

// Singleton monaco-graphql API — initialized once on first successful compose.
let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;

const COMPOSE_DEBOUNCE_MS = 300;
const AUTO_RUN_DEBOUNCE_MS = 400;

// Shared Monaco options for a clean, minimal editor: no minimap clutter,
// breathing room, theme-matched mono font. Spread and extend per editor.
const EDITOR_OPTIONS: _monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  padding: { top: 10, bottom: 10 },
  fontSize: 13,
  fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  smoothScrolling: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

const isBoxDrawingLine = (line: string) => /[─-╿]/.test(line);

function ErrorMessage({ text }: { text: string }) {
  return (
    <pre className="error-pre">
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

function useMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
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
    supergraphSdl,
    seed,
    setSeed,
    resetToDefaults,
    renameSubgraph,
  } = useWorkspace();
  const currentQuery = queryTabs[activeQueryTab]?.query ?? "";
  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingQueryTab, setRenamingQueryTab] = useState<number | null>(null);
  const [renameQueryValue, setRenameQueryValue] = useState("");
  const [mockResult, setMockResult] = useState<MockResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [rightTab, setRightTab] = useState<"sdl" | "plan" | "sequence" | "results">("plan");
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const editorRef = useState<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useState<typeof _monaco | null>(null);
  const [editor, setEditor] = editorRef;
  const [monacoInstance, setMonacoInstance] = monacoRef;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobile = useMobile();
  const [mobileTab, setMobileTab] = useState<"schema" | "query" | "output">("schema");
  const [viewSource, setViewSource] = useState<{
    title: string;
    value: string;
    onEdit: (v: string) => void;
  } | null>(null);

  // Reset 'results' rightTab when returning to desktop (no Results tab there).
  useEffect(() => {
    if (!isMobile && rightTab === "results") setRightTab("plan");
  }, [isMobile, rightTab]);

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
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (err) {
      console.warn("Failed to restore workspace from URL hash:", err);
    }
  }, []);

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
        monacoGraphQLAPI.setModeConfiguration({
          completionItems: true,
          diagnostics: true,
          hovers: true,
          documentSymbols: true,
          documentFormattingEdits: true,
        });
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

  // Auto-run effect: re-executes the query whenever inputs change.
  useEffect(() => {
    if (supergraphSdl === null) return;
    setIsRunning(true);
    if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    const sdl = supergraphSdl;
    autoRunTimeoutRef.current = setTimeout(() => {
      void doRun(currentQuery, sdl, seed);
    }, AUTO_RUN_DEBOUNCE_MS);
    return () => {
      if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    };
  }, [currentQuery, supergraphSdl, seed]);

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

  function copyShareUrl() {
    const payload: WorkspacePayload = {
      subgraphs,
      queryTabs,
      activeQueryTab,
      seed,
    };
    const encodedHash = encode(payload);
    // Build origin — handle JSDOM where location.origin/hostname may be undefined.
    const loc = window.location;
    const hostname =
      typeof loc.hostname === "string" && loc.hostname.length > 0 ? loc.hostname : "localhost";
    const port = typeof loc.port === "string" && loc.port.length > 0 ? loc.port : "";
    const origin = loc.origin || `http://${hostname}${port ? `:${port}` : ""}`;
    const shareUrl = origin + window.location.pathname + encodedHash;

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(shareUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = shareUrl;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  async function doRun(query: string, sdl: string, s: number) {
    const core = await loadCore();
    const [execResult, plan] = await Promise.all([
      Promise.resolve(core.executeMock(sdl, query, s)),
      Promise.resolve(core.plan(sdl, query)),
    ]);
    setMockResult(execResult);
    setPlanResult(plan);
    setIsRunning(false);
  }

  function runQuery() {
    if (supergraphSdl === null) return;
    if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    setIsRunning(true);
    void doRun(currentQuery, supergraphSdl, seed);
  }

  // Shared JSX fragments used by both layouts.
  const subgraphTabStrip = (
    <nav className="tab-strip">
      {subgraphs.map((sg, i) => (
        <button
          key={i}
          onClick={() => setActiveSubgraph(i)}
          aria-pressed={i === activeSubgraph}
          className={i === activeSubgraph ? "tab is-active" : "tab"}
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
              className="tab__rename"
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
            className="tab__close"
          >
            ×
          </span>
        </button>
      ))}
      <button
        data-testid="subgraph-add-btn"
        className="btn btn--icon"
        onClick={() => {
          let n = 1;
          while (subgraphs.some((s) => s.name === `subgraph-${n}`)) n++;
          addSubgraph(`subgraph-${n}`);
        }}
      >
        +
      </button>
    </nav>
  );

  const subgraphEditor = (
    <div data-testid="subgraph-editor" className="editor">
      <Editor
        path={`sg-${activeSubgraph}`}
        value={subgraphs[activeSubgraph]?.sdl ?? ""}
        language="graphql"
        height="100%"
        theme={MONACO_THEME}
        beforeMount={(m) => defineMonacoTheme(m)}
        options={EDITOR_OPTIONS}
        onChange={(value) => setSubgraphSdl(activeSubgraph, value ?? "")}
        onMount={(ed, m) => {
          setEditor(ed);
          setMonacoInstance(m);
        }}
      />
    </div>
  );

  const queryTabStrip = (
    <nav className="tab-strip">
      {queryTabs.map((tab, i) => (
        <button
          key={i}
          onClick={() => setActiveQueryTab(i)}
          aria-pressed={i === activeQueryTab}
          className={i === activeQueryTab ? "tab is-active" : "tab"}
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
              className="tab__rename"
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
            className="tab__close"
          >
            ×
          </span>
        </button>
      ))}
      <button className="btn btn--icon" onClick={() => addQueryTab()}>
        +
      </button>
    </nav>
  );

  const sdlContent = (
    <div className="scroll">
      {compose === null ? (
        <pre className="code-block">Loading core…</pre>
      ) : compose.ok ? (
        <>
          <pre className="code-block">{compose.supergraph_sdl}</pre>
          <p className="hint">
            Composition:{" "}
            {compose.hints.length === 0 ? "0 errors" : `0 errors, ${compose.hints.length} hints`}
          </p>
        </>
      ) : null}
    </div>
  );

  const compositionErrorContent =
    compose !== null && !compose.ok ? (
      <div className="scroll">
        <div className="callout callout--error composition-error-pane">
          <strong className="composition-error-pane__title">Composition failed</strong>
          {compose.errors.map((e, i) => (
            <ErrorMessage key={i} text={`${e.code}: ${e.message}`} />
          ))}
        </div>
        {supergraphSdl !== null ? (
          <>
            <span
              className="badge badge--warning"
              style={{ marginTop: 8, marginBottom: 4, display: "inline-block" }}
            >
              stale
            </span>
            <pre className="code-block code-block--stale">{supergraphSdl}</pre>
          </>
        ) : (
          <pre className="code-block">No valid composition yet</pre>
        )}
      </div>
    ) : null;

  const planContent = (
    <div className="scroll">
      {planResult === null ? (
        <p className="empty-state">Run a query to see the plan.</p>
      ) : planResult.ok ? (
        <PlanTree node={planResult.query_plan} />
      ) : (
        <div className="callout callout--error">
          {planResult.errors.map((e, i) => (
            <ErrorMessage key={i} text={e.message} />
          ))}
        </div>
      )}
    </div>
  );

  const sequenceContent = (
    <div className="scroll">
      {planResult === null ? (
        <p className="empty-state">Run a query to see the sequence diagram.</p>
      ) : planResult.ok ? (
        <SequenceDiagram node={planResult.query_plan} />
      ) : (
        <div className="callout callout--error">
          {planResult.errors.map((e, i) => (
            <ErrorMessage key={i} text={e.message} />
          ))}
        </div>
      )}
    </div>
  );

  const resultsContent = (
    <div className="scroll">
      {mockResult === null ? (
        <p className="empty-state">No results yet. Click Run.</p>
      ) : (
        <>
          <pre className="code-block">{JSON.stringify(mockResult.data, null, 2)}</pre>
          {(mockResult.errors?.length ?? 0) > 0 && (
            <div className="callout callout--error" style={{ marginTop: 8 }}>
              {mockResult.errors!.map((e, i) => (
                <ErrorMessage key={i} text={e.message} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  const seedAndRun = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
      <button onClick={runQuery} disabled={supergraphSdl === null} className="btn btn--primary">
        Run
      </button>
      {isRunning && <span className="spinner" aria-label="Computing" />}
      <label htmlFor="seed-input" className="field-label">
        Seed:
      </label>
      <input
        id="seed-input"
        type="number"
        value={seed}
        onChange={(e) => setSeed(Number(e.target.value))}
        className="input input--seed"
      />
    </div>
  );

  const globalHeader = (
    <header className="page-header">
      <div className="logo" aria-label="GraphQL Fiddle">
        <svg
          className="logo__mark"
          width="28"
          height="28"
          viewBox="0 0 30 30"
          fill="none"
          aria-hidden="true"
        >
          <polygon
            points="15,3 25.4,21 4.6,21"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <polygon
            points="25.4,9 15,27 4.6,9"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="15" cy="3" r="1.8" fill="var(--accent)" />
          <circle cx="25.4" cy="9" r="1.8" fill="var(--accent)" />
          <circle cx="25.4" cy="21" r="1.8" fill="var(--accent)" />
          <circle cx="15" cy="27" r="1.8" fill="var(--accent)" />
          <circle cx="4.6" cy="21" r="1.8" fill="var(--accent)" />
          <circle cx="4.6" cy="9" r="1.8" fill="var(--accent)" />
        </svg>
        <div className="logo__text">
          <span className="logo__gql">GraphQL</span>
          <span className="logo__name">Fiddle</span>
        </div>
      </div>
      <button onClick={copyForLLM} className={copied ? "btn is-success" : "btn"}>
        {copied ? "Copied!" : "Copy for LLM"}
      </button>
      <button onClick={copyShareUrl} className={copied ? "btn is-success" : "btn"}>
        {copied ? "Copied!" : "Share"}
      </button>
      <button
        onClick={() => {
          if (window.confirm("Reset all subgraphs, query, variables, and seed to defaults?")) {
            resetToDefaults();
          }
        }}
        className="btn"
      >
        Reset to defaults
      </button>
    </header>
  );

  if (isMobile) {
    return (
      <>
        <div className="app" style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
          <div style={{ padding: "8px 8px 0" }}>{globalHeader}</div>
          {/* Content area */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              padding: 8,
              boxSizing: "border-box",
            }}
          >
            {mobileTab === "schema" && (
              <div
                style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
              >
                <h2 className="section-title">Subgraphs</h2>
                {subgraphTabStrip}
                <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
                  <button
                    onClick={() =>
                      setViewSource({
                        title: `${subgraphs[activeSubgraph]?.name ?? "Subgraph"} SDL`,
                        value: subgraphs[activeSubgraph]?.sdl ?? "",
                        onEdit: (v) => setSubgraphSdl(activeSubgraph, v),
                      })
                    }
                    className="btn"
                  >
                    Select text
                  </button>
                </div>
                {subgraphEditor}
              </div>
            )}

            {mobileTab === "query" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  minHeight: 0,
                  gap: 4,
                }}
              >
                <h2 className="section-title" style={{ flexShrink: 0 }}>
                  Query
                </h2>
                {queryTabStrip}
                <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
                  <button
                    onClick={() =>
                      setViewSource({
                        title: "Query",
                        value: currentQuery,
                        onEdit: (v) => setQueryTabQuery(activeQueryTab, v),
                      })
                    }
                    className="btn"
                  >
                    Select text
                  </button>
                </div>
                <div
                  data-testid="query-editor"
                  className="editor"
                  style={{ flex: 1, minHeight: 0 }}
                >
                  <Editor
                    language="graphql"
                    path={`query-${activeQueryTab}.graphql`}
                    value={currentQuery}
                    onChange={(v) => setQueryTabQuery(activeQueryTab, v ?? "")}
                    height="100%"
                    options={EDITOR_OPTIONS}
                    theme={MONACO_THEME}
                    beforeMount={(m) => defineMonacoTheme(m)}
                  />
                </div>
                {seedAndRun}
                {supergraphSdl === null && (
                  <p className="hint" style={{ flexShrink: 0 }}>
                    Run is disabled until composition succeeds.
                  </p>
                )}
              </div>
            )}

            {mobileTab === "output" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <nav className="tab-strip">
                  <button
                    onClick={() => setRightTab("results")}
                    aria-pressed={rightTab === "results"}
                    className={rightTab === "results" ? "tab is-active" : "tab"}
                  >
                    Results
                  </button>
                  <button
                    onClick={() => setRightTab("plan")}
                    aria-pressed={rightTab === "plan"}
                    className={rightTab === "plan" ? "tab is-active" : "tab"}
                  >
                    Query Plan
                  </button>
                  <button
                    onClick={() => setRightTab("sequence")}
                    aria-pressed={rightTab === "sequence"}
                    className={rightTab === "sequence" ? "tab is-active" : "tab"}
                  >
                    Sequence Diagram
                  </button>
                  <button
                    onClick={() => setRightTab("sdl")}
                    aria-pressed={rightTab === "sdl"}
                    className={rightTab === "sdl" ? "tab is-active" : "tab"}
                  >
                    Supergraph SDL
                  </button>
                </nav>
                {compositionErrorContent ?? (
                  <>
                    {rightTab === "results" && resultsContent}
                    {rightTab === "sdl" && sdlContent}
                    {rightTab === "plan" && planContent}
                    {rightTab === "sequence" && sequenceContent}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Mobile tab bar */}
          <nav className="mobile-tabbar">
            {(["schema", "query", "output"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                aria-pressed={mobileTab === tab}
                className={mobileTab === tab ? "mobile-tab is-active" : "mobile-tab"}
              >
                {tab === "schema" ? "Schema" : tab === "query" ? "Query" : "Output"}
              </button>
            ))}
          </nav>
        </div>
        {viewSource !== null && (
          <div className="overlay">
            <div className="overlay__header">
              <span className="overlay__title">{viewSource.title}</span>
              <button onClick={() => setViewSource(null)} className="btn">
                Done
              </button>
            </div>
            <textarea
              value={viewSource.value}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const v = e.target.value;
                viewSource.onEdit(v);
                setViewSource({ ...viewSource, value: v });
              }}
              className="overlay__textarea"
            />
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className="app"
      style={{ height: "100vh", display: "flex", flexDirection: "column", padding: 8 }}
    >
      {globalHeader}
      <Group orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
        {/* === Top row: subgraph editor | SDL/plan === */}
        <Panel defaultSize={50} minSize={200}>
          <Group orientation="horizontal">
            <Panel defaultSize={50} minSize={200}>
              <div className="panel">
                <h2 className="section-title">Subgraphs</h2>
                {subgraphTabStrip}
                {subgraphEditor}
              </div>
            </Panel>
            <Separator className="resize-handle" />
            <Panel defaultSize={50} minSize={200}>
              <div className="panel" style={{ overflow: "hidden" }}>
                <div className="panel__header">
                  <h2 className="section-title">Output</h2>
                </div>
                <nav className="tab-strip">
                  <button
                    onClick={() => setRightTab("plan")}
                    aria-pressed={rightTab === "plan"}
                    className={rightTab === "plan" ? "tab is-active" : "tab"}
                  >
                    Query Plan
                  </button>
                  <button
                    onClick={() => setRightTab("sequence")}
                    aria-pressed={rightTab === "sequence"}
                    className={rightTab === "sequence" ? "tab is-active" : "tab"}
                  >
                    Sequence Diagram
                  </button>
                  <button
                    onClick={() => setRightTab("sdl")}
                    aria-pressed={rightTab === "sdl"}
                    className={rightTab === "sdl" ? "tab is-active" : "tab"}
                  >
                    Supergraph SDL
                  </button>
                </nav>

                {compositionErrorContent ?? (
                  <>
                    {rightTab === "sdl" && sdlContent}
                    {rightTab === "plan" && planContent}
                    {rightTab === "sequence" && sequenceContent}
                  </>
                )}
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator className="resize-handle" />

        {/* === Bottom row: query | results === */}
        <Panel defaultSize={50} minSize={200}>
          <Group orientation="horizontal">
            <Panel defaultSize={50} minSize={150}>
              <div className="panel">
                <h2 className="section-title" style={{ flexShrink: 0 }}>
                  Query
                </h2>
                {queryTabStrip}
                <div data-testid="query-editor" className="editor">
                  <Editor
                    language="graphql"
                    path={`query-${activeQueryTab}.graphql`}
                    value={currentQuery}
                    onChange={(v) => setQueryTabQuery(activeQueryTab, v ?? "")}
                    height="100%"
                    options={EDITOR_OPTIONS}
                    theme={MONACO_THEME}
                    beforeMount={(m) => defineMonacoTheme(m)}
                  />
                </div>
              </div>
            </Panel>
            <Separator className="resize-handle" />
            <Panel defaultSize={50} minSize={150}>
              <div className="panel">
                <h2 className="section-title" style={{ flexShrink: 0 }}>
                  Results
                </h2>
                {resultsContent}
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>
      <footer className="page-footer">
        <button onClick={runQuery} disabled={supergraphSdl === null} className="btn btn--primary">
          Run
        </button>
        {isRunning && <span className="spinner" aria-label="Computing" />}
        {supergraphSdl === null && (
          <span className="hint">Run is disabled until composition succeeds.</span>
        )}
        <label htmlFor="seed-input" className="field-label">
          Seed:
        </label>
        <input
          id="seed-input"
          type="number"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
          className="input input--seed"
        />
      </footer>
    </div>
  );
}
