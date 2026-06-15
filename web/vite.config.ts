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
  // monaco-graphql's GraphQLWorker dynamically imports prettier/standalone and
  // prettier/parser-graphql for code formatting. The default "iife" worker
  // format can't resolve dynamic imports at runtime, so we inline them at
  // build time. This avoids ES module workers (type:"module"), which fail in
  // Firefox <114 and produce "Could not create web worker(s)" console errors.
  worker: {
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
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
