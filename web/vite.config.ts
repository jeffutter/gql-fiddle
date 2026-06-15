import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// wasm + topLevelAwait let us `import` the wasm-bindgen ES module that
// `wasm-pack build --target web` emits into web/src/wasm/.
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      // Mermaid's source modules use a d3-color pattern that relies on
      // function-declaration hoisting; Rollup's production bundling emits
      // it as an assignment instead, breaking the hoist and throwing
      // "Cannot set properties of undefined (setting 'prototype')" at
      // runtime. Mermaid's pre-bundled ESM build doesn't have this issue.
      // https://github.com/mermaid-js/mermaid/issues/5453
      mermaid: `${import.meta.dirname}/node_modules/mermaid/dist/mermaid.esm.min.mjs`,
    },
  },
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
