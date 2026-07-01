import { useEffect, useRef } from "react";
import * as _monaco from "monaco-editor";
import { loadCore } from "./core";
import { resolveTourStep } from "./share";
import type { Tour } from "./share";
import { applyTourHighlight } from "./tourHighlight";
import type { TourHighlightHandle } from "./tourHighlight";
import type { SubgraphInput } from "./core/types";
import { activeWorkspace, useWorkspace } from "./store";

/**
 * Wires up the three tour-authoring editor effects on the schema editor:
 * click-to-anchor (onMouseDown), the anchor gutter/line decoration, and the
 * tour-step highlight (diff between the current and previous step's SDL).
 * All three effects share ref-based decoration/disposable bookkeeping that's
 * private to this interaction, so it's encapsulated here rather than in
 * App.tsx.
 */
export function useTourAuthoringDecorations(params: {
  editor: _monaco.editor.IStandaloneCodeEditor | null;
  monacoInstance: typeof _monaco | null;
  tourDraft: Tour | null;
  tourActiveStep: number | null;
  activeSubgraph: number;
  tourAuthoringOpen: boolean;
  subgraphs: SubgraphInput[];
  setStepAnchor: (
    stepIndex: number,
    anchor: { subgraphIndex: number; typeName: string; fieldName?: string } | undefined,
  ) => void;
  setActiveSubgraph: (index: number) => void;
}): void {
  const {
    editor,
    monacoInstance,
    tourDraft,
    tourActiveStep,
    activeSubgraph,
    tourAuthoringOpen,
    subgraphs,
    setStepAnchor,
    setActiveSubgraph,
  } = params;

  // Monaco decoration collection for the tour anchor indicator on the schema editor.
  const anchorDecorationRef = useRef<ReturnType<
    _monaco.editor.IStandaloneCodeEditor["createDecorationsCollection"]
  > | null>(null);
  // Disposable for the onMouseDown listener — needed to clean it up when authoring mode exits.
  const anchorMouseListenerRef = useRef<_monaco.IDisposable | null>(null);
  // Handle for the tour step highlight decoration — disposed before each step transition.
  const tourHighlightHandleRef = useRef<TourHighlightHandle | null>(null);

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
        const currentAnchor = activeWorkspace(useWorkspace.getState()).tourDraft?.steps[
          tourActiveStep
        ]?.anchor;
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
        if (new RegExp(`^(type|interface|union)\\s+${anchor.typeName}[\\s{@]`).test(lines[i])) {
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
}
