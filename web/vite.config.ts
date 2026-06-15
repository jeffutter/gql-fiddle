import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// wasm + topLevelAwait let us `import` the wasm-bindgen ES module that
// `wasm-pack build --target web` emits into web/src/wasm/.
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  // monaco-graphql's worker entry uses code-splitting, which the default
  // "iife" worker format doesn't support — bundle workers as ES modules.
  worker: {
    format: "es",
  },
  server: {
    host: "0.0.0.0",
    port: 8001,
  },
  test: {
    // jsdom enables React component rendering in Vitest.
    environment: "jsdom",
    setupFiles: ["./src/setupTests.tsx", "@testing-library/jest-dom/vitest"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
