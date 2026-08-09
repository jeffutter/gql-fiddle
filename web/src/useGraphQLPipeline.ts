import { useCallback, useEffect, useRef, useState } from "react";
import * as _monaco from "monaco-editor";
import * as jsYaml from "js-yaml";
import { loadCore } from "./core";
import type {
  ComposeResult,
  Diagnostic,
  MockResult,
  PlanResult,
  SubgraphInput,
} from "./core/types";
import { useWorkspace } from "./store";

const COMPOSE_DEBOUNCE_MS = 300;
const AUTO_RUN_DEBOUNCE_MS = 400;

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

/**
 * Owns the compose/validate/plan/run pipeline: debounced composition,
 * auto-run-on-change, and the debounced subgraph/query validation effects,
 * plus the manual `runQuery()` entry point used by the Run button.
 *
 * This hook is deliberately decoupled from Monaco: it has no knowledge of
 * the monaco-graphql singleton. Callers that need to register the composed
 * API schema with Monaco (see `useMonacoGraphQL`) should react to the
 * returned `compose` value themselves, e.g.:
 *
 * ```
 * const { compose, ... } = useGraphQLPipeline({ ... });
 * const { registerSchema } = useMonacoGraphQL(compose);
 * useEffect(() => {
 *   if (compose) registerSchema(compose.ok ? compose.api_schema_sdl : null);
 * }, [compose, registerSchema]);
 * ```
 */
export function useGraphQLPipeline(params: {
  subgraphs: SubgraphInput[];
  activeSubgraph: number;
  supergraphSdl: string | null;
  currentQuery: string;
  seed: number;
  mockConfig: string;
  editor: _monaco.editor.IStandaloneCodeEditor | null;
  monacoInstance: typeof _monaco | null;
  activeWorkspaceIndex: number;
  activeQueryTab: number;
}): {
  compose: ComposeResult | null;
  planResult: PlanResult | null;
  mockResult: MockResult | null;
  isRunning: boolean;
  configError: string | null;
  runQuery: () => void;
} {
  const {
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
  } = params;

  const [compose, setCompose] = useState<ComposeResult | null>(null);
  const [mockResult, setMockResult] = useState<MockResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped at the start of every debounce cycle; a callback that resumes after
  // `await loadCore()` compares its captured generation against the current
  // value to detect whether a newer compose has already superseded it.
  const composeGenerationRef = useRef(0);

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

  const doRun = useCallback(
    async (query: string, sdl: string, s: number) => {
      const core = await loadCore();
      const mockConfigJson = parseYamlToJson(mockConfig);
      const [execResult, plan] = await Promise.all([
        Promise.resolve(core.executeMock(sdl, query, s, mockConfigJson)),
        Promise.resolve(core.plan(sdl, query)),
      ]);
      setMockResult(execResult);
      setPlanResult(plan);
      setIsRunning(false);
    },
    [mockConfig],
  );

  // Debounced composition effect.
  useEffect(() => {
    if (composeTimeoutRef.current) clearTimeout(composeTimeoutRef.current);
    composeTimeoutRef.current = setTimeout(async () => {
      const generation = ++composeGenerationRef.current;
      const core = await loadCore();
      // A newer compose started (and possibly finished) while we were
      // awaiting loadCore(); discard this stale result so it can't
      // double-init the singleton or clobber a fresher schema.
      if (generation !== composeGenerationRef.current) return;
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

  // Auto-run effect: re-executes the query whenever inputs change.
  useEffect(() => {
    if (supergraphSdl === null) return;
    if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    const sdl = supergraphSdl;
    autoRunTimeoutRef.current = setTimeout(() => {
      setIsRunning(true);
      void doRun(currentQuery, sdl, seed);
    }, AUTO_RUN_DEBOUNCE_MS);
    return () => {
      if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    };
  }, [currentQuery, supergraphSdl, seed, doRun]);

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
        const uri = monacoInstance.Uri.parse(
          `inmemory://model/ws-${activeWorkspaceIndex}-query-${activeQueryTab}.graphql`,
        );
        const model = monacoInstance.editor.getModel(uri);
        if (model) {
          // A schemaError means the fault is in the schema/supergraph, not
          // this query — don't paint it onto the query editor. Just clear
          // any stale query-validation markers (TASK-104).
          if ("schemaError" in result) {
            console.debug("validateQuery: schema error, not a query fault:", result.schemaError);
          }
          const markers =
            "schemaError" in result
              ? []
              : result.diagnostics.map((d) => diagnosticToMarker(d, monacoInstance));
          monacoInstance.editor.setModelMarkers(model, "query-validation", markers);
        }
      })();
    }, 300);
    return () => {
      if (queryTimeoutRef.current) clearTimeout(queryTimeoutRef.current);
    };
  }, [monacoInstance, supergraphSdl, currentQuery, activeQueryTab, activeWorkspaceIndex]);

  function runQuery() {
    if (supergraphSdl === null) return;
    if (autoRunTimeoutRef.current) clearTimeout(autoRunTimeoutRef.current);
    setIsRunning(true);
    void doRun(currentQuery, supergraphSdl, seed);
  }

  return { compose, planResult, mockResult, isRunning, configError, runQuery };
}
