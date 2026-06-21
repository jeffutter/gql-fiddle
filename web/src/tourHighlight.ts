/**
 * tourHighlight.ts — Tour step highlight system.
 *
 * Pure utility module (no React imports). Applies Monaco editor decorations
 * when the active tour step changes, in two priority modes:
 *
 *   1. Anchor-based: step.anchor is set → find the type/field line, apply
 *      gutter dot + line background, auto-scroll to it.
 *   2. Diff-based: no anchor → text-diff currentSdl vs prevSdl, highlight
 *      changed lines with the same visual treatment.
 *   3. No-op: neither condition applies → return a no-op handle (no decoration).
 *
 * The caller must call dispose() on the returned handle before applying a new
 * highlight so stale decorations never accumulate.
 */

import type * as Monaco from "monaco-editor";
import type { TourStep } from "./share";

export interface TourHighlightHandle {
  /** Remove the decoration managed by this handle. */
  dispose: () => void;
}

/** A no-op handle returned when there is nothing to decorate. */
const NO_OP_HANDLE: TourHighlightHandle = { dispose: () => {} };

/**
 * Scan SDL lines for the 1-based line number of a type or field declaration.
 *
 * If `fieldName` is provided, looks for the field inside the named type block.
 * Otherwise looks for the type/interface declaration itself.
 *
 * Returns null if not found.
 */
function findAnchorLine(lines: string[], typeName: string, fieldName?: string): number | null {
  if (fieldName) {
    let inType = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(type|interface)\s+\w/.test(line) && line.includes(typeName)) {
        inType = true;
      } else if (inType && /^\}/.test(line)) {
        inType = false;
      } else if (inType) {
        const fieldPattern = new RegExp(`^\\s+${fieldName}\\s*[:(]`);
        if (fieldPattern.test(line)) {
          return i + 1; // Monaco lines are 1-based
        }
      }
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^(type|interface)\\s+${typeName}[\\s{@]`).test(lines[i])) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Compute 1-based line numbers that appear in `currentLines` but not in
 * `prevLineSet` (the Set of lines from the previous SDL). This identifies
 * new or changed lines between steps.
 */
function diffLines(currentLines: string[], prevLineSet: Set<string>): number[] {
  const changed: number[] = [];
  for (let i = 0; i < currentLines.length; i++) {
    if (!prevLineSet.has(currentLines[i])) {
      changed.push(i + 1); // 1-based
    }
  }
  return changed;
}

/**
 * Apply tour-step highlight decorations to a Monaco editor.
 *
 * Priority:
 *   1. Anchor-based when step.anchor.subgraphIndex === activeSubgraphIndex
 *   2. Diff-based when no matching anchor
 *   3. No-op when SDL is unchanged
 *
 * The caller is responsible for calling dispose() on the returned handle
 * before the next invocation to prevent stale decoration accumulation.
 */
export function applyTourHighlight(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  step: TourStep,
  currentSdl: string,
  prevSdl: string,
  activeSubgraphIndex: number,
): TourHighlightHandle {
  // ── Anchor-based path ──────────────────────────────────────────────────────
  if (step.anchor && step.anchor.subgraphIndex === activeSubgraphIndex) {
    const { typeName, fieldName } = step.anchor;
    const lines = currentSdl.split("\n");
    const targetLine = findAnchorLine(lines, typeName, fieldName);

    if (targetLine === null) return NO_OP_HANDLE;

    const collection = editor.createDecorationsCollection([
      {
        range: new monaco.Range(targetLine, 1, targetLine, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: "tour-highlight-gutter",
          className: "tour-highlight-line tour-highlight-line--anchor",
        },
      },
    ]);

    editor.revealLineInCenter(targetLine);

    return { dispose: () => collection.clear() };
  }

  // ── Diff-based path ────────────────────────────────────────────────────────
  const currentLines = currentSdl.split("\n");
  const prevLineSet = new Set(prevSdl.split("\n"));
  const changedLines = diffLines(currentLines, prevLineSet);

  if (changedLines.length === 0) return NO_OP_HANDLE;

  const decorations: Monaco.editor.IModelDeltaDecoration[] = changedLines.map((lineNumber) => ({
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: "tour-highlight-gutter",
      className: "tour-highlight-line",
    },
  }));

  const collection = editor.createDecorationsCollection(decorations);
  editor.revealLineInCenter(changedLines[0]);

  return { dispose: () => collection.clear() };
}
