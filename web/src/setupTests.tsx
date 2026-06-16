import { vi } from "vitest";

// Suppress unhandled rejections from the WASM loader (fetches from localhost
// in jsdom where no server is running).  This keeps test output clean.
process.on("unhandledRejection", () => {});

// Polyfill localStorage for zustand persist middleware.
class LocalStorageMock {
  private store: Record<string, string> = {};
  length = 0;
  clear() {
    this.store = {};
    this.length = 0;
  }
  getItem(key: string) {
    return this.store[key] ?? null;
  }
  key(index: number) {
    const keys = Object.keys(this.store);
    return keys[index] ?? null;
  }
  removeItem(key: string) {
    delete this.store[key];
    this.length--;
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
    this.length = Object.keys(this.store).length;
  }
}
Object.defineProperty(globalThis, "localStorage", {
  value: new LocalStorageMock(),
  writable: true,
  configurable: true,
});

// Polyfill matchMedia — not implemented in JSDOM; always returns desktop (non-mobile).
Object.defineProperty(globalThis, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Polyfill ResizeObserver — required by react-resizable-panels in JSDOM.
globalThis.ResizeObserver = class ResizeObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};

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
    /** onMount for the subgraph editor (path starts with "sg-"). Kept for
     *  backward compatibility with existing tests. */
    onMount: ((editor: unknown, monaco: unknown) => void) | null;
    /** onMount callbacks keyed by editor path. */
    onMountByPath: Record<string, ((editor: unknown, monaco: unknown) => void) | undefined>;
    // onChange callbacks keyed by editor path so tests can trigger them
    onChangeByPath: Record<string, ((value: string | undefined) => void) | undefined>;
  };
}

// Shared test harness so individual tests can supply their own editor/monaco mocks.
globalThis.__editorTestHarness = {
  onMount: null,
  onMountByPath: {},
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
        if (path) {
          globalThis.__editorTestHarness.onMountByPath[path] = onMount;
        }
        // Keep __editorTestHarness.onMount pointing to the subgraph editor
        // so existing tests that call it to set up the subgraph editor state
        // continue to work. Subgraph editor paths start with "sg-".
        if (!path || path.startsWith("sg-")) {
          globalThis.__editorTestHarness.onMount = onMount;
        }
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
