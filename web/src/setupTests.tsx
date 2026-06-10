import { vi } from "vitest";

// Suppress unhandled rejections from the WASM loader (fetches from localhost
// in jsdom where no server is running).  This keeps test output clean.
process.on("unhandledRejection", () => {});

// Polyfill browser APIs that Monaco depends on but jsdom does not provide.
document.queryCommandSupported = vi.fn(() => false);

// Mock monaco-editor so the heavy WASM-adjacent module never loads in tests.
vi.mock("monaco-editor", () => ({
  editor: {
    setModelMarkers: vi.fn(),
  },
  MarkerSeverity: {
    Error: 8,
    Warning: 4,
  },
}));

declare global {
  var __editorTestHarness: {
    onMount: ((editor: unknown, monaco: unknown) => void) | null;
    // onChange callbacks keyed by editor path so tests can trigger them
    onChangeByPath: Record<string, ((value: string | undefined) => void) | undefined>;
  };
}

// Shared test harness so individual tests can supply their own editor/monaco mocks.
globalThis.__editorTestHarness = {
  onMount: null,
  onChangeByPath: {},
};

// Mock @monaco-editor/react — the Editor component renders a simple placeholder.
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  default: vi.fn(
    ({
      value,
      path,
      onMount,
      onChange,
    }: {
      value?: string;
      path?: string;
      onMount?: (editor: unknown, monaco: unknown) => void;
      onChange?: (value: string | undefined) => void;
    }) => {
      if (onMount) {
        globalThis.__editorTestHarness.onMount = onMount;
      }
      if (path && onChange) {
        globalThis.__editorTestHarness.onChangeByPath[path] = onChange;
      }
      return (
        <div data-testid="monaco-editor" role="textbox" data-path={path}>
          {value}
        </div>
      );
    },
  ),
}));
