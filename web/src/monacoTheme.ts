import type * as Monaco from "monaco-editor";

/**
 * Custom Monaco theme matched to the app's "Ink at Night" design tokens
 * (see theme.css). Keeping the editor background identical to the surrounding
 * .editor surface makes the editor read as part of the panel rather than a
 * jarring, separately-themed box. Pass to the Editor's `beforeMount` to register
 * it, and set `theme={MONACO_THEME}` to apply it.
 */
export const MONACO_THEME = "ink-night";

let defined = false;

export function defineMonacoTheme(monaco: typeof Monaco): void {
  if (defined) return;
  defined = true;

  monaco.editor.defineTheme(MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "566089", fontStyle: "italic" },
      { token: "keyword", foreground: "7aa2f7" },
      { token: "type", foreground: "2ac3de" },
      { token: "string", foreground: "9ece6a" },
      { token: "number", foreground: "ff9e64" },
      { token: "delimiter", foreground: "9aabc4" },
    ],
    colors: {
      "editor.background": "#16243a",
      "editor.foreground": "#e7edf6",
      "editorLineNumber.foreground": "#3f5273",
      "editorLineNumber.activeForeground": "#9aabc4",
      "editorCursor.foreground": "#e3b341",
      "editor.selectionBackground": "#28406a",
      "editor.inactiveSelectionBackground": "#1e3050",
      "editor.lineHighlightBackground": "#1b2c46",
      "editor.lineHighlightBorder": "#00000000",
      "editorGutter.background": "#16243a",
      "editorIndentGuide.background1": "#22344f",
      "editorIndentGuide.activeBackground1": "#3a557a",
      "editorBracketMatch.background": "#294063",
      "editorBracketMatch.border": "#3a557a",
      "editorWidget.background": "#1e3050",
      "editorWidget.border": "#26384f",
      "editorSuggestWidget.background": "#1e3050",
      "editorSuggestWidget.border": "#26384f",
      "editorSuggestWidget.selectedBackground": "#294063",
      "editorHoverWidget.background": "#1e3050",
      "editorHoverWidget.border": "#26384f",
      "input.background": "#0f1826",
      "input.border": "#26384f",
      "dropdown.background": "#1e3050",
      "scrollbarSlider.background": "#3a557a66",
      "scrollbarSlider.hoverBackground": "#3a557a99",
      "scrollbarSlider.activeBackground": "#607290cc",
      "minimap.background": "#16243a",
    },
  });
}

/**
 * Mermaid theme variables matched to the same tokens, for the sequence diagram.
 */
export const MERMAID_THEME_VARIABLES = {
  darkMode: true,
  background: "#16243a",
  fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  primaryColor: "#1e3050",
  primaryTextColor: "#e7edf6",
  primaryBorderColor: "#3a557a",
  secondaryColor: "#294063",
  lineColor: "#9aabc4",
  textColor: "#e7edf6",
  actorBkg: "#1e3050",
  actorBorder: "#e3b341",
  actorTextColor: "#e7edf6",
  actorLineColor: "#3a557a",
  signalColor: "#9aabc4",
  signalTextColor: "#e7edf6",
  labelBoxBkgColor: "#1e3050",
  labelBoxBorderColor: "#3a557a",
  labelTextColor: "#e7edf6",
  loopTextColor: "#e7edf6",
  noteBkgColor: "#294063",
  noteTextColor: "#e7edf6",
  noteBorderColor: "#3a557a",
  activationBkgColor: "#294063",
  activationBorderColor: "#3a557a",
  sequenceNumberColor: "#14223a",
};
