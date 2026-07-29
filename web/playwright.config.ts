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
  webServer: [
    {
      // CI downloads the wasm-bindings artifact ahead of this job, so the
      // wasm-pack/cargo-watch rebuild that "pnpm dev" performs is redundant —
      // run Vite directly against the pre-built bindings instead.
      command: process.env.CI ? "pnpm dev:no-wasm" : "pnpm dev",
      port: 8001,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Backs /api/* (proxied from Vite, see vite.config.ts) — needed by the
      // live-sync e2e specs for POST/GET /api/live-session. Applies D1
      // migrations first (pnpm db:migrate, folded into the pages:dev script)
      // so live_sessions exists. web/dist must already contain a build (see
      // ci.yml) — wrangler needs the directory to exist, even though these
      // tests only ever hit it via the /api proxy, never its static assets.
      command: "pnpm pages:dev",
      port: 8788,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The live-sync Worker (WebSocket relay) — proxied from Vite at /ws
      // (see vite.config.ts). A separate npm project (live-sync/), not a
      // pnpm workspace member — ci.yml installs its deps as its own step.
      command: "npm run dev",
      cwd: "../live-sync",
      port: 8789,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
