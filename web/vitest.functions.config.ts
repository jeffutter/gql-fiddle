import { defineConfig } from "vitest/config";

// D1 functions tests run in Node.js with a better-sqlite3 shim (see
// functions/__tests__/d1-mock.ts). No workerd/miniflare is required.
export default defineConfig({
  test: {
    environment: "node",
    include: ["../functions/__tests__/**/*.test.ts"],
  },
});
