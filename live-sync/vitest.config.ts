import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "better-sqlite3": path.resolve(
        __dirname,
        "node_modules/better-sqlite3/lib/index.js",
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});