import { vi } from "vitest";

// Suppress unhandled rejections from the WASM loader (fetches from localhost
// in jsdom where no server is running).  This keeps test output clean.
process.on("unhandledRejection", () => {});

// Mock the WASM core module so tests never attempt a fetch to localhost:3000.
vi.mock("./core", () => ({
  loadCore: vi.fn(() =>
    Promise.resolve({
      compose: () => ({ ok: true, supergraph_sdl: "", hints: [] }),
    }),
  ),
}));

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
  };
}

// Shared test harness so individual tests can supply their own editor/monaco mocks.
globalThis.__editorTestHarness = {
  onMount: null,
};

// Mock @monaco-editor/react — the Editor component renders a simple placeholder.
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  default: vi.fn(
    ({
      value,
      onMount,
    }: {
      value?: string;
      onMount?: (editor: unknown, monaco: unknown) => void;
    }) => {
      if (onMount) {
        globalThis.__editorTestHarness.onMount = onMount;
      }
      return (
        <div data-testid="monaco-editor" role="textbox">
          {value}
        </div>
      );
    },
  ),
}));
