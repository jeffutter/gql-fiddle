import type { UserConfig as VitestUserConfig } from "vitest/config";

declare module "vite" {
  interface UserConfig {
    test?: VitestUserConfig["test"];
  }
}
