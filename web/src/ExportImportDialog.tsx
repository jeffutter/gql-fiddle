import { useEffect, useState } from "react";
import { downloadBlob } from "./imageExport";
import { generateUUID, useWorkspace } from "./store";
import { decodeExport, type DecodedExport, type ExportedWorkspace, encodeExport } from "./share";
import type { WorkspaceEntry } from "./share";

const LARGE_FILE_BYTES = 10 * 1024 * 1024;

/** Escape-to-close, matching AboutModal/ExportImageDialog. */
function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Append " (imported)", " (imported 2)", ... until `name` doesn't collide
 * with any name in `existing`. */
function uniqueName(existing: Set<string>, name: string): string {
  if (!existing.has(name)) return name;
  let n = 1;
  let candidate = `${name} (imported)`;
  while (existing.has(candidate)) {
    n++;
    candidate = `${name} (imported ${n})`;
  }
  return candidate;
}

interface ExportDialogProps {
  workspaces: WorkspaceEntry[];
  onClose: () => void;
}

export function ExportDialog({ workspaces, onClose }: ExportDialogProps) {
  useEscapeToClose(onClose);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(workspaces.map((_, i) => i)));

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const download = () => {
    const chosen = workspaces.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    const bytes = encodeExport(chosen);
    // `bytes` is always backed by a plain ArrayBuffer (pako.gzip's own
    // allocation), never a SharedArrayBuffer — cast satisfies BlobPart's
    // stricter typing without an unnecessary copy.
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/gzip" });
    downloadBlob(blob, `gql-fiddle-export-${todayISODate()}.json.gz`);
    onClose();
  };

  return (
    <div className="fullscreen-modal-backdrop" onClick={onClose}>
      <div
        className="fullscreen-modal import-export-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
      >
        <div className="fullscreen-modal__header">
          <span className="fullscreen-modal__title" id="export-dialog-title">
            Export workspaces
          </span>
          <button className="btn btn--icon" onClick={onClose} aria-label="Close export dialog">
            ✕
          </button>
        </div>
        <div className="fullscreen-modal__body import-export-dialog__body">
          <p>Select which workspaces to include in the export file.</p>
          <div className="import-export-dialog__list">
            {workspaces.map((ws, i) => (
              <label className="import-export-dialog__item" key={i}>
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                {ws.name}
              </label>
            ))}
          </div>
          <div className="import-export-dialog__actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={download} disabled={selected.size === 0}>
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ImportDialogProps {
  onClose: () => void;
}

type ImportStep = "pick" | "select" | "error";

export function ImportDialog({ onClose }: ImportDialogProps) {
  useEscapeToClose(onClose);
  const [step, setStep] = useState<ImportStep>("pick");
  const [parsed, setParsed] = useState<DecodedExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [largeFileWarning, setLargeFileWarning] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const handleFile = async (file: File) => {
    setLargeFileWarning(file.size > LARGE_FILE_BYTES);
    try {
      const buf = await file.arrayBuffer();
      const decoded = decodeExport(new Uint8Array(buf));
      setParsed(decoded);
      setSelected(new Set(decoded.format.workspaces.map((_, i) => i)));
      setStep("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the export file");
      setStep("error");
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const doImport = () => {
    if (!parsed || selected.size === 0) {
      onClose();
      return;
    }
    const current = useWorkspace.getState().workspaces;
    const existingNames = new Set(current.map((ws) => ws.name));
    const chosen: ExportedWorkspace[] = parsed.format.workspaces.filter((_, i) => selected.has(i));
    const newEntries: WorkspaceEntry[] = chosen.map((ws) => {
      const name = uniqueName(existingNames, ws.name);
      existingNames.add(name);
      return {
        name,
        id: generateUUID(),
        version: 1,
        subgraphs: ws.subgraphs,
        activeSubgraph: ws.activeSubgraph,
        queryTabs: ws.queryTabs,
        activeQueryTab: ws.activeQueryTab,
        seed: ws.seed,
        mockConfig: ws.mockConfig,
        tourDraft: ws.tourDraft,
      };
    });
    useWorkspace.setState({
      workspaces: [...current, ...newEntries],
      activeWorkspaceIndex: current.length,
      supergraphSdl: null,
      composeErrors: null,
      composeHints: 0,
    });
    onClose();
  };

  const reset = () => {
    setParsed(null);
    setError(null);
    setLargeFileWarning(false);
    setSelected(new Set());
    setStep("pick");
  };

  return (
    <div className="fullscreen-modal-backdrop" onClick={onClose}>
      <div
        className="fullscreen-modal import-export-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
      >
        <div className="fullscreen-modal__header">
          <span className="fullscreen-modal__title" id="import-dialog-title">
            Import workspaces
          </span>
          <button className="btn btn--icon" onClick={onClose} aria-label="Close import dialog">
            ✕
          </button>
        </div>
        <div className="fullscreen-modal__body import-export-dialog__body">
          {step === "pick" && (
            <>
              <p>Choose a gql-fiddle export file (.json.gz or .json).</p>
              <input
                type="file"
                accept=".json,.json.gz,application/gzip,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </>
          )}
          {step === "error" && (
            <>
              <p role="alert">{error}</p>
              <div className="import-export-dialog__actions">
                <button className="btn" onClick={reset}>
                  Try again
                </button>
              </div>
            </>
          )}
          {step === "select" && parsed && (
            <>
              {largeFileWarning && (
                <p className="import-export-dialog__warning">
                  This file is large; parsing may take a moment.
                </p>
              )}
              {parsed.skippedCount > 0 && (
                <p className="import-export-dialog__warning">
                  {parsed.skippedCount} entr{parsed.skippedCount === 1 ? "y" : "ies"} skipped:
                  missing required fields.
                </p>
              )}
              <p>Select which workspaces to import.</p>
              <div className="import-export-dialog__list">
                {parsed.format.workspaces.map((ws, i) => (
                  <label className="import-export-dialog__item" key={i}>
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                    {ws.name}
                  </label>
                ))}
              </div>
              <div className="import-export-dialog__actions">
                <button className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button className="btn btn--primary" onClick={doImport}>
                  Import
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
