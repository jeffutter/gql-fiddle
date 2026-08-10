import { useEffect, useRef } from "react";
import type * as _monaco from "monaco-editor";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  findCommentBlocks,
  parseSchemaLink,
  resolveSchemaLink,
  type CommentBlock,
} from "./schemaComments";

export interface SchemaCommentSubgraph {
  name: string;
  sdl: string;
}

/**
 * `setHiddenAreas` collapses a line range to zero height in the editor's
 * view. It's how Monaco implements code folding, but it's only exposed on
 * the concrete `CodeEditorWidget`, not in the public `IStandaloneCodeEditor`
 * type — same situation as monaco-vim's `Vim` export in App.tsx, so the same
 * escape hatch applies here.
 */
type EditorWithHiddenAreas = _monaco.editor.IStandaloneCodeEditor & {
  setHiddenAreas(ranges: _monaco.IRange[]): void;
};

/** Renders `block.markdown` to sanitized HTML, external links opening in a new tab. */
function renderBlockDom(block: CommentBlock): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "schema-comment-block";
  container.title = "Click to edit";
  const html = DOMPurify.sanitize(marked.parse(block.markdown, { async: false }));
  container.innerHTML = html;
  container.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  });
  return container;
}

/** Renders `node` off-screen at `widthPx` to measure the height Monaco should reserve for it. */
function measureHeight(node: HTMLElement, widthPx: number): number {
  const probe = node.cloneNode(true) as HTMLElement;
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.left = "-99999px";
  probe.style.top = "0";
  probe.style.width = `${widthPx}px`;
  probe.style.height = "auto";
  document.body.appendChild(probe);
  const height = probe.offsetHeight;
  document.body.removeChild(probe);
  return height;
}

/**
 * Renders contiguous `#`-comment blocks in the schema editor as markdown,
 * in place of their raw source — links inside a block are clickable;
 * clicking anywhere else in a block (or moving the cursor into its line
 * range) reveals the raw `#` text for editing, and it re-renders once the
 * cursor leaves or the editor loses focus.
 *
 * A block is "active" (raw/editable) purely as a function of current cursor
 * position + focus — there's no persisted per-block state — so every
 * rescan just recomputes zones from scratch. Simple, and cheap at the scale
 * of a hand-written schema.
 */
export function useSchemaCommentBlocks(
  editor: _monaco.editor.IStandaloneCodeEditor | null,
  monacoInstance: typeof _monaco | null,
  subgraphs: SchemaCommentSubgraph[],
  activeSubgraphIndex: number,
  onNavigateToSubgraph: (index: number) => void,
) {
  const zoneIdsRef = useRef<string[]>([]);
  const flashDecorationsRef = useRef<ReturnType<
    _monaco.editor.IStandaloneCodeEditor["createDecorationsCollection"]
  > | null>(null);
  // A `subgraph:Type.field` link switches tabs (see jumpToLink) before the
  // target subgraph's model is even mounted on `editor`, so the reveal+flash
  // has to wait for the model swap. Set by jumpToLink, consumed by the next
  // rescan() once onDidChangeModel confirms that swap happened.
  const pendingJumpRef = useRef<string | null>(null);
  // Mirrors of props that change far more often than the Monaco wiring below
  // should ever tear down and rebuild for — `subgraphs` is a fresh array on
  // every keystroke anywhere in the workspace. Read via refs instead of
  // depending on them directly.
  const subgraphsRef = useRef(subgraphs);
  const activeSubgraphIndexRef = useRef(activeSubgraphIndex);
  const onNavigateToSubgraphRef = useRef(onNavigateToSubgraph);
  useEffect(() => {
    subgraphsRef.current = subgraphs;
    activeSubgraphIndexRef.current = activeSubgraphIndex;
    onNavigateToSubgraphRef.current = onNavigateToSubgraph;
  });

  useEffect(() => {
    if (!editor || !monacoInstance) return;
    const hiddenEditor = editor as EditorWithHiddenAreas;

    function revealAndFlash(name: string) {
      if (!editor || !monacoInstance) return;
      const model = editor.getModel();
      if (!model) return;
      const line = resolveSchemaLink(model.getValue(), name);
      if (line === null) return;
      editor.revealLineInCenter(line);
      flashDecorationsRef.current?.clear();
      flashDecorationsRef.current = editor.createDecorationsCollection([
        {
          range: new monacoInstance.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: "schema-link-target-flash" },
        },
      ]);
      setTimeout(() => flashDecorationsRef.current?.clear(), 1200);
    }

    function jumpToLink(target: string) {
      if (/^https?:\/\//.test(target)) {
        window.open(target, "_blank", "noopener,noreferrer");
        return;
      }
      const { subgraph, name } = parseSchemaLink(target);
      if (subgraph !== null) {
        const targetIndex = subgraphsRef.current.findIndex((sg) => sg.name === subgraph);
        if (targetIndex === -1) return; // link names a subgraph that doesn't exist (any more)
        if (targetIndex !== activeSubgraphIndexRef.current) {
          pendingJumpRef.current = name;
          onNavigateToSubgraphRef.current(targetIndex);
          return;
        }
      }
      revealAndFlash(name);
    }

    function enterEditMode(block: CommentBlock, lineNumber: number = block.startLine) {
      if (!editor) return;
      editor.focus();
      editor.setPosition({ lineNumber, column: 1 });
      editor.revealLineInCenter(lineNumber);
      // setPosition triggers onDidChangeCursorPosition, which re-runs rescan()
      // and — now that the cursor sits inside this block — leaves it raw.
    }

    /**
     * `setHiddenAreas` folds a block's lines to zero height, so Monaco's
     * stock ArrowDown/ArrowUp step over the whole block like any other fold
     * instead of moving the cursor into it. When the cursor sits on the line
     * immediately adjacent to a (currently hidden) block, entering it
     * ourselves — landing on its near edge, matching where the key would
     * have naturally arrived — is the "one line at a time" behavior a user
     * expects; otherwise we fall through to Monaco's own command so
     * everything else about vertical movement (desired column, selection,
     * etc.) still works.
     */
    function enterAdjacentBlock(direction: 1 | -1): boolean {
      if (!editor) return false;
      const model = editor.getModel();
      if (!model) return false;
      const pos = editor.getPosition();
      if (!pos) return false;
      const blocks = findCommentBlocks(model.getValue());
      const block =
        direction === 1
          ? blocks.find((b) => b.startLine === pos.lineNumber + 1)
          : blocks.find((b) => b.endLine === pos.lineNumber - 1);
      if (!block) return false;
      enterEditMode(block, direction === 1 ? block.startLine : block.endLine);
      return true;
    }

    function rescan() {
      if (!editor || !monacoInstance) return;
      const model = editor.getModel();
      if (!model) return;

      if (pendingJumpRef.current !== null) {
        const name = pendingJumpRef.current;
        pendingJumpRef.current = null;
        revealAndFlash(name);
      }

      const blocks = findCommentBlocks(model.getValue());
      const cursorLine = editor.getPosition()?.lineNumber ?? -1;
      const activeIndex = editor.hasTextFocus()
        ? blocks.findIndex((b) => cursorLine >= b.startLine && cursorLine <= b.endLine)
        : -1;

      const contentWidth = editor.getLayoutInfo().contentWidth;

      editor.changeViewZones((accessor) => {
        zoneIdsRef.current.forEach((id) => accessor.removeZone(id));
        zoneIdsRef.current = [];

        blocks.forEach((block, i) => {
          if (i === activeIndex) return;
          const dom = renderBlockDom(block);
          // Without this, a mousedown here — while the editor already has
          // focus elsewhere in the document — blurs it first (mousedown on
          // a non-focusable target is a browser default). That fires
          // onDidBlurEditorText, whose rescan() tears down and rebuilds every
          // zone, including this one, mid-gesture — so the click event this
          // mousedown was starting never reaches this domNode and
          // enterEditMode()/jumpToLink() never run. preventDefault on our
          // own mousedown listener suppresses that default focus-shift.
          //
          // Deliberately NOT using the zone's `suppressMouseDown` option for
          // this: that routes the mousedown through Monaco's own view-zone
          // handling, which calls its *own* focus() and starts a
          // cursor-placement operation for the click — snapping the cursor
          // to whatever line Monaco decides is nearest the zone, not
          // necessarily inside this block, which fights our click handler
          // below rather than deferring to it.
          dom.addEventListener("mousedown", (e) => e.preventDefault());
          dom.addEventListener("click", (e) => {
            const anchor = (e.target as HTMLElement).closest("a");
            if (anchor) {
              e.preventDefault();
              jumpToLink(anchor.getAttribute("href") ?? "");
              return;
            }
            enterEditMode(block);
          });
          const height = measureHeight(dom, contentWidth);
          const id = accessor.addZone({
            afterLineNumber: block.startLine - 1,
            heightInPx: Math.max(
              height,
              editor.getOption(monacoInstance.editor.EditorOption.lineHeight),
            ),
            domNode: dom,
            showInHiddenAreas: true,
          });
          zoneIdsRef.current.push(id);
        });
      });

      hiddenEditor.setHiddenAreas(
        blocks
          .filter((_, i) => i !== activeIndex)
          .map((b) => new monacoInstance.Range(b.startLine, 1, b.endLine, 1)),
      );
    }

    // `editor`/`monacoInstance` are real Monaco instances in the app, but
    // component tests pass bare stand-ins for them (e.g. `{ getModel: ...,
    // focus: ... }`, per App.test.tsx) that don't implement most of this
    // API. Same situation as the "stale model" sync effect above — catch
    // and skip gracefully rather than requiring every test's mock to grow
    // the full editor surface.
    try {
      rescan();
      editor.addCommand(monacoInstance.KeyCode.DownArrow, () => {
        if (!enterAdjacentBlock(1)) editor.trigger("keyboard", "cursorDown", null);
      });
      editor.addCommand(monacoInstance.KeyCode.UpArrow, () => {
        if (!enterAdjacentBlock(-1)) editor.trigger("keyboard", "cursorUp", null);
      });
      const disposables = [
        editor.onDidChangeModelContent(rescan),
        editor.onDidChangeCursorPosition(rescan),
        editor.onDidChangeModel(rescan),
        editor.onDidBlurEditorText(rescan),
        editor.onDidFocusEditorText(rescan),
      ];

      return () => {
        try {
          disposables.forEach((d) => d.dispose());
          editor.changeViewZones((accessor) => {
            zoneIdsRef.current.forEach((id) => accessor.removeZone(id));
            zoneIdsRef.current = [];
          });
          hiddenEditor.setHiddenAreas([]);
          flashDecorationsRef.current?.clear();
        } catch {
          // Partial mock — nothing real to tear down.
        }
      };
    } catch {
      // Partial mock — nothing real to set up.
      return undefined;
    }
  }, [editor, monacoInstance]);
}
