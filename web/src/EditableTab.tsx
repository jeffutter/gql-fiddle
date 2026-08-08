import { useState } from "react";

export interface EditableTabProps {
  name: string;
  active: boolean;
  onSelect: () => void;
  onRename: (newName: string) => void;
  onRemove: () => void;
  /** Whether double-click-to-rename is allowed. Defaults to true. */
  canRename?: boolean;
  testId?: string;
  removeAriaLabel?: string;
  removeTestId?: string;
  /** Current saved state. Only meaningful when onToggleSaved is provided. */
  saved?: boolean;
  /** Toggles saved state. Omit entirely to hide the save affordance (e.g.
   *  anonymous users, or tab strips that don't support saving). */
  onToggleSaved?: () => void;
  saveAriaLabel?: string;
  saveTestId?: string;
}

/**
 * A tab button with rename-on-double-click and a close (×) affordance,
 * matching the subgraph/query/workspace tab strips. Rename state
 * (renaming / draft value) is self-contained; callers only see the
 * committed name via `onRename`.
 */
export function EditableTab({
  name,
  active,
  onSelect,
  onRename,
  onRemove,
  canRename = true,
  testId,
  removeAriaLabel,
  removeTestId,
  saved,
  onToggleSaved,
  saveAriaLabel,
  saveTestId,
}: EditableTabProps) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(name);

  function commit() {
    const trimmed = value.trim();
    if (trimmed) onRename(trimmed);
    setRenaming(false);
  }

  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={active ? "tab is-active" : "tab"}
      data-testid={testId}
    >
      {renaming ? (
        <input
          value={value}
          autoFocus
          size={Math.max(value.length, 3)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
            } else if (e.key === "Escape") {
              setRenaming(false);
            }
            e.stopPropagation();
          }}
          className="tab__rename"
        />
      ) : (
        <span
          onDoubleClick={(e) => {
            if (!canRename) return;
            e.stopPropagation();
            setValue(name);
            setRenaming(true);
          }}
          title={canRename ? "Double-click to rename" : undefined}
        >
          {name}
        </span>
      )}
      {onToggleSaved && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleSaved();
          }}
          className={saved ? "tab__save is-saved" : "tab__save"}
          role="button"
          aria-pressed={saved}
          aria-label={saveAriaLabel}
          data-testid={saveTestId}
          title={saved ? "Saved — click to unsave" : "Click to save"}
        >
          {saved ? "★" : "☆"}
        </span>
      )}
      <span
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="tab__close"
        aria-label={removeAriaLabel}
        data-testid={removeTestId}
      >
        ×
      </span>
    </button>
  );
}
