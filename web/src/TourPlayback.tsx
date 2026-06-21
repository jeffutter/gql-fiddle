import { useEffect, useMemo, useRef, useState } from "react";
import { useMobile } from "./hooks";
import Editor from "@monaco-editor/react";
import { initializeMode } from "monaco-graphql/initializeMode";
import type { MonacoGraphQLAPI } from "monaco-graphql";
import { loadCore } from "./core";
import { encode, resolveTourStep } from "./share";
import type { Tour } from "./share";
import type { ComposeResult, PlanResult } from "./core/types";
import { PlanTree } from "./PlanTree";
import { MONACO_THEME, defineMonacoTheme } from "./monacoTheme";
import type * as _monaco from "monaco-editor";
import { applyTourHighlight } from "./tourHighlight";
import type { TourHighlightHandle } from "./tourHighlight";

const COMPOSE_DEBOUNCE_MS = 300;
const AUTO_RUN_DEBOUNCE_MS = 400;

// localStorage key used to persist the onboarding hint dismissal across sessions.
const ONBOARDING_HINT_KEY = "gql-fiddle:tour-onboarding-dismissed";

// Singleton monaco-graphql API for the playback editor.
let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;

// Shared Monaco options for a clean, minimal read-only editor.
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

// Schema editor options — extends the shared base with glyph margin enabled so
// tour step highlight gutter dots are visible, and read-only mode.
const SCHEMA_EDITOR_OPTIONS: _monaco.editor.IStandaloneEditorConstructionOptions = {
  ...EDITOR_OPTIONS,
  glyphMargin: true,
  readOnly: true,
};

/**
 * Render a subset of Markdown to safe HTML: paragraphs, bold, italic,
 * inline code, and links. No external dependency — covers everything likely
 * to appear in tour prose.
 */
function renderMarkdown(prose: string): string {
  if (!prose) return "";
  return prose
    .split(/\n\n+/)
    .map((para) => {
      const inner = para
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
        )
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
      return `<p>${inner}</p>`;
    })
    .join("");
}

function ProseRenderer({ prose }: { prose: string }) {
  return (
    <div
      className="tour-playback__prose-content"
      // Safe: renderMarkdown produces a restricted subset of HTML with no
      // unsanitized user values beyond what the tour author wrote.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(prose) }}
    />
  );
}

interface TourPlaybackProps {
  tour: Tour;
}

/**
 * TourPlayback — reader-facing 3-pane layout for a decoded tour.
 *
 * Owns all playback state locally. Never reads from or writes to the global
 * Zustand workspace store. Replaces the normal fiddle when the URL hash
 * starts with `#t=`.
 */
export function TourPlayback({ tour }: TourPlaybackProps) {
  const isMobile = useMobile();
  const [mobileTab, setMobileTab] = useState<"tour" | "schema" | "plan">("tour");
  const [stepIndex, setStepIndex] = useState(0);
  const [activeSubgraph, setActiveSubgraph] = useState(0);
  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  // Schema editor instance and monaco — needed for tour step highlight decorations.
  const schemaEditorRef = useRef<_monaco.editor.IStandaloneCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<typeof _monaco | null>(null);
  // Handle for the tour step highlight decoration — disposed before each step transition.
  const tourHighlightHandleRef = useRef<TourHighlightHandle | null>(null);

  const composeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Onboarding hint: visible the first time a viewer enters playback mode.
  // The lazy initializer reads localStorage synchronously so there is no
  // flash-of-hint on repeat visits.
  const [showHint, setShowHint] = useState<boolean>(
    () => localStorage.getItem(ONBOARDING_HINT_KEY) !== "1",
  );

  function dismissHint() {
    localStorage.setItem(ONBOARDING_HINT_KEY, "1");
    setShowHint(false);
  }

  // Derive the resolved workspace for the current step.
  const workspace = useMemo(() => resolveTourStep(tour, stepIndex), [tour, stepIndex]);

  const activeStep = tour.steps[stepIndex];
  const subgraphs = workspace.subgraphs;
  const currentQuery = workspace.queryTabs[workspace.activeQueryTab]?.query ?? "";

  // Derive per-step pane visibility. Absence of a flag (undefined) defaults to
  // visible — only an explicit `false` hides the pane. This ensures tours
  // authored before this feature continue to show all panes unchanged.
  const schemaVisible = activeStep?.paneVisibility?.schema !== false;
  const planVisible = activeStep?.paneVisibility?.plan !== false;

  // Reset activeSubgraph to 0 when moving between steps (in case a new step
  // has fewer subgraphs than the previous one).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveSubgraph(0);
  }, [stepIndex]);

  // Keyboard navigation: ArrowRight advances, ArrowLeft retreats (AC#1–5).
  // Only registered when TourPlayback is mounted, so shortcuts are inherently
  // absent in authoring mode where this component is not rendered (AC#3).
  useEffect(() => {
    const stepCount = tour.steps.length;
    const handler = (e: KeyboardEvent) => {
      // AC#5 — skip when focus is inside any editable surface.
      const target = e.target as EventTarget | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        (target instanceof HTMLElement && target.closest(".monaco-editor"))
      )
        return;

      if (e.key === "ArrowRight") {
        // AC#1, AC#4 — advance; clamp at last step.
        setStepIndex((i) => Math.min(i + 1, stepCount - 1));
      } else if (e.key === "ArrowLeft") {
        // AC#2, AC#4 — retreat; clamp at first step.
        setStepIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tour.steps.length]);

  // Escape key dismisses the onboarding hint while it is visible.
  useEffect(() => {
    if (!showHint) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissHint();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showHint]);

  // When the active mobile tab becomes hidden on a step transition, fall back
  // to the "tour" (prose) tab which is always visible.
  useEffect(() => {
    if (mobileTab === "schema" && !schemaVisible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMobileTab("tour");
    }
    if (mobileTab === "plan" && !planVisible) {
      setMobileTab("tour");
    }
  }, [stepIndex, schemaVisible, planVisible, mobileTab]);

  // Apply tour step highlight decorations on the schema editor when the active
  // step or active subgraph changes. Mirrors the same logic in App.tsx.
  useEffect(() => {
    tourHighlightHandleRef.current?.dispose();
    tourHighlightHandleRef.current = null;

    const ed = schemaEditorRef.current;
    if (!ed || !monacoInstance) return;

    const step = tour.steps[stepIndex];
    if (!step) return;

    // If the anchor targets a different subgraph, switch to it first.
    // The effect will re-run after the state update.
    if (step.anchor && step.anchor.subgraphIndex !== activeSubgraph) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveSubgraph(step.anchor.subgraphIndex);
      return;
    }

    const currentSdl = subgraphs[activeSubgraph]?.sdl ?? "";
    const prevPayload = stepIndex > 0 ? resolveTourStep(tour, stepIndex - 1) : tour.base;
    const prevSdl = prevPayload.subgraphs[activeSubgraph]?.sdl ?? "";

    tourHighlightHandleRef.current = applyTourHighlight(
      ed,
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
  }, [monacoInstance, stepIndex, activeSubgraph, tour, subgraphs]);

  // Debounced composition effect — mirrors App.tsx but drives from workspace.
  useEffect(() => {
    if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompose(null);
    setPlanResult(null);
    composeTimeoutRef.current = setTimeout(async () => {
      const core = await loadCore();
      const result = core.compose(subgraphs);
      if (result.ok) {
        if (!monacoGraphQLAPI) {
          monacoGraphQLAPI = initializeMode();
        }
        monacoGraphQLAPI.setModeConfiguration({
          completionItems: false,
          diagnostics: false,
          hovers: true,
          documentSymbols: false,
          documentFormattingEdits: false,
        });
        monacoGraphQLAPI.setSchemaConfig([
          {
            documentString: result.api_schema_sdl,
            uri: "api-schema.graphql",
            fileMatch: ["**/*.graphql"],
          },
        ]);
      }
      setCompose(result);
    }, COMPOSE_DEBOUNCE_MS);
    return () => {
      if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
    };
  }, [subgraphs]);

  // Auto-run effect — runs the plan whenever the query or supergraph changes.
  useEffect(() => {
    if (compose === null || !compose.ok) return;
    const supergraphSdl = compose.supergraph_sdl;
    if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    autoRunTimeoutRef.current = setTimeout(async () => {
      const core = await loadCore();
      const result = core.plan(supergraphSdl, currentQuery);
      setPlanResult(result);
    }, AUTO_RUN_DEBOUNCE_MS);
    return () => {
      if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    };
  }, [currentQuery, compose]);

  function openInFiddle() {
    const payload = resolveTourStep(tour, stepIndex);
    const hash = encode(payload);
    window.location.hash = hash;
    window.location.reload();
  }

  const totalSteps = tour.steps.length;

  if (isMobile) {
    return (
      <div className="tour-playback tour-playback--mobile" data-testid="tour-playback">
        <header className="tour-playback__header tour-playback__header--mobile">
          <span className="tour-playback__title" data-testid="tour-title">
            {tour.title}
          </span>
          <div className="tour-playback__nav">
            <button
              className="btn"
              onClick={() => setStepIndex((i) => i - 1)}
              disabled={stepIndex === 0}
              aria-label="Previous step"
            >
              ← Prev
            </button>
            <span className="tour-playback__counter" data-testid="step-counter">
              {stepIndex + 1} / {totalSteps}
            </span>
            <button
              className="btn"
              onClick={() => setStepIndex((i) => i + 1)}
              disabled={stepIndex === totalSteps - 1}
              aria-label="Next step"
            >
              Next →
            </button>
          </div>
          <button className="btn btn--primary" onClick={openInFiddle}>
            Open in Fiddle
          </button>
        </header>

        <div className="tour-playback__mobile-content">
          {showHint && (
            <div
              className="tour-onboarding-hint"
              role="status"
              aria-live="polite"
              data-testid="onboarding-hint"
            >
              <span className="tour-onboarding-hint__body">
                Use the <strong>← Prev</strong> / <strong>Next →</strong> buttons or <kbd>←</kbd>{" "}
                <kbd>→</kbd> arrow keys to navigate steps.
              </span>
              <button
                className="btn btn--icon tour-onboarding-hint__dismiss"
                onClick={dismissHint}
                aria-label="Dismiss navigation hint"
                data-testid="onboarding-hint-dismiss"
              >
                ✕
              </button>
            </div>
          )}
          {mobileTab === "tour" && (
            <div className="tour-playback__prose-panel">
              {activeStep?.label && (
                <h2 className="tour-playback__step-label" data-testid="step-label">
                  {activeStep.label}
                </h2>
              )}
              <ProseRenderer prose={activeStep?.prose ?? ""} />
            </div>
          )}
          {mobileTab === "schema" && schemaVisible && (
            <div className="tour-playback__schema-panel">
              <nav className="tab-strip" aria-label="Subgraph tabs">
                {subgraphs.map((sg, i) => (
                  <button
                    key={i}
                    className={i === activeSubgraph ? "tab is-active" : "tab"}
                    onClick={() => setActiveSubgraph(i)}
                    aria-pressed={i === activeSubgraph}
                  >
                    {sg.name}
                  </button>
                ))}
              </nav>
              <div className="editor" style={{ flex: 1, minHeight: 0 }}>
                <Editor
                  path={`playback-sg-${stepIndex}-${activeSubgraph}`}
                  value={subgraphs[activeSubgraph]?.sdl ?? ""}
                  language="graphql"
                  height="100%"
                  theme={MONACO_THEME}
                  beforeMount={(m) => defineMonacoTheme(m)}
                  options={SCHEMA_EDITOR_OPTIONS}
                  onMount={(ed, m) => {
                    schemaEditorRef.current = ed as _monaco.editor.IStandaloneCodeEditor;
                    setMonacoInstance(m as typeof _monaco);
                  }}
                />
              </div>
            </div>
          )}
          {mobileTab === "plan" && planVisible && (
            <div className="tour-playback__plan-panel tour-playback__plan-panel--mobile">
              <h2 className="section-title">Query Plan</h2>
              {compose === null ? (
                <p className="empty-state">Composing…</p>
              ) : !compose.ok ? (
                <div className="callout callout--error">
                  {compose.errors.map((e, i) => (
                    <p key={i}>{e.message}</p>
                  ))}
                </div>
              ) : planResult === null ? (
                <p className="empty-state">Planning…</p>
              ) : planResult.ok ? (
                <div className="scroll">
                  <PlanTree node={planResult.query_plan} />
                </div>
              ) : (
                <div className="callout callout--error">
                  {planResult.errors.map((e, i) => (
                    <p key={i}>{e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="mobile-tabbar">
          <button
            className={mobileTab === "tour" ? "mobile-tab is-active" : "mobile-tab"}
            aria-pressed={mobileTab === "tour"}
            onClick={() => setMobileTab("tour")}
          >
            Tour
          </button>
          {schemaVisible && (
            <button
              className={mobileTab === "schema" ? "mobile-tab is-active" : "mobile-tab"}
              aria-pressed={mobileTab === "schema"}
              onClick={() => setMobileTab("schema")}
            >
              Schema
            </button>
          )}
          {planVisible && (
            <button
              className={mobileTab === "plan" ? "mobile-tab is-active" : "mobile-tab"}
              aria-pressed={mobileTab === "plan"}
              onClick={() => setMobileTab("plan")}
            >
              Plan
            </button>
          )}
        </nav>
      </div>
    );
  }

  return (
    <div className="tour-playback" data-testid="tour-playback">
      <header className="tour-playback__header">
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

        <span className="tour-playback__title" data-testid="tour-title">
          {tour.title}
        </span>

        <div className="tour-playback__nav">
          <button
            className="btn"
            onClick={() => setStepIndex((i) => i - 1)}
            disabled={stepIndex === 0}
            aria-label="Previous step"
          >
            ← Prev
          </button>
          <span className="tour-playback__counter" data-testid="step-counter">
            {stepIndex + 1} / {totalSteps}
          </span>
          <button
            className="btn"
            onClick={() => setStepIndex((i) => i + 1)}
            disabled={stepIndex === totalSteps - 1}
            aria-label="Next step"
          >
            Next →
          </button>
        </div>

        <button className="btn btn--primary" onClick={openInFiddle}>
          Open in Fiddle
        </button>
      </header>

      <div className="tour-playback__body">
        {/* Left: prose panel */}
        <div className="tour-playback__prose-panel">
          {showHint && (
            <div
              className="tour-onboarding-hint"
              role="status"
              aria-live="polite"
              data-testid="onboarding-hint"
            >
              <span className="tour-onboarding-hint__body">
                Use the <strong>← Prev</strong> / <strong>Next →</strong> buttons or <kbd>←</kbd>{" "}
                <kbd>→</kbd> arrow keys to navigate steps.
              </span>
              <button
                className="btn btn--icon tour-onboarding-hint__dismiss"
                onClick={dismissHint}
                aria-label="Dismiss navigation hint"
                data-testid="onboarding-hint-dismiss"
              >
                ✕
              </button>
            </div>
          )}
          {activeStep?.label && (
            <h2 className="tour-playback__step-label" data-testid="step-label">
              {activeStep.label}
            </h2>
          )}
          <ProseRenderer prose={activeStep?.prose ?? ""} />
        </div>

        {/* Right column: schema editor (top) + query plan (bottom) */}
        <div
          className={
            !schemaVisible && !planVisible
              ? "tour-playback__right tour-playback__right--hidden"
              : "tour-playback__right"
          }
        >
          {/* Schema editor — read-only; hidden when current step sets schema: false */}
          {schemaVisible && (
            <div className="tour-playback__schema-panel">
              <nav className="tab-strip" aria-label="Subgraph tabs">
                {subgraphs.map((sg, i) => (
                  <button
                    key={i}
                    className={i === activeSubgraph ? "tab is-active" : "tab"}
                    onClick={() => setActiveSubgraph(i)}
                    aria-pressed={i === activeSubgraph}
                  >
                    {sg.name}
                  </button>
                ))}
              </nav>
              <div className="editor" style={{ flex: 1, minHeight: 0 }}>
                <Editor
                  path={`playback-sg-${stepIndex}-${activeSubgraph}`}
                  value={subgraphs[activeSubgraph]?.sdl ?? ""}
                  language="graphql"
                  height="100%"
                  theme={MONACO_THEME}
                  beforeMount={(m) => defineMonacoTheme(m)}
                  options={SCHEMA_EDITOR_OPTIONS}
                  onMount={(ed, m) => {
                    schemaEditorRef.current = ed as _monaco.editor.IStandaloneCodeEditor;
                    setMonacoInstance(m as typeof _monaco);
                  }}
                />
              </div>
            </div>
          )}

          {/* Query plan — hidden when current step sets plan: false */}
          {planVisible && (
            <div className="tour-playback__plan-panel">
              <h2 className="section-title">Query Plan</h2>
              {compose === null ? (
                <p className="empty-state">Composing…</p>
              ) : !compose.ok ? (
                <div className="callout callout--error">
                  {compose.errors.map((e, i) => (
                    <p key={i}>{e.message}</p>
                  ))}
                </div>
              ) : planResult === null ? (
                <p className="empty-state">Planning…</p>
              ) : planResult.ok ? (
                <div className="scroll">
                  <PlanTree node={planResult.query_plan} />
                </div>
              ) : (
                <div className="callout callout--error">
                  {planResult.errors.map((e, i) => (
                    <p key={i}>{e.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
