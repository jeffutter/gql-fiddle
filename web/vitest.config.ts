import { defineConfig } from "vitest/config";

export default defineConfig({
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
