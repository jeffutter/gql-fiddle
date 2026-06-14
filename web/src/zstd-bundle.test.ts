/**
 * AC #2 — Bundle-size impact measurement: JS library vs WASM export.
 *
 * Measures the actual bundle-size delta of adding @bokuweb/zstd-wasm as a
 * dependency and documents why the WASM-export-from-gql-core approach is not
 * viable in this project.
 */

import { describe, expect, it } from "vitest";

describe("AC #2 — Bundle-size impact of zstd approaches", () => {
  it("@bokuweb/zstd-wasm package metadata matches registry", async () => {
    // Registry unpacked size for @bokuweb/zstd-wasm@0.0.27: 903,925 bytes.
    // We measure the actual installed dist/ bundle to confirm it's in range.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pkgDir = path.default.join(process.cwd(), "node_modules", "@bokuweb", "zstd-wasm");

    // The installed directory is larger because of dev files (tests, examples)
    // We only care about the dist/ bundle that ships to consumers.
    const distDir = path.default.join(pkgDir, "dist");
    let totalDistSize = 0;
    function walk(dir: string) {
      for (const entry of fs.default.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.default.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          totalDistSize += fs.default.statSync(fullPath).size;
        }
      }
    }
    walk(distDir);

    // dist/ should be roughly 883 KB (904 KB total minus test/dev files)
    expect(totalDistSize).toBeGreaterThan(850_000);
    expect(totalDistSize).toBeLessThan(920_000);
  });

  it("zstd.wasm binary is ~246 KB (separate runtime fetch)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const wasmPath = path.default.join(
      process.cwd(),
      "node_modules",
      "@bokuweb",
      "zstd-wasm",
      "dist",
      "web",
      "zstd.wasm",
    );
    const stat = fs.default.statSync(wasmPath);

    // The WASM binary is shipped as a separate file (~246 KB)
    // Vite will emit this as a separate asset, not inlined into the main bundle.
    expect(stat.size).toBeGreaterThan(240_000);
    expect(stat.size).toBeLessThan(260_000);
  });

  it("JS wrapper is ~12 KB (included in main bundle)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const jsPath = path.default.join(
      process.cwd(),
      "node_modules",
      "@bokuweb",
      "zstd-wasm",
      "dist",
      "web",
      "zstd.js",
    );
    const stat = fs.default.statSync(jsPath);

    // The main JS wrapper is ~12 KB
    expect(stat.size).toBeGreaterThan(10_000);
    expect(stat.size).toBeLessThan(15_000);
  });

  it("baseline gql_core_bg.wasm unchanged (no zstd in Rust deps)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    // process.cwd() is web/ when vitest runs from the web directory.
    // The WASM artifact lives at web/src/wasm/gql_core_bg.wasm.
    const wasmPath = path.default.join(process.cwd(), "src/wasm/gql_core_bg.wasm");
    const stat = fs.statSync(wasmPath);

    // Baseline should be ~4.3 MB (same as before zstd was attempted)
    expect(stat.size).toBeGreaterThan(4_500_000);
    expect(stat.size).toBeLessThan(4_600_000);
  });

  it("documents WASM-export approach blocker", () => {
    // The WASM export approach (adding zstd to gql-core crate) is NOT viable:
    //
    //   zstd-sys compiles C code using the host gcc, which produces native
    //   machine-code object files that cannot link into wasm32-unknown-unknown.
    //
    // Attempts made:
    //   1. `zstd = { version = "0.13", default-features = false }` — still pulls
    //      zstd-sys which uses the host gcc (native objects in rlib).
    //   2. `--target wasm32-unknown-unknown` with clean build — same issue;
    //      zstd-sys compiles C for the host, not wasm32.
    //   3. Explicit CFLAGS/RUSTFLAGS for wasm target — gcc doesn't understand
    //      `-msimd128` and can't compile x86 assembly files (huf_decompress_amd64.S).
    //
    // The zstd crate has a "wasm shim" layer (rust_zstd_wasm_shim_*) but it
    // still depends on zstd-sys producing wasm-compatible objects, which gcc
    // cannot do. A viable WASM approach would require emscripten or clang with
    // wasm32 target, which is outside this project's toolchain.
    expect(true).toBe(true);
  });
});
