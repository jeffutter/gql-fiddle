import { useEffect } from "react";

interface Props {
  onClose: () => void;
  onChoose: (format: "svg" | "png") => void;
  title?: string;
}

/**
 * Small format-choice dialog for image export (SVG vs PNG). Mirrors AboutModal's
 * structure/classes; intentionally generic (no tab-specific text) so any visual
 * tab can reuse it.
 */
export function ExportImageDialog({ onClose, onChoose, title = "Export image" }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const choose = (format: "svg" | "png") => {
    onChoose(format);
    onClose();
  };

  return (
    <div className="fullscreen-modal-backdrop" onClick={onClose}>
      <div
        className="fullscreen-modal export-image-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-image-title"
      >
        <div className="fullscreen-modal__header">
          <span className="fullscreen-modal__title" id="export-image-title">
            {title}
          </span>
          <button className="btn btn--icon" onClick={onClose} aria-label="Close export dialog">
            ✕
          </button>
        </div>
        <div className="fullscreen-modal__body export-image-dialog__body">
          <p className="export-image-dialog__prompt">Choose a format to download:</p>
          <div className="export-image-dialog__actions">
            <button className="btn btn--primary" onClick={() => choose("svg")}>
              SVG
            </button>
            <button className="btn btn--primary" onClick={() => choose("png")}>
              PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
