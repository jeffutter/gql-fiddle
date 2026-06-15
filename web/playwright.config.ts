import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:8001",
    launchOptions: {
      executablePath: process.env.CHROME,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    // CI downloads the wasm-bindings artifact ahead of this job, so the
    // wasm-pack/cargo-watch rebuild that "pnpm dev" performs is redundant —
    // run Vite directly against the pre-built bindings instead.
    command: process.env.CI ? "pnpm dev:no-wasm" : "pnpm dev",
    port: 8001,
    reuseExistingServer: !process.env.CI,
  },
});
