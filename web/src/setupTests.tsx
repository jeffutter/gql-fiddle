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
  editor: {},
}));

// Mock @monaco-editor/react — the Editor component renders a simple placeholder.
vi.mock("@monaco-editor/react", () => ({
  loader: { config: vi.fn() },
  default: vi.fn(({ value }: { value?: string }) => (
    <div data-testid="monaco-editor" role="textbox">
      {value}
    </div>
  )),
}));
