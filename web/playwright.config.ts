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
    command: "pnpm dev",
    port: 8001,
    reuseExistingServer: !process.env.CI,
  },
});
