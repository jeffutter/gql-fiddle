import { useCallback, useEffect, useRef } from "react";
import { loader } from "@monaco-editor/react";
import * as _monaco from "monaco-editor";
import GraphQLWorker from "monaco-graphql/esm/graphql.worker?worker";
import { initializeMode } from "monaco-graphql/initializeMode";
import type { MonacoGraphQLAPI } from "monaco-graphql";
import { buildSchema, getNamedType, isInterfaceType, isObjectType, isUnionType } from "graphql";
import type { ComposeResult } from "./core/types";

// vite-plugin-monaco-editor injects self.MonacoEnvironment (getWorkerUrl) for
// editor.worker and json.worker via the HTML head script. We capture that handler
// and add a partial override for the graphql label only, because the plugin's
// esbuild bundler cannot resolve monaco-graphql's internal import of
// "monaco-editor/esm/vs/editor/editor.worker" (missing .js extension with pnpm).
const _pluginEnv = self.MonacoEnvironment;
self.MonacoEnvironment = {
  getWorker(moduleId, label) {
    if (label === "graphql") return new GraphQLWorker();
    // Delegate editor / json workers to the plugin-generated URL handler.
    if (_pluginEnv?.getWorkerUrl) {
      return new Worker(_pluginEnv.getWorkerUrl(moduleId, label), { type: "classic" });
    }
    return new Worker("");
  },
};
loader.config({ monaco: _monaco });
// Expose Monaco for Playwright e2e tests (dev server only).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__monaco = _monaco;
}

// Singleton monaco-graphql API — initialized once on first successful compose.
let monacoGraphQLAPI: MonacoGraphQLAPI | null = null;

/**
 * Owns the monaco-graphql singleton and mock-config.yaml completion wiring.
 *
 * `registerSchema` is called by the caller's compose pipeline: pass the
 * composed `api_schema_sdl` on a successful compose, or `null` on failure to
 * deregister the previously-successful schema so completions/hovers don't
 * keep suggesting fields from a supergraph that no longer composes.
 *
 * `registerSchema` is a stable (`useCallback`, empty deps) reference across
 * renders — the compose effect can safely list it as a dependency without
 * breaking its debounce.
 */
export function useMonacoGraphQL(compose: ComposeResult | null): {
  registerSchema: (apiSchemaSdl: string | null) => void;
} {
  // Current schema field keys for mock-config YAML completions: "TypeName.fieldName".
  const mockConfigFieldKeysRef = useRef<string[]>([]);
  // Concrete type names per field key — only populated for union/interface return types.
  const mockConfigConcreteTypesRef = useRef<Record<string, string[]>>({});

  const registerSchema = useCallback((apiSchemaSdl: string | null) => {
    if (apiSchemaSdl === null) {
      // Deregister the previously-successful schema so completions/hovers
      // don't keep suggesting fields from a supergraph that no longer composes.
      monacoGraphQLAPI?.setSchemaConfig([]);
      return;
    }
    monacoGraphQLAPI ??= initializeMode();
    monacoGraphQLAPI.setModeConfiguration({
      completionItems: true,
      diagnostics: false,
      hovers: true,
      documentSymbols: true,
      documentFormattingEdits: true,
    });
    monacoGraphQLAPI.setSchemaConfig([
      {
        documentString: apiSchemaSdl,
        uri: "api-schema.graphql",
        fileMatch: ["**/*.graphql"],
      },
    ]);
  }, []);

  // Update mock-config field key and concrete-type suggestions whenever the API schema changes.
  useEffect(() => {
    if (!compose?.ok) {
      mockConfigFieldKeysRef.current = [];
      mockConfigConcreteTypesRef.current = {};
      return;
    }
    try {
      const schema = buildSchema(compose.api_schema_sdl);
      const typeMap = schema.getTypeMap();
      const keys: string[] = [];
      const concreteTypes: Record<string, string[]> = {};
      for (const [typeName, type] of Object.entries(typeMap)) {
        if (typeName.startsWith("__")) continue;
        if (isObjectType(type)) {
          for (const [fieldName, field] of Object.entries(type.getFields())) {
            const key = `${typeName}.${fieldName}`;
            keys.push(key);
            const namedType = getNamedType(field.type);
            if (isUnionType(namedType)) {
              concreteTypes[key] = namedType.getTypes().map((t) => t.name);
            } else if (isInterfaceType(namedType)) {
              const implementors: string[] = [];
              for (const [, other] of Object.entries(typeMap)) {
                if (
                  isObjectType(other) &&
                  other.getInterfaces().some((i) => i.name === namedType.name)
                ) {
                  implementors.push(other.name);
                }
              }
              concreteTypes[key] = implementors;
            }
          }
        }
      }
      mockConfigFieldKeysRef.current = keys;
      mockConfigConcreteTypesRef.current = concreteTypes;
    } catch {
      mockConfigFieldKeysRef.current = [];
      mockConfigConcreteTypesRef.current = {};
    }
  }, [compose]);

  // Register YAML completion provider for mock-config.yaml once on mount.
  useEffect(() => {
    const OVERRIDE_PROPS = [
      {
        label: "enum",
        insertText: "enum:\n  - ",
        detail: "Pick from list (deterministic hash-pick)",
      },
      {
        label: "unionType",
        insertText: "unionType: ",
        detail: "Force a specific concrete type for union/interface",
      },
      {
        label: "oneOf",
        insertText: "oneOf:\n  - ",
        detail: "Hash-pick a concrete type from a list of union/interface members",
      },
      { label: "value", insertText: "value: ", detail: "Always emit this exact JSON value" },
      {
        label: "null",
        insertText: "null: true",
        detail: "Always emit null (ignored on NonNull fields)",
      },
    ];

    const provider = _monaco.languages.registerCompletionItemProvider("yaml", {
      triggerCharacters: ["."],
      provideCompletionItems(model, position) {
        if (!model.uri.path.endsWith("-mock-config.yaml")) return { suggestions: [] };

        const lineText = model.getLineContent(position.lineNumber);
        const isComment = lineText.trimStart().startsWith("#");
        if (isComment) return { suggestions: [] };

        const isIndented = /^\s/.test(lineText);

        if (!isIndented) {
          // Top-level line: suggest TypeName.fieldName completions.
          if (lineText.includes(":")) return { suggestions: [] };

          // Token range: scan left/right from cursor to cover A-Za-z0-9._
          let tokenStart = position.column - 1;
          while (tokenStart > 0 && /[A-Za-z0-9._]/.test(lineText[tokenStart - 1])) tokenStart--;
          let tokenEnd = position.column - 1;
          while (tokenEnd < lineText.length && /[A-Za-z0-9._]/.test(lineText[tokenEnd])) tokenEnd++;

          const range = {
            startLineNumber: position.lineNumber,
            startColumn: tokenStart + 1,
            endLineNumber: position.lineNumber,
            endColumn: tokenEnd + 1,
          };

          return {
            suggestions: mockConfigFieldKeysRef.current.map((key) => ({
              label: key,
              kind: _monaco.languages.CompletionItemKind.Property,
              insertText: key + ":\n  ",
              filterText: key,
              range,
            })),
          };
        }

        // Helpers used by the indented-line cases below.

        // Scan backward for the first non-indented TypeName.fieldName: key.
        const findFieldKey = (): string | null => {
          for (let ln = position.lineNumber - 1; ln >= 1; ln--) {
            const line = model.getLineContent(ln);
            if (!line.trim() || line.trim().startsWith("#")) continue;
            if (!/^\s/.test(line) && line.includes(":")) {
              return line.substring(0, line.indexOf(":")).trim();
            }
          }
          return null;
        };

        // Return true when the current line is a list item (  - ) whose nearest
        // non-list-item ancestor at the same or shallower indent is "oneOf:".
        const isUnderOneOf = (): boolean => {
          const currentIndent = lineText.length - lineText.trimStart().length;
          for (let ln = position.lineNumber - 1; ln >= 1; ln--) {
            const line = model.getLineContent(ln);
            if (!line.trim() || line.trim().startsWith("#")) continue;
            const indent = line.length - line.trimStart().length;
            if (indent > currentIndent) continue;
            const trimmed = line.trimStart();
            if (trimmed.startsWith("-")) continue; // sibling list item
            return /^oneOf\s*:/.test(trimmed);
          }
          return false;
        };

        // Build concrete-type suggestions for the field key's union/interface type.
        const concreteTypeSuggestions = (fieldKey: string) => {
          const types = mockConfigConcreteTypesRef.current[fieldKey];
          if (!types || types.length === 0) return null;
          const wordInfo = model.getWordAtPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: wordInfo?.startColumn ?? position.column,
            endColumn: wordInfo?.endColumn ?? position.column,
          };
          return {
            suggestions: types.map((t) => ({
              label: t,
              kind: _monaco.languages.CompletionItemKind.EnumMember,
              insertText: t,
              range,
            })),
          };
        };

        // Case: value position after "  unionType: "
        const unionTypeValueMatch = lineText.match(/^(\s+unionType:\s*)/);
        if (unionTypeValueMatch && position.column > unionTypeValueMatch[1].length) {
          const fieldKey = findFieldKey();
          if (fieldKey) {
            const result = concreteTypeSuggestions(fieldKey);
            if (result) return result;
          }
        }

        // Case: list item under "oneOf:" (cursor at or past the "- " prefix)
        const listItemMatch = lineText.match(/^(\s*-\s*)/);
        if (listItemMatch && position.column >= listItemMatch[1].length && isUnderOneOf()) {
          const fieldKey = findFieldKey();
          if (fieldKey) {
            const result = concreteTypeSuggestions(fieldKey);
            if (result) return result;
          }
        }

        // Case: override property name (only when no colon precedes the cursor).
        const strippedPrefix = lineText.substring(0, position.column - 1).trimStart();
        if (strippedPrefix.includes(":")) return { suggestions: [] };

        // getWordAtPosition covers the full word under the cursor so a mid-word
        // trigger replaces the whole word correctly.
        const wordInfo = model.getWordAtPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordInfo?.startColumn ?? position.column,
          endColumn: wordInfo?.endColumn ?? position.column,
        };

        return {
          suggestions: OVERRIDE_PROPS.map((p) => ({
            label: p.label,
            kind: _monaco.languages.CompletionItemKind.Property,
            insertText: p.insertText,
            detail: p.detail,
            range,
          })),
        };
      },
    });

    return () => provider.dispose();
  }, []);

  return { registerSchema };
}
