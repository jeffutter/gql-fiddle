import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

const logger = createLogger();
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, options) => {
  // monaco-graphql ships source maps that reference TS source files not
  // included in the published package. Suppress these to reduce noise.
  if (msg.includes("Sourcemap for") && msg.includes("points to missing source files")) return;
  originalWarn(msg, options);
};

// wasm lets us `import` the wasm-bindgen ES module that
// `wasm-pack build --target web` emits into web/src/wasm/.
// Top-level await is handled natively by Vite 8 (Rolldown).
export default defineConfig({
  customLogger: logger,
  plugins: [react(), wasm()],
  optimizeDeps: {
    // These CJS packages need pre-bundling (CJS→ESM) so that the
    // graphql.worker.js ES-module worker can import them. pnpm doesn't hoist
    // transitive deps, so we chain the resolution path with '>'.
    include: [
      "monaco-graphql > picomatch-browser",
      "monaco-graphql > graphql-language-service > nullthrows",
    ],
  },
  resolve: {
    alias: {
      // Mermaid's source modules use a d3-color pattern that relies on
      // function-declaration hoisting; Rolldown's production bundling emits
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
    rolldownOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8001,
    proxy: {
      "/api": {
        target: "http://localhost:8788",
        changeOrigin: true,
        autoRewrite: true,
        ws: true,
      },
    },
  },
  test: {
    // jsdom enables React component rendering in Vitest.
    environment: "jsdom",
    setupFiles: ["./src/setupTests.tsx", "@testing-library/jest-dom/vitest"],
    exclude: ["e2e/**", "node_modules/**"],
    // Vitest 3+ fakes performance.now() by default, which breaks React 19's
    // scheduler (it uses performance.now() for time-slicing). Explicitly limit
    // faked APIs to the timer subset.
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "Date",
      ],
    },
  },
});
