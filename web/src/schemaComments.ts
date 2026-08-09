/**
 * Free-floating markdown annotation blocks inside GraphQL SDL.
 *
 * GraphQL's `#` line comment is discarded entirely by the parser — it never
 * becomes part of a type's `description`, never reaches introspection or
 * composition. That makes it the natural home for reader-facing notes that
 * are "part of the fiddle, not part of the schema": a contiguous run of
 * `#`-prefixed lines is treated as one markdown block, stripped of its
 * leading `#` markers and rendered in place of the raw comment text.
 */

export interface CommentBlock {
  /** 1-indexed, inclusive — matches Monaco's line numbering. */
  startLine: number;
  /** 1-indexed, inclusive. */
  endLine: number;
  /** Original `#`-prefixed source lines, joined with `\n`. */
  raw: string;
  /** Each line with its leading `#` (and one optional following space) stripped. */
  markdown: string;
}

const COMMENT_LINE = /^[ \t]*#(.*)$/;

/** Strips one leading `#` and at most one following space from a comment line's content. */
function stripMarker(afterHash: string): string {
  return afterHash.startsWith(" ") ? afterHash.slice(1) : afterHash;
}

/**
 * Scans `sdl` for contiguous runs of `#` comment lines and returns each as a
 * block. Blank lines break a run (so two adjacent single-line comments
 * separated by blank source stay distinct blocks).
 */
export function findCommentBlocks(sdl: string): CommentBlock[] {
  const lines = sdl.split("\n");
  const blocks: CommentBlock[] = [];

  let current: { start: number; raw: string[]; md: string[] } | null = null;

  const flush = () => {
    if (current === null) return;
    blocks.push({
      startLine: current.start,
      endLine: current.start + current.raw.length - 1,
      raw: current.raw.join("\n"),
      markdown: current.md.join("\n"),
    });
    current = null;
  };

  lines.forEach((line, i) => {
    const match = COMMENT_LINE.exec(line);
    if (match) {
      const lineNumber = i + 1;
      if (current === null) current = { start: lineNumber, raw: [], md: [] };
      current.raw.push(line);
      current.md.push(stripMarker(match[1]));
    } else {
      flush();
    }
  });
  flush();

  return blocks;
}

const TYPE_DEF = /^\s*(type|interface|enum|input|union|scalar)\s+(\w+)/;
// A field/value line: `name(...)?: Type` or a bare enum value `NAME`. Loose on
// purpose — good enough to locate a line to jump to, not a full SDL parser.
const FIELD_DEF = /^\s*(\w+)\s*(\(|:)/;

/**
 * Resolves a `TypeName` or `TypeName.fieldName` reference to a 1-indexed
 * line number within `sdl`, or `null` if it can't be found. Used to jump the
 * editor to whatever a comment block's `[label](#Target)` link points at.
 */
export function resolveSchemaLink(sdl: string, target: string): number | null {
  const [typeName, fieldName] = target.split(".");
  const lines = sdl.split("\n");

  let typeLine: number | null = null;
  let typeIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = TYPE_DEF.exec(lines[i]);
    if (m && m[2] === typeName) {
      typeLine = i + 1;
      typeIndent = lines[i].search(/\S/);
      break;
    }
  }
  if (typeLine === null) return null;
  if (!fieldName) return typeLine;

  for (let i = typeLine; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent !== -1 && indent <= typeIndent && i > typeLine - 1 && /^\s*\}/.test(line)) break;
    const m = FIELD_DEF.exec(line);
    if (m && m[1] === fieldName) return i + 1;
  }
  return null;
}
