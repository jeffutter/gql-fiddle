import { useEffect, useMemo, useRef, useState } from "react";
import { useMobile } from "./hooks";
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
import { decode, encode, encodeTour, decodeTour, resolveTourStep } from "./share";
import type { WorkspacePayload, Tour } from "./share";
import type { ComposeResult, Diagnostic, MockResult, PlanResult } from "./core/types";
import { TourAuthoringPanel } from "./TourAuthoringPanel";
import { TourPlayback } from "./TourPlayback";
import { PlanTree } from "./PlanTree";
import { SequenceDiagram } from "./SequenceDiagram";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { MONACO_THEME, defineMonacoTheme } from "./monacoTheme";
import { planToFieldRanges, collectServiceNames } from "./planToFieldRanges";
import { hashSubgraphName, injectSubgraphStyles, subgraphColorVar } from "./subgraphColors";
import { applyTourHighlight } from "./tourHighlight";
import type { TourHighlightHandle } from "./tourHighlight";
import { schemaToEntityGraph } from "./schemaToEntityGraph";
import { EntityOwnershipGraph } from "./EntityOwnershipGraph";
import { TypeGraph } from "./TypeGraph";
import { QueryShape } from "./QueryShape";
import * as jsYaml from "js-yaml";
import { buildSchema, getNamedType, isInterfaceType, isObjectType, isUnionType } from "graphql";

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
  fixedOverflowWidgets: true,
};

// Query editor options — extends the shared base with glyph margin for
// per-subgraph colored dots in the left gutter.
const QUERY_EDITOR_OPTIONS: _monaco.editor.IStandaloneEditorConstructionOptions = {
  ...EDITOR_OPTIONS,
  glyphMargin: true,
};

// Mock-config editor options — enables quickSuggestions for string token
// contexts (YAML tokenizes key content there) so indented-level completions
// fire automatically as the user types, not only on Ctrl+Space.
const MOCK_CONFIG_EDITOR_OPTIONS: _monaco.editor.IStandaloneEditorConstructionOptions = {
  ...EDITOR_OPTIONS,
  quickSuggestions: { other: true, comments: false, strings: true },
};

const isBoxDrawingLine = (line: string) => /[─-╿]/.test(line);

function ErrorMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function copyError() {
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
    <div className="error-message">
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
      <button
        onClick={copyError}
        className={
          copied
            ? "btn btn--icon is-success error-message__copy"
            : "btn btn--icon error-message__copy"
        }
        title="Copy error"
      >
        {copied ? "✓" : "⎘"}
      </button>
    </div>
  );
}

function SubgraphLegend({ services }: { services: string[] }) {
  if (services.length === 0) return null;
  return (
    <div className="subgraph-legend" aria-label="Subgraph legend">
      {services.map((svc) => (
        <span key={svc} className="subgraph-legend__item">
          <span
            className="subgraph-legend__swatch"
            style={{ backgroundColor: subgraphColorVar(svc) }}
          />
          {svc}
        </span>
      ))}
    </div>
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
    supergraphSdl,
    seed,
    setSeed,
    resetToDefaults,
    renameSubgraph,
    tourDraft,
    setTourDraft,
    tourActiveStep,
    setStepAnchor,
    mockConfig,
    setMockConfig,
  } = useWorkspace();
  const [tourAuthoringOpen, setTourAuthoringOpen] = useState(false);
  const [playbackTour, setPlaybackTour] = useState<Tour | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const currentQuery = queryTabs[activeQueryTab]?.query ?? "";
  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingQueryTab, setRenamingQueryTab] = useState<number | null>(null);
  const [renameQueryValue, setRenameQueryValue] = useState("");
  const [mockResult, setMockResult] = useState<MockResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [showMockConfig, setShowMockConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [outputTab, setOutputTab] = useState<"type-graph" | "entities" | "sdl">("type-graph");
  const [resultsTab, setResultsTab] = useState<
    "plan" | "sequence" | "timeline" | "schema-tree" | "output"
  >("plan");
  const [fullscreenTab, setFullscreenTab] = useState<
    "plan" | "sequence" | "timeline" | "entities" | "type-graph" | "schema-tree" | null
  >(null);
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const editorRef = useState<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useState<typeof _monaco | null>(null);
  const [editor, setEditor] = editorRef;
  const [monacoInstance, setMonacoInstance] = monacoRef;
  // Query editor instance ref — used to apply field-attribution decorations.
  const queryEditorRef = useRef<_monaco.editor.IStandaloneCodeEditor | null>(null);
  // Monaco decoration collection for field-attribution highlights.
  const decorationsRef = useRef<ReturnType<
    _monaco.editor.IStandaloneCodeEditor["createDecorationsCollection"]
  > | null>(null);
  // Monaco decoration collection for the tour anchor indicator on the schema editor.
  const anchorDecorationRef = useRef<ReturnType<
    _monaco.editor.IStandaloneCodeEditor["createDecorationsCollection"]
  > | null>(null);
  // Disposable for the onMouseDown listener — needed to clean it up when authoring mode exits.
  const anchorMouseListenerRef = useRef<_monaco.IDisposable | null>(null);
  // Handle for the tour step highlight decoration — disposed before each step transition.
  const tourHighlightHandleRef = useRef<TourHighlightHandle | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Current schema field keys for mock-config YAML completions: "TypeName.fieldName".
  const mockConfigFieldKeysRef = useRef<string[]>([]);
  // Concrete type names per field key — only populated for union/interface return types.
  const mockConfigConcreteTypesRef = useRef<Record<string, string[]>>({});
  const isMobile = useMobile();
  const [mobileTab, setMobileTab] = useState<"schema" | "query" | "output" | "results" | "tour">(
    "schema",
  );
  const [viewSource, setViewSource] = useState<{
    title: string;
    value: string;
    onEdit: (v: string) => void;
  } | null>(null);

  // Close fullscreen modal on Escape key.
  useEffect(() => {
    if (fullscreenTab === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreenTab(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreenTab]);

  // Restore workspace from URL hash on mount (once only).
  // Also handles #t= tour playback hashes.
  useEffect(() => {
    const hash = location.hash;
    if (hash.startsWith("#t=")) {
      try {
        const tour = decodeTour(hash);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPlaybackTour(tour);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (err) {
        setPlaybackError(err instanceof Error ? err.message : "Failed to decode tour");
      }
      return;
    }
    if (!hash.startsWith("#w=")) return;
    try {
      const payload = decode(hash);
      useWorkspace.setState({
        subgraphs: payload.subgraphs,
        queryTabs: payload.queryTabs,
        activeQueryTab: payload.activeQueryTab ?? 0,
        seed: payload.seed,
        mockConfig: payload.mockConfig ?? "",
        activeSubgraph: 0,
      });
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (err) {
      console.warn("Failed to restore workspace from URL hash:", err);
    }
  }, []);

  // Inject CSS classes for Monaco inline decoration highlighting (once on mount).
  useEffect(() => {
    injectSubgraphStyles();
  }, []);

  // Apply field-attribution decorations to the query editor whenever the plan
  // result or query changes. Decorations are cleared when the plan is absent
  // or failed.
  useEffect(() => {
    const queryEditor = queryEditorRef.current;
    if (!queryEditor || !monacoInstance) {
      return;
    }

    // Clear previous decorations.
    decorationsRef.current?.clear();
    decorationsRef.current = null;

    if (!planResult || !planResult.ok) return;

    const ranges = planToFieldRanges(planResult.query_plan, currentQuery);
    if (ranges.length === 0) return;

    const deltaDecorations: _monaco.editor.IModelDeltaDecoration[] = ranges.map((r) => ({
      range: new monacoInstance.Range(r.line, r.col, r.line, r.col + r.len),
      options: {
        inlineClassName: `sg-bg-${hashSubgraphName(r.service)}`,
        glyphMarginClassName: `sg-glyph-${hashSubgraphName(r.service)}`,
        hoverMessage: { value: `Resolved by: **${r.service}**` },
      },
    }));

    decorationsRef.current = queryEditor.createDecorationsCollection(deltaDecorations);
  }, [planResult, monacoInstance, currentQuery]);

  // Focus the editor whenever the active subgraph changes (e.g. after adding).
  useEffect(() => {
    if (editor) {
      editor.focus();
    }
  }, [editor, activeSubgraph]);

  // Register / unregister the click-to-anchor handler on the schema editor.
  // Only active when the tour authoring panel is open and a step is selected.
  useEffect(() => {
    // Clean up any previous listener.
    anchorMouseListenerRef.current?.dispose();
    anchorMouseListenerRef.current = null;

    if (!editor || !monacoInstance || !tourDraft || !tourAuthoringOpen || tourActiveStep === null) {
      return;
    }

    const listener = editor.onMouseDown((e) => {
      // Only handle clicks on content (not the gutter or scrollbar).
      if (
        e.target.type !== monacoInstance.editor.MouseTargetType.CONTENT_TEXT &&
        e.target.type !== monacoInstance.editor.MouseTargetType.CONTENT_EMPTY
      ) {
        return;
      }
      const pos = e.target.position;
      if (!pos) return;

      const sdl = subgraphs[activeSubgraph]?.sdl ?? "";
      void (async () => {
        const core = await loadCore();
        const result = core.nodeAtPosition(sdl, pos.lineNumber, pos.column);

        if (result === null) {
          // Clicked whitespace or a directive argument — do not change the anchor.
          return;
        }

        const newAnchor = {
          subgraphIndex: activeSubgraph,
          typeName: result.typeName,
          ...(result.fieldName ? { fieldName: result.fieldName } : {}),
        };

        // If clicking the same anchor that's already set, toggle it off (clear).
        const currentAnchor = useWorkspace.getState().tourDraft?.steps[tourActiveStep]?.anchor;
        if (
          currentAnchor &&
          currentAnchor.subgraphIndex === newAnchor.subgraphIndex &&
          currentAnchor.typeName === newAnchor.typeName &&
          currentAnchor.fieldName === newAnchor.fieldName
        ) {
          setStepAnchor(tourActiveStep, undefined);
        } else {
          setStepAnchor(tourActiveStep, newAnchor);
        }
      })();
    });

    anchorMouseListenerRef.current = listener;

    return () => {
      anchorMouseListenerRef.current?.dispose();
      anchorMouseListenerRef.current = null;
    };
  }, [
    editor,
    monacoInstance,
    tourDraft,
    tourAuthoringOpen,
    tourActiveStep,
    activeSubgraph,
    subgraphs,
    setStepAnchor,
  ]);

  // Update the anchor decoration on the schema editor whenever the active step's anchor changes.
  useEffect(() => {
    anchorDecorationRef.current?.clear();
    anchorDecorationRef.current = null;

    if (!editor || !monacoInstance || tourActiveStep === null || !tourDraft) return;

    const anchor = tourDraft.steps[tourActiveStep]?.anchor;
    if (!anchor || anchor.subgraphIndex !== activeSubgraph) return;

    const model = editor.getModel();
    if (!model) return;

    const sdl = model.getValue();
    const lines = sdl.split("\n");
    let targetLine: number | null = null;

    if (anchor.fieldName) {
      // Find the field declaration inside the type block.
      let inType = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^(type|interface)\s+\w/.test(line) && line.includes(anchor.typeName)) {
          inType = true;
        } else if (inType && /^\}/.test(line)) {
          inType = false;
        } else if (inType) {
          const fieldPattern = new RegExp(`^\\s+${anchor.fieldName}\\s*[:(]`);
          if (fieldPattern.test(line)) {
            targetLine = i + 1; // Monaco lines are 1-based
            break;
          }
        }
      }
    } else {
      // Find the type or interface declaration line.
      for (let i = 0; i < lines.length; i++) {
        if (new RegExp(`^(type|interface)\\s+${anchor.typeName}[\\s{@]`).test(lines[i])) {
          targetLine = i + 1;
          break;
        }
      }
    }

    if (targetLine === null) return;

    anchorDecorationRef.current = editor.createDecorationsCollection([
      {
        range: new monacoInstance.Range(targetLine, 1, targetLine, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: "tour-anchor-gutter",
          className: "tour-anchor-line",
        },
      },
    ]);
  }, [tourDraft, tourActiveStep, activeSubgraph, editor, monacoInstance]);

  // Apply tour step highlight decorations on the schema editor whenever the
  // active step, active subgraph, or subgraph SDLs change. Runs in both
  // authoring mode (when a step is selected) and is available to be used
  // during playback (handled in TourPlayback.tsx instead).
  useEffect(() => {
    // Dispose any existing highlight before applying a new one.
    tourHighlightHandleRef.current?.dispose();
    tourHighlightHandleRef.current = null;

    if (!editor || !monacoInstance || tourActiveStep === null || !tourDraft) return;

    const step = tourDraft.steps[tourActiveStep];
    if (!step) return;

    // If the anchor targets a different subgraph, switch to it first.
    // The effect will re-run after the subgraph state update.
    if (step.anchor && step.anchor.subgraphIndex !== activeSubgraph) {
      setActiveSubgraph(step.anchor.subgraphIndex);
      return;
    }

    const currentSdl = subgraphs[activeSubgraph]?.sdl ?? "";
    const prevPayload =
      tourActiveStep > 0 ? resolveTourStep(tourDraft, tourActiveStep - 1) : tourDraft.base;
    const prevSdl = prevPayload.subgraphs[activeSubgraph]?.sdl ?? "";

    tourHighlightHandleRef.current = applyTourHighlight(
      editor,
      monacoInstance,
      step,
      currentSdl,
      prevSdl,
      activeSubgraph,
    );

    return () => {
      tourHighlightHandleRef.current?.dispose();
      tourHighlightHandleRef.current = null;
    };
  }, [
    editor,
    monacoInstance,
    tourDraft,
    tourActiveStep,
    activeSubgraph,
    subgraphs,
    setActiveSubgraph,
  ]);

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
          diagnostics: false,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Debounced query validation effect — uses WASM core so federation directives don't produce false positives.
  useEffect(() => {
    if (!monacoInstance || supergraphSdl === null) return;
    if (queryTimeoutRef.current) clearTimeout(queryTimeoutRef.current);
    queryTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const core = await loadCore();
        const result = core.validateQuery(supergraphSdl, currentQuery);
        const uri = monacoInstance.Uri.parse(`inmemory://model/query-${activeQueryTab}.graphql`);
        const model = monacoInstance.editor.getModel(uri);
        if (model) {
          monacoInstance.editor.setModelMarkers(
            model,
            "query-validation",
            result.diagnostics.map((d) => diagnosticToMarker(d, monacoInstance)),
          );
        }
      })();
    }, 300);
    return () => {
      if (queryTimeoutRef.current) clearTimeout(queryTimeoutRef.current);
    };
  }, [monacoInstance, supergraphSdl, currentQuery, activeQueryTab]);

  // Update mock-config field key and concrete-type suggestions whenever the API schema changes.
  useEffect(() => {
    if (!compose?.ok) {
      mockConfigFieldKeysRef.current = [];
      mockConfigConcreteTypesRef.current = {};
      return;
    }
    try {
      const schema = buildSchema(compose.api_schema_sdl);
      const typeMap = schema.getTypeMap();
      const keys: string[] = [];
      const concreteTypes: Record<string, string[]> = {};
      for (const [typeName, type] of Object.entries(typeMap)) {
        if (typeName.startsWith("__")) continue;
        if (isObjectType(type)) {
          for (const [fieldName, field] of Object.entries(type.getFields())) {
            const key = `${typeName}.${fieldName}`;
            keys.push(key);
            const namedType = getNamedType(field.type);
            if (isUnionType(namedType)) {
              concreteTypes[key] = namedType.getTypes().map((t) => t.name);
            } else if (isInterfaceType(namedType)) {
              const implementors: string[] = [];
              for (const [, other] of Object.entries(typeMap)) {
                if (
                  isObjectType(other) &&
                  other.getInterfaces().some((i) => i.name === namedType.name)
                ) {
                  implementors.push(other.name);
                }
              }
              concreteTypes[key] = implementors;
            }
          }
        }
      }
      mockConfigFieldKeysRef.current = keys;
      mockConfigConcreteTypesRef.current = concreteTypes;
    } catch {
      mockConfigFieldKeysRef.current = [];
      mockConfigConcreteTypesRef.current = {};
    }
  }, [compose]);

  // Register YAML completion provider for mock-config.yaml once on mount.
  useEffect(() => {
    const OVERRIDE_PROPS = [
      {
        label: "enum",
        insertText: "enum:\n  - ",
        detail: "Pick from list (deterministic hash-pick)",
      },
      {
        label: "unionType",
        insertText: "unionType: ",
        detail: "Force a specific concrete type for union/interface",
      },
      {
        label: "oneOf",
        insertText: "oneOf:\n  - ",
        detail: "Hash-pick a concrete type from a list of union/interface members",
      },
      { label: "value", insertText: "value: ", detail: "Always emit this exact JSON value" },
      {
        label: "null",
        insertText: "null: true",
        detail: "Always emit null (ignored on NonNull fields)",
      },
    ];

    const provider = _monaco.languages.registerCompletionItemProvider("yaml", {
      triggerCharacters: ["."],
      provideCompletionItems(model, position) {
        if (!model.uri.path.endsWith("mock-config.yaml")) return { suggestions: [] };

        const lineText = model.getLineContent(position.lineNumber);
        const isComment = lineText.trimStart().startsWith("#");
        if (isComment) return { suggestions: [] };

        const isIndented = /^\s/.test(lineText);

        if (!isIndented) {
          // Top-level line: suggest TypeName.fieldName completions.
          if (lineText.includes(":")) return { suggestions: [] };

          // Token range: scan left/right from cursor to cover A-Za-z0-9._
          let tokenStart = position.column - 1;
          while (tokenStart > 0 && /[A-Za-z0-9._]/.test(lineText[tokenStart - 1])) tokenStart--;
          let tokenEnd = position.column - 1;
          while (tokenEnd < lineText.length && /[A-Za-z0-9._]/.test(lineText[tokenEnd])) tokenEnd++;

          const range = {
            startLineNumber: position.lineNumber,
            startColumn: tokenStart + 1,
            endLineNumber: position.lineNumber,
            endColumn: tokenEnd + 1,
          };

          return {
            suggestions: mockConfigFieldKeysRef.current.map((key) => ({
              label: key,
              kind: _monaco.languages.CompletionItemKind.Property,
              insertText: key + ":\n  ",
              filterText: key,
              range,
            })),
          };
        }

        // Helpers used by the indented-line cases below.

        // Scan backward for the first non-indented TypeName.fieldName: key.
        const findFieldKey = (): string | null => {
          for (let ln = position.lineNumber - 1; ln >= 1; ln--) {
            const line = model.getLineContent(ln);
            if (!line.trim() || line.trim().startsWith("#")) continue;
            if (!/^\s/.test(line) && line.includes(":")) {
              return line.substring(0, line.indexOf(":")).trim();
            }
          }
          return null;
        };

        // Return true when the current line is a list item (  - ) whose nearest
        // non-list-item ancestor at the same or shallower indent is "oneOf:".
        const isUnderOneOf = (): boolean => {
          const currentIndent = lineText.length - lineText.trimStart().length;
          for (let ln = position.lineNumber - 1; ln >= 1; ln--) {
            const line = model.getLineContent(ln);
            if (!line.trim() || line.trim().startsWith("#")) continue;
            const indent = line.length - line.trimStart().length;
            if (indent > currentIndent) continue;
            const trimmed = line.trimStart();
            if (trimmed.startsWith("-")) continue; // sibling list item
            return /^oneOf\s*:/.test(trimmed);
          }
          return false;
        };

        // Build concrete-type suggestions for the field key's union/interface type.
        const concreteTypeSuggestions = (fieldKey: string) => {
          const types = mockConfigConcreteTypesRef.current[fieldKey];
          if (!types || types.length === 0) return null;
          const wordInfo = model.getWordAtPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: wordInfo?.startColumn ?? position.column,
            endColumn: wordInfo?.endColumn ?? position.column,
          };
          return {
            suggestions: types.map((t) => ({
              label: t,
              kind: _monaco.languages.CompletionItemKind.EnumMember,
              insertText: t,
              range,
            })),
          };
        };

        // Case: value position after "  unionType: "
        const unionTypeValueMatch = lineText.match(/^(\s+unionType:\s*)/);
        if (unionTypeValueMatch && position.column > unionTypeValueMatch[1].length) {
          const fieldKey = findFieldKey();
          if (fieldKey) {
            const result = concreteTypeSuggestions(fieldKey);
            if (result) return result;
          }
        }

        // Case: list item under "oneOf:" (cursor at or past the "- " prefix)
        const listItemMatch = lineText.match(/^(\s*-\s*)/);
        if (listItemMatch && position.column >= listItemMatch[1].length && isUnderOneOf()) {
          const fieldKey = findFieldKey();
          if (fieldKey) {
            const result = concreteTypeSuggestions(fieldKey);
            if (result) return result;
          }
        }

        // Case: override property name (only when no colon precedes the cursor).
        const strippedPrefix = lineText.substring(0, position.column - 1).trimStart();
        if (strippedPrefix.includes(":")) return { suggestions: [] };

        // getWordAtPosition covers the full word under the cursor so a mid-word
        // trigger replaces the whole word correctly.
        const wordInfo = model.getWordAtPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordInfo?.startColumn ?? position.column,
          endColumn: wordInfo?.endColumn ?? position.column,
        };

        return {
          suggestions: OVERRIDE_PROPS.map((p) => ({
            label: p.label,
            kind: _monaco.languages.CompletionItemKind.Property,
            insertText: p.insertText,
            detail: p.detail,
            range,
          })),
        };
      },
    });

    return () => provider.dispose();
  }, []);

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
      mockConfig,
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

  function createTour() {
    const base: WorkspacePayload = { subgraphs, queryTabs, activeQueryTab, seed, mockConfig };
    setTourDraft({ title: "Untitled Tour", base, steps: [] });
    setTourAuthoringOpen(true);
  }

  function copyTourShareUrl() {
    if (!tourDraft) return;
    const hash = encodeTour(tourDraft);
    const loc = window.location;
    const hostname =
      typeof loc.hostname === "string" && loc.hostname.length > 0 ? loc.hostname : "localhost";
    const port = typeof loc.port === "string" && loc.port.length > 0 ? loc.port : "";
    const origin = loc.origin || `http://${hostname}${port ? `:${port}` : ""}`;
    const shareUrl = origin + window.location.pathname + hash;

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

  /**
   * Parse a YAML string into a JSON string suitable for passing to
   * `core.executeMock`. Returns `"{}"` and sets `configError` on parse
   * failure so the query still runs with default generation.
   */
  function parseYamlToJson(yaml: string): string {
    if (!yaml.trim()) return "{}";
    try {
      const parsed = jsYaml.load(yaml);
      if (parsed === null || parsed === undefined) return "{}";
      setConfigError(null);
      return JSON.stringify(parsed);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Invalid YAML");
      return "{}";
    }
  }

  async function doRun(query: string, sdl: string, s: number) {
    const core = await loadCore();
    const mockConfigJson = parseYamlToJson(mockConfig);
    const [execResult, plan] = await Promise.all([
      Promise.resolve(core.executeMock(sdl, query, s, mockConfigJson)),
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
          onClick={() => {
            setActiveQueryTab(i);
            setShowMockConfig(false);
          }}
          aria-pressed={!showMockConfig && i === activeQueryTab}
          className={!showMockConfig && i === activeQueryTab ? "tab is-active" : "tab"}
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
      {/* Right-aligned Mock Config tab — visually separated from query tabs */}
      <button
        onClick={() => setShowMockConfig(!showMockConfig)}
        aria-pressed={showMockConfig}
        className={showMockConfig ? "tab is-active" : "tab"}
        style={{ marginLeft: "auto" }}
        title="Configure mock data overrides (YAML)"
        data-testid="mock-config-tab"
      >
        Mock Config
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

  // Unique service names in the active plan — drives the legend and decorations.
  const activePlanServices =
    planResult !== null && planResult.ok ? collectServiceNames(planResult.query_plan) : [];

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

  const timelineContent = (
    <div className="scroll">
      {planResult === null ? (
        <p className="empty-state">Run a query to see the timeline.</p>
      ) : planResult.ok ? (
        <ExecutionTimeline node={planResult.query_plan} />
      ) : (
        <div className="callout callout--error">
          {planResult.errors.map((e, i) => (
            <ErrorMessage key={i} text={e.message} />
          ))}
        </div>
      )}
    </div>
  );

  const entityGraph = useMemo(
    () => (compose?.ok && compose.entity_graph ? schemaToEntityGraph(compose.entity_graph) : null),
    [compose],
  );

  const entitiesContent = (
    <div className="scroll">
      {entityGraph === null ? (
        <p className="empty-state">Compose a valid supergraph to see entity relationships.</p>
      ) : (
        <EntityOwnershipGraph graph={entityGraph} />
      )}
    </div>
  );

  const typeGraphData = compose?.ok ? (compose.type_graph ?? null) : null;
  const apiSchemaSdlForShape = compose?.ok ? compose.api_schema_sdl : null;

  const typeGraphContent = (
    <div className="scroll" style={{ height: "100%" }}>
      {typeGraphData === null ? (
        <p className="empty-state">Compose a valid supergraph to see the type graph.</p>
      ) : (
        <TypeGraph typeGraph={typeGraphData} />
      )}
    </div>
  );

  const queryShapeContent = (
    <div className="scroll">
      <QueryShape apiSchemaSdl={apiSchemaSdlForShape ?? ""} query={currentQuery} />
    </div>
  );

  const resultsContent = (
    <div className="scroll">
      {configError !== null && (
        <div className="callout callout--warning" style={{ marginBottom: 8 }}>
          <strong>Mock Config YAML error:</strong> {configError}
          <br />
          <span style={{ fontSize: "0.85em", opacity: 0.8 }}>
            Running with defaults — fix the YAML to apply overrides.
          </span>
        </div>
      )}
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
      {tourDraft !== null ? (
        <>
          <button onClick={copyTourShareUrl} className={copied ? "btn is-success" : "btn"}>
            {copied ? "Copied!" : "Share Tour"}
          </button>
          {!tourAuthoringOpen && (
            <button onClick={() => setTourAuthoringOpen(true)} className="btn">
              Tour ›
            </button>
          )}
        </>
      ) : (
        <>
          <button onClick={copyShareUrl} className={copied ? "btn is-success" : "btn"}>
            {copied ? "Copied!" : "Share"}
          </button>
          <button onClick={createTour} className="btn">
            Create Tour
          </button>
        </>
      )}
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

  // Tour playback mode — render a completely separate layout.
  if (playbackError !== null) {
    return (
      <div className="tour-playback__error">
        <p>Could not load tour: {playbackError}</p>
      </div>
    );
  }
  if (playbackTour !== null) {
    return <TourPlayback tour={playbackTour} />;
  }

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
                      showMockConfig
                        ? setViewSource({
                            title: "Mock Config",
                            value: mockConfig,
                            onEdit: (v) => setMockConfig(v),
                          })
                        : setViewSource({
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
                {showMockConfig ? (
                  <div
                    data-testid="mock-config-editor"
                    className="editor"
                    style={{ flex: 1, minHeight: 0 }}
                  >
                    <Editor
                      language="yaml"
                      path="mock-config.yaml"
                      value={mockConfig}
                      defaultValue={[
                        "# Mock Config — override what the mock executor generates.",
                        "# Keys are TypeName.fieldName. Example:",
                        "#",
                        "# User.name:",
                        "#   enum: [Alice, Bob, Carol]",
                      ].join("\n")}
                      onChange={(v) => setMockConfig(v ?? "")}
                      height="100%"
                      options={MOCK_CONFIG_EDITOR_OPTIONS}
                      theme={MONACO_THEME}
                      beforeMount={(m) => defineMonacoTheme(m)}
                    />
                  </div>
                ) : (
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
                      options={QUERY_EDITOR_OPTIONS}
                      theme={MONACO_THEME}
                      beforeMount={(m) => defineMonacoTheme(m)}
                      onMount={(ed) => {
                        queryEditorRef.current = ed;
                      }}
                    />
                  </div>
                )}
                <SubgraphLegend services={activePlanServices} />
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
                    onClick={() => setOutputTab("type-graph")}
                    aria-pressed={outputTab === "type-graph"}
                    className={outputTab === "type-graph" ? "tab is-active" : "tab"}
                  >
                    Type Graph
                  </button>
                  <button
                    onClick={() => setOutputTab("entities")}
                    aria-pressed={outputTab === "entities"}
                    className={outputTab === "entities" ? "tab is-active" : "tab"}
                  >
                    Entities
                  </button>
                  <button
                    onClick={() => setOutputTab("sdl")}
                    aria-pressed={outputTab === "sdl"}
                    className={outputTab === "sdl" ? "tab is-active" : "tab"}
                  >
                    Supergraph SDL
                  </button>
                </nav>
                {compositionErrorContent ?? (
                  <>
                    {outputTab === "type-graph" && typeGraphContent}
                    {outputTab === "entities" && entitiesContent}
                    {outputTab === "sdl" && sdlContent}
                  </>
                )}
              </div>
            )}

            {mobileTab === "results" && (
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
                    onClick={() => setResultsTab("plan")}
                    aria-pressed={resultsTab === "plan"}
                    className={resultsTab === "plan" ? "tab is-active" : "tab"}
                  >
                    Query Plan
                  </button>
                  <button
                    onClick={() => setResultsTab("sequence")}
                    aria-pressed={resultsTab === "sequence"}
                    className={resultsTab === "sequence" ? "tab is-active" : "tab"}
                  >
                    Sequence Diagram
                  </button>
                  <button
                    onClick={() => setResultsTab("timeline")}
                    aria-pressed={resultsTab === "timeline"}
                    className={resultsTab === "timeline" ? "tab is-active" : "tab"}
                  >
                    Timeline
                  </button>
                  <button
                    onClick={() => setResultsTab("schema-tree")}
                    aria-pressed={resultsTab === "schema-tree"}
                    className={resultsTab === "schema-tree" ? "tab is-active" : "tab"}
                  >
                    Query Shape
                  </button>
                  <button
                    onClick={() => setResultsTab("output")}
                    aria-pressed={resultsTab === "output"}
                    className={resultsTab === "output" ? "tab is-active" : "tab"}
                  >
                    Output
                  </button>
                </nav>
                {resultsTab === "plan" && planContent}
                {resultsTab === "sequence" && sequenceContent}
                {resultsTab === "timeline" && timelineContent}
                {resultsTab === "schema-tree" && queryShapeContent}
                {resultsTab === "output" && resultsContent}
              </div>
            )}

            {mobileTab === "tour" && tourDraft !== null && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <TourAuthoringPanel onCollapse={() => setMobileTab("schema")} />
              </div>
            )}
          </div>

          {/* Mobile tab bar */}
          <nav className="mobile-tabbar">
            {(["schema", "query", "output", "results"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                aria-pressed={mobileTab === tab}
                className={mobileTab === tab ? "mobile-tab is-active" : "mobile-tab"}
              >
                {tab === "schema"
                  ? "Schema"
                  : tab === "query"
                    ? "Query"
                    : tab === "output"
                      ? "Output"
                      : "Results"}
              </button>
            ))}
            {tourDraft !== null && (
              <button
                onClick={() => setMobileTab("tour")}
                aria-pressed={mobileTab === "tour"}
                className={mobileTab === "tour" ? "mobile-tab is-active" : "mobile-tab"}
              >
                Tour
              </button>
            )}
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

  const VISUAL_TAB_LABELS: Record<
    "plan" | "sequence" | "timeline" | "entities" | "type-graph" | "schema-tree",
    string
  > = {
    plan: "Query Plan",
    sequence: "Sequence Diagram",
    timeline: "Timeline",
    entities: "Entity Ownership Graph",
    "type-graph": "Type Graph",
    "schema-tree": "Query Shape",
  };

  return (
    <>
      <div
        className="app"
        style={{ height: "100vh", display: "flex", flexDirection: "column", padding: 8 }}
      >
        {globalHeader}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 8 }}>
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
                    <h2 className="section-title">Output</h2>
                    <nav className="tab-strip">
                      <button
                        onClick={() => setOutputTab("type-graph")}
                        aria-pressed={outputTab === "type-graph"}
                        className={outputTab === "type-graph" ? "tab is-active" : "tab"}
                      >
                        Type Graph
                      </button>
                      <button
                        onClick={() => setOutputTab("entities")}
                        aria-pressed={outputTab === "entities"}
                        className={outputTab === "entities" ? "tab is-active" : "tab"}
                      >
                        Entities
                      </button>
                      <button
                        onClick={() => setOutputTab("sdl")}
                        aria-pressed={outputTab === "sdl"}
                        className={outputTab === "sdl" ? "tab is-active" : "tab"}
                      >
                        Supergraph SDL
                      </button>
                      {(outputTab === "type-graph" || outputTab === "entities") && (
                        <button
                          className="btn btn--icon"
                          style={{ marginLeft: "auto" }}
                          title="Expand to full screen"
                          aria-label="Expand to full screen"
                          onClick={() => setFullscreenTab(outputTab)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </nav>

                    {compositionErrorContent ?? (
                      <>
                        {outputTab === "type-graph" && typeGraphContent}
                        {outputTab === "entities" && entitiesContent}
                        {outputTab === "sdl" && sdlContent}
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
                    {showMockConfig ? (
                      <div data-testid="mock-config-editor" className="editor">
                        <Editor
                          language="yaml"
                          path="mock-config.yaml"
                          value={mockConfig}
                          defaultValue={[
                            "# Mock Config — override what the mock executor generates.",
                            "# Keys are TypeName.fieldName. Example:",
                            "#",
                            "# User.name:",
                            "#   enum: [Alice, Bob, Carol]",
                            "#",
                            "# Query.search:",
                            "#   unionType: Product",
                            "#",
                            "# Product.price:",
                            "#   value: 42",
                            "#",
                            "# User.deletedAt:",
                            "#   null: true",
                          ].join("\n")}
                          onChange={(v) => setMockConfig(v ?? "")}
                          height="100%"
                          options={MOCK_CONFIG_EDITOR_OPTIONS}
                          theme={MONACO_THEME}
                          beforeMount={(m) => defineMonacoTheme(m)}
                        />
                      </div>
                    ) : (
                      <div data-testid="query-editor" className="editor">
                        <Editor
                          language="graphql"
                          path={`query-${activeQueryTab}.graphql`}
                          value={currentQuery}
                          onChange={(v) => setQueryTabQuery(activeQueryTab, v ?? "")}
                          height="100%"
                          options={QUERY_EDITOR_OPTIONS}
                          theme={MONACO_THEME}
                          beforeMount={(m) => defineMonacoTheme(m)}
                          onMount={(ed) => {
                            queryEditorRef.current = ed;
                          }}
                        />
                      </div>
                    )}
                    <SubgraphLegend services={activePlanServices} />
                  </div>
                </Panel>
                <Separator className="resize-handle" />
                <Panel defaultSize={50} minSize={150}>
                  <div className="panel" style={{ overflow: "hidden" }}>
                    <h2 className="section-title">Results</h2>
                    <nav className="tab-strip">
                      <button
                        onClick={() => setResultsTab("plan")}
                        aria-pressed={resultsTab === "plan"}
                        className={resultsTab === "plan" ? "tab is-active" : "tab"}
                      >
                        Query Plan
                      </button>
                      <button
                        onClick={() => setResultsTab("sequence")}
                        aria-pressed={resultsTab === "sequence"}
                        className={resultsTab === "sequence" ? "tab is-active" : "tab"}
                      >
                        Sequence Diagram
                      </button>
                      <button
                        onClick={() => setResultsTab("timeline")}
                        aria-pressed={resultsTab === "timeline"}
                        className={resultsTab === "timeline" ? "tab is-active" : "tab"}
                      >
                        Timeline
                      </button>
                      <button
                        onClick={() => setResultsTab("schema-tree")}
                        aria-pressed={resultsTab === "schema-tree"}
                        className={resultsTab === "schema-tree" ? "tab is-active" : "tab"}
                      >
                        Query Shape
                      </button>
                      <button
                        onClick={() => setResultsTab("output")}
                        aria-pressed={resultsTab === "output"}
                        className={resultsTab === "output" ? "tab is-active" : "tab"}
                      >
                        Output
                      </button>
                      {(resultsTab === "plan" ||
                        resultsTab === "sequence" ||
                        resultsTab === "timeline" ||
                        resultsTab === "schema-tree") && (
                        <button
                          className="btn btn--icon"
                          style={{ marginLeft: "auto" }}
                          title="Expand to full screen"
                          aria-label="Expand to full screen"
                          onClick={() => setFullscreenTab(resultsTab)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </nav>
                    {resultsTab === "plan" && planContent}
                    {resultsTab === "sequence" && sequenceContent}
                    {resultsTab === "timeline" && timelineContent}
                    {resultsTab === "schema-tree" && queryShapeContent}
                    {resultsTab === "output" && resultsContent}
                  </div>
                </Panel>
              </Group>
            </Panel>
          </Group>
          {tourDraft !== null && tourAuthoringOpen && (
            <div style={{ width: 280, flexShrink: 0, minHeight: 0 }}>
              <TourAuthoringPanel onCollapse={() => setTourAuthoringOpen(false)} />
            </div>
          )}
        </div>
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

      {fullscreenTab !== null && (
        <div
          className="fullscreen-modal-backdrop"
          onClick={() => setFullscreenTab(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFullscreenTab(null);
          }}
        >
          <div
            className="fullscreen-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${VISUAL_TAB_LABELS[fullscreenTab]} full screen`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fullscreen-modal__header">
              <span className="fullscreen-modal__title">{VISUAL_TAB_LABELS[fullscreenTab]}</span>
              <button
                className="btn btn--icon"
                aria-label="Close full screen"
                onClick={() => setFullscreenTab(null)}
              >
                ×
              </button>
            </div>
            <div className="fullscreen-modal__body">
              {fullscreenTab === "plan" && planContent}
              {fullscreenTab === "sequence" && sequenceContent}
              {fullscreenTab === "timeline" && timelineContent}
              {fullscreenTab === "entities" && entitiesContent}
              {fullscreenTab === "type-graph" && typeGraphContent}
              {fullscreenTab === "schema-tree" && queryShapeContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
