{
  description = "GraphQL Playground — browser-only federated GraphQL editor (Rust/WASM + TS)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      rust-overlay,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };

        # Rust toolchain pinned in-flake, with the wasm target.
        rust = pkgs.rust-bin.stable.latest.default.override {
          targets = [ "wasm32-unknown-unknown" ];
          extensions = [
            "rust-src"
            "rust-analyzer"
            "clippy"
            "rustfmt"
          ];
        };
      in
      let
        # JS-only inputs shared between the web shell and the full dev shell.
        # wrangler is intentionally NOT pulled from nixpkgs: it's a pnpm
        # devDependency (web/package.json, pinned in web/pnpm-lock.yaml) and is
        # invoked via pnpm scripts, so node_modules/.bin/wrangler is used. The
        # nixpkgs build compiles wrangler from source when uncached and fails
        # flakily (EBADF in its tsup build), so we let pnpm own this tool.
        webInputs = [
          pkgs.nodejs_22
          pkgs.pnpm
        ];

        # Core Rust + WASM build inputs, without a browser (used in CI jobs
        # that build Rust/WASM but don't run headless browser tests).
        rustInputs = [
          rust

          # WASM build chain. wasm-bindgen-cli MUST match the wasm-bindgen
          # crate version in crates/gql-core/Cargo.toml — that is the single
          # most common Nix/WASM footgun. If nixpkgs lags the crate, override
          # this package's version.
          pkgs.wasm-pack
          pkgs.wasm-bindgen-cli
          pkgs.binaryen # provides wasm-opt
        ];

        # Chromium + driver are only available/usable from nixpkgs on Linux.
        # On macOS (darwin) the nixpkgs chromium build is unsupported, so we
        # leave the browser out and expect devs to point at a system Chrome.
        browserInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [
          pkgs.chromium
          pkgs.chromedriver
        ];

        browserEnv = pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          CHROME = "${pkgs.chromium}/bin/chromium";
          CHROMEDRIVER = "${pkgs.chromedriver}/bin/chromedriver";
        };

        rustShellHook = ''
          # Unset RUSTFLAGS so it does not leak from the parent shell into
          # the dev environment. The getrandom wasm_js cfg must only ever
          # apply to wasm32 builds via .cargo/config.toml.
          unset RUSTFLAGS

          echo "graphql-playground dev shell"
          echo "  rust:          $(rustc --version)"
          echo "  wasm-bindgen:  $(wasm-bindgen --version)"
          echo "  node:          $(node --version)"
        '';
      in
      {
        devShells = {
          # Full local-dev shell — includes browser for wasm-pack headless tests.
          default = pkgs.mkShell (
            {
              buildInputs =
                webInputs
                ++ rustInputs
                ++ [
                  # Git hooks.
                  pkgs.lefthook

                  # Dev workflow.
                  pkgs.cargo-watch
                  pkgs.concurrently
                ]
                # Browser + driver for headless wasm-pack tests (pre-built binaries
                # from wasm-pack don't work on Nix — missing shared libs). Linux only.
                ++ browserInputs;

              shellHook = rustShellHook;
            }
            // browserEnv
          );

          # CI shell for Rust/WASM builds — no browser, smaller Nix store footprint.
          rust = pkgs.mkShell {
            buildInputs = webInputs ++ rustInputs;
            shellHook = rustShellHook;
          };

          # CI shell for headless wasm-pack browser tests — adds Chromium (Linux only).
          wasm-test = pkgs.mkShell (
            {
              buildInputs = webInputs ++ rustInputs ++ browserInputs;
              shellHook = rustShellHook;
            }
            // browserEnv
          );

          # CI shell for web-only jobs (lint, typecheck, e2e, deploy).
          # No Rust toolchain — pulls Node/pnpm/Chromium from nixpkgs binary cache.
          # Chromium is included so Playwright uses CHROME rather than downloading
          # its own browser bundle.
          web = pkgs.mkShell (
            {
              buildInputs = webInputs ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.chromium ];
            }
            // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
              CHROME = "${pkgs.chromium}/bin/chromium";
            }
          );
        };
      }
    );
}
