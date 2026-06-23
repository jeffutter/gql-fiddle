import { useState } from "react";
import { useWorkspace } from "./store";
import { encodeTour } from "./share";
import type { PaneId } from "./share";
import { resolveTourStep } from "./share";

interface TourAuthoringPanelProps {
  onCollapse: () => void;
  onPreview: () => void;
}

/**
 * TourAuthoringPanel — sidebar panel for building a guided tour.
 *
 * Reads from and writes to the global workspace store. No props carry data —
 * all state comes from useWorkspace.
 */
export function TourAuthoringPanel({ onCollapse, onPreview }: TourAuthoringPanelProps) {
  const {
    tourDraft,
    setTourDraft,
    tourActiveStep,
    setTourActiveStep,
    loadTourStep,
    snapshotCurrentToStep,
    setStepAnchor,
    setStepPaneVisibility,
  } = useWorkspace();

  // Track which step's prose textarea is expanded for editing.
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  if (!tourDraft) return null;
  // Narrowed local — TypeScript can't narrow through closures when a variable
  // is a hook read, so we capture the guaranteed-non-null value here.
  const draft = tourDraft;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Navigate to a step, autosaving the current step first. */
  function navigateToStep(targetIndex: number) {
    if (tourActiveStep !== null) {
      snapshotCurrentToStep(tourActiveStep);
    }
    loadTourStep(targetIndex);
    setTourActiveStep(targetIndex);
    setEditingStepIndex(targetIndex);
  }

  /** Restore the base workspace (used when exiting or after deleting last step). */
  function restoreBase() {
    useWorkspace.setState({
      subgraphs: draft.base.subgraphs,
      queryTabs: draft.base.queryTabs,
      activeQueryTab: draft.base.activeQueryTab,
      seed: draft.base.seed,
    });
  }

  // ── Tour-level actions ──────────────────────────────────────────────────────

  function handleTitleChange(newTitle: string) {
    setTourDraft({ ...draft, title: newTitle });
  }

  function handleExitTour() {
    if (!window.confirm("Exit tour authoring? The tour draft will be cleared.")) return;
    restoreBase();
    setTourActiveStep(null);
    setTourDraft(null);
  }

  // ── Step actions ────────────────────────────────────────────────────────────

  function handleAddStep() {
    snapshotCurrentToStep("new");
    const newIndex = draft.steps.length; // will be the new step's index
    setTourActiveStep(newIndex);
    setEditingStepIndex(newIndex);
  }

  function handleSaveStep(stepIndex: number) {
    snapshotCurrentToStep(stepIndex);
  }

  function handleStepLabelChange(stepIndex: number, label: string) {
    const updatedSteps = draft.steps.map((s, i) => (i === stepIndex ? { ...s, label } : s));
    setTourDraft({ ...draft, steps: updatedSteps });
  }

  function handleStepProseChange(stepIndex: number, prose: string) {
    const updatedSteps = draft.steps.map((s, i) => (i === stepIndex ? { ...s, prose } : s));
    setTourDraft({ ...draft, steps: updatedSteps });
  }

  function handleMoveUp(stepIndex: number) {
    if (stepIndex === 0) return;
    const steps = [...draft.steps];
    [steps[stepIndex - 1], steps[stepIndex]] = [steps[stepIndex], steps[stepIndex - 1]];
    // Adjust tourActiveStep if needed.
    let newActive = tourActiveStep;
    if (tourActiveStep === stepIndex) newActive = stepIndex - 1;
    else if (tourActiveStep === stepIndex - 1) newActive = stepIndex;
    setTourDraft({ ...draft, steps });
    if (newActive !== tourActiveStep) setTourActiveStep(newActive);
    if (editingStepIndex === stepIndex) setEditingStepIndex(stepIndex - 1);
    else if (editingStepIndex === stepIndex - 1) setEditingStepIndex(stepIndex);
  }

  function handleMoveDown(stepIndex: number) {
    if (stepIndex >= draft.steps.length - 1) return;
    const steps = [...draft.steps];
    [steps[stepIndex], steps[stepIndex + 1]] = [steps[stepIndex + 1], steps[stepIndex]];
    let newActive = tourActiveStep;
    if (tourActiveStep === stepIndex) newActive = stepIndex + 1;
    else if (tourActiveStep === stepIndex + 1) newActive = stepIndex;
    setTourDraft({ ...draft, steps });
    if (newActive !== tourActiveStep) setTourActiveStep(newActive);
    if (editingStepIndex === stepIndex) setEditingStepIndex(stepIndex + 1);
    else if (editingStepIndex === stepIndex + 1) setEditingStepIndex(stepIndex);
  }

  function handleDeleteStep(stepIndex: number) {
    const step = draft.steps[stepIndex];
    if (step.prose.trim().length > 0) {
      if (!window.confirm("Delete this step?")) return;
    }
    const newSteps = draft.steps.filter((_, i) => i !== stepIndex);
    setTourDraft({ ...draft, steps: newSteps });

    // Adjust active step after deletion.
    if (tourActiveStep !== null) {
      if (newSteps.length === 0) {
        setTourActiveStep(null);
        setEditingStepIndex(null);
        restoreBase();
      } else if (tourActiveStep === stepIndex) {
        const newActive = Math.min(stepIndex, newSteps.length - 1);
        setTourActiveStep(newActive);
        setEditingStepIndex(newActive);
        // Load the new active step's resolved workspace.
        const resolved = resolveTourStep({ ...draft, steps: newSteps }, newActive);
        useWorkspace.setState({
          subgraphs: resolved.subgraphs,
          queryTabs: resolved.queryTabs,
          activeQueryTab: resolved.activeQueryTab,
          seed: resolved.seed,
        });
      } else if (tourActiveStep > stepIndex) {
        setTourActiveStep(tourActiveStep - 1);
        if (editingStepIndex !== null && editingStepIndex > stepIndex) {
          setEditingStepIndex(editingStepIndex - 1);
        }
      }
    }
  }

  // ── Share ───────────────────────────────────────────────────────────────────

  function handleShareTour() {
    const hash = encodeTour(draft);
    const loc = window.location;
    const hostname =
      typeof loc.hostname === "string" && loc.hostname.length > 0 ? loc.hostname : "localhost";
    const port = typeof loc.port === "string" && loc.port.length > 0 ? loc.port : "";
    const origin = loc.origin || `http://${hostname}${port ? `:${port}` : ""}`;
    const shareUrl = origin + window.location.pathname + hash;

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(shareUrl).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 1500);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = shareUrl;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="tour-panel">
      {/* Panel header: title, collapse, exit */}
      <div className="tour-panel__header">
        <input
          className="tour-panel__title-input"
          value={draft.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Tour title"
          aria-label="Tour title"
        />
        <button className="btn" onClick={onPreview} title="Preview tour" aria-label="Preview tour">
          Preview
        </button>
        <button
          className="btn btn--icon"
          onClick={onCollapse}
          title="Collapse tour panel"
          aria-label="Collapse tour panel"
        >
          ›
        </button>
        <button className="btn" onClick={handleExitTour} title="Exit tour authoring">
          Exit
        </button>
      </div>

      {/* Steps list */}
      <div className="tour-panel__steps">
        {draft.steps.length === 0 && (
          <p className="tour-panel__empty">No steps yet. Click "Add Step" to get started.</p>
        )}
        {draft.steps.map((step, i) => {
          const isActive = tourActiveStep === i;
          const isEditing = editingStepIndex === i;
          return (
            <div key={i} className={isActive ? "tour-step tour-step--active" : "tour-step"}>
              {/* Step header row */}
              <div className="tour-step__header">
                <span className="tour-step__index">{i + 1}</span>
                <input
                  className="tour-step__label"
                  value={step.label}
                  onChange={(e) => handleStepLabelChange(i, e.target.value)}
                  onClick={() => {
                    if (!isActive) navigateToStep(i);
                  }}
                  aria-label={`Step ${i + 1} label`}
                />
                <div className="tour-step__controls">
                  <button
                    className="btn btn--icon"
                    onClick={() => handleMoveUp(i)}
                    disabled={i === 0}
                    title="Move step up"
                    aria-label="Move step up"
                  >
                    ↑
                  </button>
                  <button
                    className="btn btn--icon"
                    onClick={() => handleMoveDown(i)}
                    disabled={i === draft.steps.length - 1}
                    title="Move step down"
                    aria-label="Move step down"
                  >
                    ↓
                  </button>
                  <button
                    className="btn btn--icon"
                    onClick={() => setEditingStepIndex(isEditing ? null : i)}
                    title={isEditing ? "Collapse prose" : "Edit prose"}
                    aria-label={isEditing ? "Collapse prose" : "Edit prose"}
                    aria-pressed={isEditing}
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn--icon tour-step__delete"
                    onClick={() => handleDeleteStep(i)}
                    title="Delete step"
                    aria-label="Delete step"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Prose textarea — shown when this step is expanded for editing */}
              {isEditing && (
                <textarea
                  className="tour-step__prose"
                  value={step.prose}
                  onChange={(e) => handleStepProseChange(i, e.target.value)}
                  placeholder="Step description (optional)"
                  rows={4}
                  aria-label={`Step ${i + 1} prose`}
                />
              )}

              {/* Anchor display — only shown for the active step */}
              {isActive && (
                <div className="tour-step__anchor">
                  {step.anchor ? (
                    <>
                      <span className="tour-step__anchor-label">
                        {step.anchor.fieldName
                          ? `${step.anchor.typeName}.${step.anchor.fieldName}`
                          : step.anchor.typeName}
                      </span>
                      <button
                        className="btn btn--icon tour-step__anchor-clear"
                        onClick={() => setStepAnchor(i, undefined)}
                        title="Clear anchor"
                        aria-label="Clear anchor"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span className="tour-step__anchor-empty">
                      Click a type or field in the schema editor to set an anchor
                    </span>
                  )}
                </div>
              )}

              {/* Pane visibility toggles — only shown for the active step */}
              {isActive && (
                <div className="tour-step__pane-visibility">
                  <span className="tour-step__pane-visibility-label">Visible panes:</span>
                  {(["schema", "plan"] as PaneId[]).map((pane) => {
                    const checked = step.paneVisibility?.[pane] !== false;
                    return (
                      <label key={pane} className="tour-step__pane-toggle">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setStepPaneVisibility(i, pane, e.target.checked)}
                          aria-label={`Show ${pane} pane for step ${i + 1}`}
                        />
                        {pane === "schema" ? "Schema" : "Query Plan"}
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Save Step button — only shown for the active step */}
              {isActive && (
                <div className="tour-step__actions">
                  <button
                    className="btn btn--primary"
                    onClick={() => handleSaveStep(i)}
                    title="Save current workspace state into this step"
                  >
                    Save Step
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Step + Share Tour */}
      <div className="tour-panel__footer">
        <button className="btn tour-panel__add" onClick={handleAddStep}>
          + Add Step
        </button>
        <button
          className={shareCopied ? "btn is-success tour-panel__share" : "btn tour-panel__share"}
          onClick={handleShareTour}
        >
          {shareCopied ? "Copied!" : "Share Tour"}
        </button>
      </div>
    </div>
  );
}
