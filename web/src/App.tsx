import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useMobile } from "./hooks";
import { Group, Panel, Separator } from "react-resizable-panels";
import * as _monaco from "monaco-editor";
import Editor from "@monaco-editor/react";
import { useWorkspace, activeWorkspace, DEFAULT_SUBGRAPHS, DEFAULT_QUERY_TABS } from "./store";
import { useAuth, fetchCurrentUser, login, logout } from "./auth";
import { initSync } from "./sync";
import { loadCore } from "./core";
import { decode, encode, encodeTour, decodeTour } from "./share";
import type { WorkspacePayload, Tour, WorkspaceEntry } from "./share";
import type { GqlCore } from "./core/types";
import { TourAuthoringPanel } from "./TourAuthoringPanel";
import { AboutModal } from "./AboutModal";
import { ExportImageDialog } from "./ExportImageDialog";
import { ExportDialog, ImportDialog } from "./ExportImportDialog";
import { exportPng, exportSvg } from "./imageExport";
import { TourPlayback } from "./TourPlayback";
import { PlanTree } from "./PlanTree";
import { SequenceDiagram } from "./SequenceDiagram";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { MONACO_THEME, defineMonacoTheme } from "./monacoTheme";
import { planToFieldRanges, collectServiceNames } from "./planToFieldRanges";
import { hashSubgraphName, injectSubgraphStyles, subgraphColorVar } from "./subgraphColors";
import { useTourAuthoringDecorations } from "./useTourAuthoringDecorations";
import { useMonacoGraphQL } from "./useMonacoGraphQL";
import { useGraphQLPipeline } from "./useGraphQLPipeline";
import { useCopyToClipboard } from "./useCopyToClipboard";
import { EditableTab } from "./EditableTab";
import { TabStrip } from "./TabStrip";
import type { TabStripTab } from "./TabStrip";
import { schemaToEntityGraph } from "./schemaToEntityGraph";
import { EntityOwnershipGraph } from "./EntityOwnershipGraph";
import { TypeGraph } from "./TypeGraph";
import { QueryShape } from "./QueryShape";
import { initVimMode, VimMode } from "monaco-vim";

// VimMode is the CodeMirror default export from keymap_vim; Vim is attached as CodeMirror.Vim.
// It is not re-exported from monaco-vim's public API so we access it via VimMode.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Vim = (VimMode as any).Vim as {
  defineEx: (
    name: string,
    abbrev: string,
    fn: (cm: { editor: import("monaco-editor").editor.IStandaloneCodeEditor }) => void,
  ) => void;
  map: (lhs: string, rhs: string, ctx: string) => void;
};

// gc in visual mode toggles line comments via Monaco's built-in action.
// cm.editor is the IStandaloneCodeEditor for whichever editor fired the command.
Vim.defineEx("Commentary", "", (cm) => {
  cm.editor.getAction("editor.action.commentLine")?.run();
});
Vim.map("gc", ":Commentary<CR>", "visual");

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
  const [copied, copyError] = useCopyToClipboard();

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
        onClick={() => copyError(text)}
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

/**
 * Icon button that opens the image-export dialog, styled like the expand button
 * (btn btn--icon). Disabled when there is no diagram to export; flips to a
 * transient error state (via `error`) when an export fails. Generic — any
 * visual tab can render it.
 */
function ExportImageButton({
  disabled,
  error,
  onClick,
  style,
}: {
  disabled: boolean;
  error: string | null;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      className={error ? "btn btn--icon is-error" : "btn btn--icon"}
      disabled={disabled}
      title={error ?? "Export image"}
      aria-label={error ?? "Export image"}
      onClick={onClick}
      style={style}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M7 1v8M4 6l3 3 3-3M1 11v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
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

export default function App() {
  // Global (non-workspace) state
  const {
    workspaces,
    activeWorkspaceIndex,
    supergraphSdl,
    vimMode,
    setVimMode,
    tourActiveStep,
    setStepAnchor,
    addWorkspace,
    cloneWorkspace,
    removeWorkspace,
    renameWorkspace,
    setActiveWorkspace,
    setActiveSubgraph,
    setSubgraphSdl,
    addSubgraph,
    removeSubgraph,
    setActiveQueryTab,
    addQueryTab,
    removeQueryTab,
    renameQueryTab,
    setQueryTabQuery,
    setSeed,
    resetToDefaults,
    renameSubgraph,
    setTourDraft,
    setMockConfig,
  } = useWorkspace();

  // Active workspace fields via selector
  const activeWs = workspaces[activeWorkspaceIndex];
  const subgraphs = activeWs.subgraphs;
  const activeSubgraph = activeWs.activeSubgraph;
  const queryTabs = activeWs.queryTabs;
  const activeQueryTab = activeWs.activeQueryTab;
  const seed = activeWs.seed;
  const mockConfig = activeWs.mockConfig;
  const tourDraft = activeWs.tourDraft;
  const [tourAuthoringOpen, setTourAuthoringOpen] = useState(false);
  const [tourPreviewMode, setTourPreviewMode] = useState(false);
  const [playbackTour, setPlaybackTour] = useState<Tour | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const currentQuery = queryTabs[activeQueryTab]?.query ?? "";
  // WASM core instance — loaded once and cached; available on first render cycle after load.
  const [coreInstance, setCoreInstance] = useState<GqlCore | null>(null);
  const [showMockConfig, setShowMockConfig] = useState(false);
  const [outputTab, setOutputTab] = useState<"type-graph" | "entities" | "sdl" | "api-sdl">(
    "type-graph",
  );
  const [resultsTab, setResultsTab] = useState<
    "plan" | "sequence" | "timeline" | "schema-tree" | "output"
  >("plan");
  const [fullscreenTab, setFullscreenTab] = useState<
    "plan" | "sequence" | "timeline" | "entities" | "type-graph" | "schema-tree" | null
  >(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [workspaceExportOpen, setWorkspaceExportOpen] = useState(false);
  const [workspaceImportOpen, setWorkspaceImportOpen] = useState(false);
  // Lets the tab-strip export button reach the live sequence-diagram <svg>.
  const sequenceSvgContainerRef = useRef<HTMLDivElement>(null);
  // Each copy button tracks its own "Copied!" state independently (TASK-96.4:
  // these previously shared one `copied` flag, so clicking one button also
  // flipped the others' text).
  const [copiedLLM, copyLLM] = useCopyToClipboard();
  const [copiedShare, copyShare] = useCopyToClipboard();
  const [copiedTourShare, copyTourShare] = useCopyToClipboard();
  const editorRef = useState<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useState<typeof _monaco | null>(null);
  const [editor, setEditor] = editorRef;
  const [monacoInstance, setMonacoInstance] = monacoRef;
  // Core compose/validate/plan/run pipeline (debounced compose, auto-run,
  // subgraph/query validation) — see useGraphQLPipeline.ts.
  const { compose, planResult, mockResult, isRunning, configError, runQuery } = useGraphQLPipeline({
    subgraphs,
    activeSubgraph,
    supergraphSdl,
    currentQuery,
    seed,
    mockConfig,
    editor,
    monacoInstance,
    activeWorkspaceIndex,
    activeQueryTab,
  });
  const { registerSchema } = useMonacoGraphQL(compose);
  // Registers the composed API schema with the monaco-graphql singleton
  // whenever `compose` changes; deregisters (passes `null`) on a failed
  // compose so completions/hovers don't keep suggesting fields from a
  // supergraph that no longer composes.
  useEffect(() => {
    if (compose) registerSchema(compose.ok ? compose.api_schema_sdl : null);
  }, [compose, registerSchema]);
  // Query editor instance ref — used to apply field-attribution decorations.
  const queryEditorRef = useRef<_monaco.editor.IStandaloneCodeEditor | null>(null);
  // Monaco decoration collection for field-attribution highlights.
  const decorationsRef = useRef<ReturnType<
    _monaco.editor.IStandaloneCodeEditor["createDecorationsCollection"]
  > | null>(null);
  // Mock-config editor instance — needed to attach vim keybindings when vimMode is on.
  const mockConfigEditorRef = useRef<_monaco.editor.IStandaloneCodeEditor | null>(null);
  // DOM node for the vim mode status bar (normal/insert/visual indicator).
  const vimStatusBarRef = useRef<HTMLDivElement>(null);
  // Disposers for active vim mode instances — cleared on toggle-off or editor remount.
  const vimDisposersRef = useRef<(() => void)[]>([]);
  const isMobile = useMobile();
  const [mobileTab, setMobileTab] = useState<"schema" | "query" | "output" | "results" | "tour">(
    "schema",
  );

  // Auth state — resolved on mount by fetchCurrentUser()
  const { user, status: authStatus, syncStatus } = useAuth();

  // Load WASM core once on mount; store it so components (e.g. QueryShape) can use it as a prop.
  useEffect(() => {
    void loadCore().then(setCoreInstance);
  }, []);

  // Bootstrap auth state on mount — picks up the session cookie if the user
  // already logged in (or just returned from the OAuth redirect).
  useEffect(() => {
    void fetchCurrentUser().then((u) => {
      useAuth.getState().setAuth(u);
    });
  }, []);

  // Initialize cloud sync engine — subscribes to auth + workspace changes.
  useEffect(() => initSync(), []);
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

  // Transient export error: surface it on the button, then clear after 2.5s.
  useEffect(() => {
    if (exportError === null) return;
    const timer = setTimeout(() => setExportError(null), 2500);
    return () => clearTimeout(timer);
  }, [exportError]);

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
      const currentWorkspaces = useWorkspace.getState().workspaces;
      // First visit (no existing workspaces with real content): replace.
      // Returning visitor: append as a new workspace and switch to it.
      const isFirstVisit =
        currentWorkspaces.length === 0 ||
        (currentWorkspaces.length === 1 &&
          currentWorkspaces[0].subgraphs.length === DEFAULT_SUBGRAPHS.length &&
          currentWorkspaces[0].queryTabs.length === 1 &&
          currentWorkspaces[0].queryTabs[0].query === DEFAULT_QUERY_TABS[0].query);

      if (isFirstVisit) {
        // Replace the single default workspace with the shared one.
        const sharedEntry: import("./share").WorkspaceEntry = {
          name: "Workspace 1",
          subgraphs: payload.subgraphs,
          activeSubgraph: 0,
          queryTabs: payload.queryTabs,
          activeQueryTab: payload.activeQueryTab ?? 0,
          seed: payload.seed,
          mockConfig: payload.mockConfig ?? "",
          tourDraft: null,
        };
        useWorkspace.setState({
          workspaces: [sharedEntry],
          activeWorkspaceIndex: 0,
          supergraphSdl: null,
          composeErrors: null,
          composeHints: 0,
        });
      } else {
        // Append as a new workspace named "Workspace N".
        let n = 1;
        while (currentWorkspaces.some((ws) => ws.name === `Workspace ${n}`)) n++;
        const newEntry: import("./share").WorkspaceEntry = {
          name: `Workspace ${n}`,
          subgraphs: payload.subgraphs,
          activeSubgraph: 0,
          queryTabs: payload.queryTabs,
          activeQueryTab: payload.activeQueryTab ?? 0,
          seed: payload.seed,
          mockConfig: payload.mockConfig ?? "",
          tourDraft: null,
        };
        useWorkspace.setState({
          workspaces: [...currentWorkspaces, newEntry],
          activeWorkspaceIndex: currentWorkspaces.length,
          supergraphSdl: null,
          composeErrors: null,
          composeHints: 0,
        });
      }
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

  useTourAuthoringDecorations({
    editor,
    monacoInstance,
    tourDraft,
    tourActiveStep,
    activeSubgraph,
    tourAuthoringOpen,
    subgraphs,
    setStepAnchor,
    setActiveSubgraph,
  });

  // When workspace switches, stale Monaco models may exist at the new index's
  // paths (e.g., workspace index is reused after removal). Sync them to the
  // store so the editor doesn't show leftover content from a previous workspace.
  const staleModelSubgraphsRef = useRef(subgraphs);
  useEffect(() => {
    staleModelSubgraphsRef.current = subgraphs;
  });
  useEffect(() => {
    if (!monacoInstance) return;
    try {
      staleModelSubgraphsRef.current.forEach((sg, i) => {
        const uri = monacoInstance.Uri.parse(`inmemory://model/ws-${activeWorkspaceIndex}-sg-${i}`);
        const model = monacoInstance.editor.getModel(uri);
        if (model && model.getValue() !== sg.sdl) {
          model.setValue(sg.sdl);
        }
      });
    } catch {
      // monacoInstance may be a partial mock (e.g., in tests); skip gracefully.
    }
  }, [activeWorkspaceIndex, monacoInstance]);

  // Vim keybindings effect — attaches or detaches monaco-vim on all editors
  // whenever vimMode changes or the schema editor instance is replaced.
  useEffect(() => {
    // Always dispose existing vim instances before re-evaluating.
    vimDisposersRef.current.forEach((d) => d());
    vimDisposersRef.current = [];

    if (!vimMode || !vimStatusBarRef.current) return;

    const statusEl = vimStatusBarRef.current;
    const editors: (_monaco.editor.IStandaloneCodeEditor | null)[] = [
      editor,
      queryEditorRef.current,
      mockConfigEditorRef.current,
    ];

    for (const ed of editors) {
      if (!ed) continue;
      const vimInst = initVimMode(ed, statusEl);
      vimDisposersRef.current.push(() => vimInst.dispose());
    }

    return () => {
      vimDisposersRef.current.forEach((d) => d());
      vimDisposersRef.current = [];
    };
  }, [vimMode, editor]);

  // Attaches vim keybindings to an editor as soon as it mounts, based on the
  // *current* vimMode. The centralized vim effect above only re-runs on
  // [vimMode, editor] changes, so it never sees the query/mock-config editors
  // remount when `showMockConfig` toggles — this covers that case directly.
  function attachVimOnMount(ed: _monaco.editor.IStandaloneCodeEditor) {
    if (!vimMode || !vimStatusBarRef.current) return;
    const vimInst = initVimMode(ed, vimStatusBarRef.current);
    vimDisposersRef.current.push(() => vimInst.dispose());
  }

  function copyForLLM() {
    const ws = activeWorkspace(useWorkspace.getState());
    const parts: string[] = [];

    parts.push("## Subgraphs");
    for (const sg of ws.subgraphs) {
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

    copyLLM(parts.join("\n"));
  }

  function copyShareUrl() {
    const ws = activeWorkspace(useWorkspace.getState());
    const payload: WorkspacePayload = {
      subgraphs: ws.subgraphs,
      queryTabs: ws.queryTabs,
      activeQueryTab: ws.activeQueryTab,
      seed: ws.seed,
      mockConfig: ws.mockConfig,
    };
    const encodedHash = encode(payload);
    // Build origin — handle JSDOM where location.origin/hostname may be undefined.
    const loc = window.location;
    const hostname =
      typeof loc.hostname === "string" && loc.hostname.length > 0 ? loc.hostname : "localhost";
    const port = typeof loc.port === "string" && loc.port.length > 0 ? loc.port : "";
    const origin = loc.origin || `http://${hostname}${port ? `:${port}` : ""}`;
    const shareUrl = origin + window.location.pathname + encodedHash;

    copyShare(shareUrl);
  }

  function createTour() {
    const ws = activeWorkspace(useWorkspace.getState());
    const base: WorkspacePayload = {
      subgraphs: ws.subgraphs,
      queryTabs: ws.queryTabs,
      activeQueryTab: ws.activeQueryTab,
      seed: ws.seed,
      mockConfig: ws.mockConfig,
    };
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

    copyTourShare(shareUrl);
  }

  // Shared JSX fragments used by both layouts.
  const subgraphTabStrip = (
    <nav className="tab-strip">
      {subgraphs.map((sg, i) => (
        <EditableTab
          key={i}
          name={sg.name}
          active={i === activeSubgraph}
          onSelect={() => setActiveSubgraph(i)}
          onRename={(newName) => renameSubgraph(i, newName)}
          onRemove={() => removeSubgraph(i)}
        />
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
        path={`ws-${activeWorkspaceIndex}-sg-${activeSubgraph}`}
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
        <EditableTab
          key={i}
          name={tab.name}
          active={!showMockConfig && i === activeQueryTab}
          onSelect={() => {
            setActiveQueryTab(i);
            setShowMockConfig(false);
          }}
          onRename={(newName) => renameQueryTab(i, newName)}
          onRemove={() => removeQueryTab(i)}
        />
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

  // Content-switch tab bars for the output and results panes — built once per
  // render and shared by the mobile/desktop layouts, each with its own
  // `trailing` (expand/export buttons).
  const outputTabs: TabStripTab[] = [
    {
      key: "type-graph",
      label: "Type Graph",
      active: outputTab === "type-graph",
      onClick: () => setOutputTab("type-graph"),
    },
    {
      key: "entities",
      label: "Entities",
      active: outputTab === "entities",
      onClick: () => setOutputTab("entities"),
    },
    {
      key: "sdl",
      label: "Supergraph SDL",
      active: outputTab === "sdl",
      onClick: () => setOutputTab("sdl"),
    },
    {
      key: "api-sdl",
      label: "API SDL",
      active: outputTab === "api-sdl",
      onClick: () => setOutputTab("api-sdl"),
    },
  ];

  const resultsTabs: TabStripTab[] = [
    {
      key: "plan",
      label: "Query Plan",
      active: resultsTab === "plan",
      onClick: () => setResultsTab("plan"),
    },
    {
      key: "sequence",
      label: "Sequence Diagram",
      active: resultsTab === "sequence",
      onClick: () => setResultsTab("sequence"),
    },
    {
      key: "timeline",
      label: "Timeline",
      active: resultsTab === "timeline",
      onClick: () => setResultsTab("timeline"),
    },
    {
      key: "schema-tree",
      label: "Query Shape",
      active: resultsTab === "schema-tree",
      onClick: () => setResultsTab("schema-tree"),
    },
    {
      key: "output",
      label: "Output",
      active: resultsTab === "output",
      onClick: () => setResultsTab("output"),
    },
  ];

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

  const apiSdlContent = (
    <div className="scroll">
      {compose === null ? (
        <pre className="code-block">Loading core…</pre>
      ) : compose.ok ? (
        <pre className="code-block">{compose.api_schema_sdl}</pre>
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

  // A rendered diagram exists only when the plan succeeded; gates the export button.
  const canExportSequence = planResult !== null && planResult.ok;

  const handleExportSequence = async (format: "svg" | "png") => {
    const svg = sequenceSvgContainerRef.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) {
      setExportError("No diagram to export");
      return;
    }
    try {
      if (format === "svg") {
        exportSvg(svg, "sequence-diagram.svg");
      } else {
        const background =
          getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() ||
          "#16243a";
        await exportPng(svg, "sequence-diagram.png", background);
      }
    } catch (e) {
      setExportError(String(e));
    }
  };

  const sequenceContent = (
    <div className="scroll">
      {planResult === null ? (
        <p className="empty-state">Run a query to see the sequence diagram.</p>
      ) : planResult.ok ? (
        <SequenceDiagram node={planResult.query_plan} containerRef={sequenceSvgContainerRef} />
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
      {coreInstance ? (
        <QueryShape
          core={coreInstance}
          apiSchemaSdl={apiSchemaSdlForShape ?? ""}
          query={currentQuery}
        />
      ) : (
        <p className="empty-state">Write a query to see its shape.</p>
      )}
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
      <button
        onClick={() => setVimMode(!vimMode)}
        aria-pressed={vimMode}
        className={vimMode ? "btn is-active" : "btn"}
        title="Toggle vim keybindings"
      >
        Vim
      </button>
      <div ref={vimStatusBarRef} className="vim-statusbar" />
    </div>
  );

  const workspaceTabStrip = (
    <nav className="workspace-tab-strip" aria-label="Workspaces" data-testid="workspace-tab-strip">
      {workspaces.map((ws, i) => (
        <EditableTab
          key={i}
          name={ws.name}
          active={i === activeWorkspaceIndex}
          onSelect={() => setActiveWorkspace(i)}
          onRename={(newName) => renameWorkspace(i, newName)}
          onRemove={() => removeWorkspace(i)}
          canRename={i === activeWorkspaceIndex}
          testId={`workspace-tab-${i}`}
          removeAriaLabel={`Remove ${ws.name}`}
          removeTestId={`workspace-remove-${i}`}
        />
      ))}
      <button
        className="btn btn--icon"
        onClick={() => cloneWorkspace()}
        title="Clone active workspace"
        data-testid="workspace-clone-btn"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="0.75" y="3.75" width="8.5" height="8.5" rx="1" />
          <path d="M3.75 3.75V2A1.25 1.25 0 0 1 5 .75h6A1.25 1.25 0 0 1 12.25 2v6A1.25 1.25 0 0 1 11 9.25H9.25" />
        </svg>
      </button>
      <button
        className="btn btn--icon"
        onClick={() => addWorkspace()}
        title="Add workspace"
        data-testid="workspace-add-btn"
      >
        +
      </button>
    </nav>
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
            points="15,3 25.4,9 25.4,21 15,27 4.6,21 4.6,9"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <line
            x1="15"
            y1="3"
            x2="15"
            y2="27"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1="25.4"
            y1="9"
            x2="4.6"
            y2="21"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1="25.4"
            y1="21"
            x2="4.6"
            y2="9"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
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
      {workspaceTabStrip}
      <div className="page-header__actions">
        <button onClick={copyForLLM} className={copiedLLM ? "btn is-success" : "btn"}>
          {copiedLLM ? "Copied!" : "Copy for LLM"}
        </button>
        <button
          onClick={() => setWorkspaceExportOpen(true)}
          className="btn"
          title="Export workspaces"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 1.5v8" />
            <path d="M3.5 6.5 7 10l3.5-3.5" />
            <path d="M1.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" />
          </svg>
          Export
        </button>
        <button
          onClick={() => setWorkspaceImportOpen(true)}
          className="btn"
          title="Import workspaces"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 9.5v-8" />
            <path d="M3.5 4.5 7 1l3.5 3.5" />
            <path d="M1.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" />
          </svg>
          Import
        </button>
        {tourDraft !== null ? (
          <>
            <button
              onClick={copyTourShareUrl}
              className={copiedTourShare ? "btn is-success" : "btn"}
            >
              {copiedTourShare ? "Copied!" : "Share Tour"}
            </button>
            {!tourAuthoringOpen && (
              <button onClick={() => setTourAuthoringOpen(true)} className="btn">
                Tour ›
              </button>
            )}
          </>
        ) : (
          <>
            <button onClick={copyShareUrl} className={copiedShare ? "btn is-success" : "btn"}>
              {copiedShare ? "Copied!" : "Share"}
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
        {authStatus === "authed" && (
          <span
            className={`sync-status sync-status--${syncStatus}`}
            title={
              syncStatus === "saving"
                ? "Saving…"
                : syncStatus === "error"
                  ? "Sync error"
                  : syncStatus === "offline"
                    ? "Offline"
                    : "Synced"
            }
            aria-label={`Sync: ${syncStatus}`}
          />
        )}
        {authStatus !== "loading" &&
          (authStatus === "anonymous" ? (
            <button onClick={login} className="btn">
              Sign in with GitHub
            </button>
          ) : (
            <div className="auth-user">
              {user?.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="auth-user__avatar"
                  width={24}
                  height={24}
                />
              )}
              <span className="auth-user__name">{user?.login}</span>
              <button onClick={() => void logout()} className="btn">
                Sign out
              </button>
            </div>
          ))}
        <button onClick={() => setAboutOpen(true)} className="btn" aria-label="About">
          ?
        </button>
      </div>
    </header>
  );

  // Modals reachable from globalHeader buttons — rendered in both the mobile
  // and desktop layouts since globalHeader itself is shared between them.
  const globalModals = (
    <>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {exportDialogOpen && (
        <ExportImageDialog
          onClose={() => setExportDialogOpen(false)}
          onChoose={handleExportSequence}
        />
      )}
      {workspaceExportOpen && (
        <ExportDialog workspaces={workspaces} onClose={() => setWorkspaceExportOpen(false)} />
      )}
      {workspaceImportOpen && <ImportDialog onClose={() => setWorkspaceImportOpen(false)} />}
    </>
  );

  // Creates a new workspace from the playback tour's base + tourDraft, exits playback.
  function handleOpenInWorkspace() {
    if (!playbackTour) return;
    const currentWorkspaces = useWorkspace.getState().workspaces;
    let n = 1;
    while (currentWorkspaces.some((ws) => ws.name === `Workspace ${n}`)) n++;
    const newWs: WorkspaceEntry = {
      name: `Workspace ${n}`,
      subgraphs: playbackTour.base.subgraphs,
      activeSubgraph: 0,
      queryTabs: playbackTour.base.queryTabs,
      activeQueryTab: playbackTour.base.activeQueryTab,
      seed: playbackTour.base.seed,
      mockConfig: playbackTour.base.mockConfig ?? "",
      tourDraft: playbackTour,
    };
    useWorkspace.setState({
      workspaces: [...currentWorkspaces, newWs],
      activeWorkspaceIndex: currentWorkspaces.length,
      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,
    });
    setPlaybackTour(null);
    setTourAuthoringOpen(true);
  }

  // Tour playback mode — render a completely separate layout.
  if (playbackError !== null) {
    return (
      <div className="tour-playback__error">
        <p>Could not load tour: {playbackError}</p>
      </div>
    );
  }
  if (playbackTour !== null) {
    return <TourPlayback tour={playbackTour} onOpenInWorkspace={handleOpenInWorkspace} />;
  }
  if (tourPreviewMode && tourDraft !== null) {
    return (
      <TourPlayback
        tour={tourDraft}
        initialStepIndex={tourActiveStep ?? 0}
        onExitPreview={() => setTourPreviewMode(false)}
      />
    );
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
                      path={`ws-${activeWorkspaceIndex}-mock-config.yaml`}
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
                      onMount={(ed) => {
                        mockConfigEditorRef.current = ed;
                        queryEditorRef.current = null; // the other editor just unmounted
                        attachVimOnMount(ed);
                      }}
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
                      path={`ws-${activeWorkspaceIndex}-query-${activeQueryTab}.graphql`}
                      value={currentQuery}
                      onChange={(v) => setQueryTabQuery(activeQueryTab, v ?? "")}
                      height="100%"
                      options={QUERY_EDITOR_OPTIONS}
                      theme={MONACO_THEME}
                      beforeMount={(m) => defineMonacoTheme(m)}
                      onMount={(ed) => {
                        queryEditorRef.current = ed;
                        mockConfigEditorRef.current = null; // the other editor just unmounted
                        attachVimOnMount(ed);
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
                <TabStrip tabs={outputTabs} />
                {compositionErrorContent ?? (
                  <>
                    {outputTab === "type-graph" && typeGraphContent}
                    {outputTab === "entities" && entitiesContent}
                    {outputTab === "sdl" && sdlContent}
                    {outputTab === "api-sdl" && apiSdlContent}
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
                <TabStrip
                  tabs={resultsTabs}
                  trailing={
                    resultsTab === "sequence" && (
                      <ExportImageButton
                        disabled={!canExportSequence}
                        error={exportError}
                        onClick={() => setExportDialogOpen(true)}
                        style={{ marginLeft: "auto" }}
                      />
                    )
                  }
                />
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
                <TourAuthoringPanel
                  onCollapse={() => setMobileTab("schema")}
                  onPreview={() => setTourPreviewMode(true)}
                />
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
        {globalModals}
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
                    <TabStrip
                      tabs={outputTabs}
                      trailing={
                        (outputTab === "type-graph" || outputTab === "entities") && (
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
                        )
                      }
                    />

                    {compositionErrorContent ?? (
                      <>
                        {outputTab === "type-graph" && typeGraphContent}
                        {outputTab === "entities" && entitiesContent}
                        {outputTab === "sdl" && sdlContent}
                        {outputTab === "api-sdl" && apiSdlContent}
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
                          path={`ws-${activeWorkspaceIndex}-mock-config.yaml`}
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
                          onMount={(ed) => {
                            mockConfigEditorRef.current = ed;
                            queryEditorRef.current = null; // the other editor just unmounted
                            attachVimOnMount(ed);
                          }}
                        />
                      </div>
                    ) : (
                      <div data-testid="query-editor" className="editor">
                        <Editor
                          language="graphql"
                          path={`ws-${activeWorkspaceIndex}-query-${activeQueryTab}.graphql`}
                          value={currentQuery}
                          onChange={(v) => setQueryTabQuery(activeQueryTab, v ?? "")}
                          height="100%"
                          options={QUERY_EDITOR_OPTIONS}
                          theme={MONACO_THEME}
                          beforeMount={(m) => defineMonacoTheme(m)}
                          onMount={(ed) => {
                            queryEditorRef.current = ed;
                            mockConfigEditorRef.current = null; // the other editor just unmounted
                            attachVimOnMount(ed);
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
                    <TabStrip
                      tabs={resultsTabs}
                      trailing={
                        <>
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
                          {resultsTab === "sequence" && (
                            <ExportImageButton
                              disabled={!canExportSequence}
                              error={exportError}
                              onClick={() => setExportDialogOpen(true)}
                            />
                          )}
                        </>
                      }
                    />
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
              <TourAuthoringPanel
                onCollapse={() => setTourAuthoringOpen(false)}
                onPreview={() => setTourPreviewMode(true)}
              />
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
          <button
            onClick={() => setVimMode(!vimMode)}
            aria-pressed={vimMode}
            className={vimMode ? "btn is-active" : "btn"}
            title="Toggle vim keybindings"
          >
            Vim
          </button>
          <div ref={vimStatusBarRef} className="vim-statusbar" />
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
              <div style={{ display: "flex", gap: 4 }}>
                {fullscreenTab === "sequence" && (
                  <ExportImageButton
                    disabled={!canExportSequence}
                    error={exportError}
                    onClick={() => setExportDialogOpen(true)}
                  />
                )}
                <button
                  className="btn btn--icon"
                  aria-label="Close full screen"
                  onClick={() => setFullscreenTab(null)}
                >
                  ×
                </button>
              </div>
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
      {globalModals}
    </>
  );
}
