---
id: TASK-6
title: Add a script to build the WASM module into the web app
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-07 18:31'
labels: []
milestone: m-1
dependencies:
  - TASK-3
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The web app loads the compiled core from web/src/wasm/. Add a repeatable command that builds the Rust core directly into that folder so front-end tasks can import it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A build:wasm script exists in web/package.json with the specified command
- [x] #2 Running it produces web/src/wasm/gql_core.js and a .wasm file
- [x] #3 Generated wasm files remain git-ignored (not staged)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open web/package.json.
2. In "scripts" add this entry (pnpm scripts run from the web/ folder, so paths are relative to web/):
     "build:wasm": "wasm-pack build ../crates/gql-core --target web --out-dir ../web/src/wasm"
3. Ensure web dependencies are installed. If you have not yet run pnpm install in the web/ directory, run: nix develop -c bash -c "cd web && pnpm install". This is required so that the new script resolves.
4. Run: nix develop -c bash -c "cd web && pnpm build:wasm"
5. Confirm web/src/wasm/ now contains at minimum gql_core.js and gql_core_bg.wasm (plus .d.ts type definitions and a generated package.json — all git-ignored).
6. web/src/wasm/ is already in .gitignore (line 7). Do NOT commit generated files and do NOT change .gitignore.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added build:wasm script to web/package.json that runs wasm-pack to compile gql-core into web/src/wasm/. The command (wasm-pack build ../crates/gql-core --target web --out-dir ../web/src/wasm) produces gql_core.js, .wasm binary, and TypeScript definitions, all git-ignored via existing .gitignore entry for web/src/wasm/.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

### Critical Context: wasm-pack is Archived (July 2025)

The rust-wasm working group **sunset and archived** wasm-pack in July 2025. The project moved to a fork at `drager/wasm-pack` under the current maintainer's personal account. However, as of June 2026:

- **Latest release is v0.15.0** (May 15, 2026) — still functional and receiving bug fixes [^1]
- The official rustwasm docs now redirect to the forked docs at `drager.github.io/wasm-pack` [^2]
- The wasm-bindgen maintainers have stated they will **not** recommend wasm-pack in their docs, but acknowledge it remains widely used [^3]

### Recommended Approach: Stick with `wasm-pack build` for This Task

Despite being archived, `wasm-pack build` is still the simplest path for this task because:
1. The implementation plan already specifies it
2. v0.15.0 (May 2026) is fully functional
3. The project uses Nix dev shell, which manages tool versions — mitigating the "version drift" risk that plagues unmaintained tools
4. The manual alternative (`cargo build` -> `wasm-bindgen-cli` -> `wasm-opt`) adds 2-3 extra steps and requires explicit version pinning of wasm-bindgen-cli to match the crate version

### API Signature: `wasm-pack build`

```
wasm-pack build [PATH] [OPTIONS]
```

| Flag | Values | Description |
|------|--------|-------------|
| `--target` | `bundler`, `web`, `nodejs`, `no-modules`, `deno` | JS output strategy. Use `web` for native browser ES module imports. Requires manual WASM instantiation [^2] |
| `--out-dir` | any directory path | Custom output directory (default: `pkg`) |
| `--out-name` | string prefix | Filename prefix for generated `.js`, `.wasm`, `.d.ts` files (default: crate name). Use underscores, **not dots** [^4] |
| `--profile` | `dev`, `profiling`, `release` | Build profile (default: `release`) [^2] |
| `--mode` | `normal`, `no-install` | Whether to install wasm-bindgen automatically (default: normal) [^2] |
| `--scope` | npm scope string | Package name scoping for npm packages [^2] |

Extra flags can be passed through to cargo by appending ` --` separator:

```
wasm-pack build ../crates/gql-core -- --offline
```

### Gotchas

1. **Generated `package.json` in custom `--out-dir`**: wasm-pack always generates a `package.json` in the output directory, even with a non-default `--out-dir`. This file will contain auto-generated metadata (name, version from Cargo.toml) and may conflict with or confuse the web app's own package.json. The developer should either delete it after build or add it to `.gitignore` explicitly if not already covered [^5][^6].

2. **File naming**: With crate name `gql-core`, wasm-pack produces files prefixed as `gql_core` (hyphens -> underscores): `gql_core.js`, `gql_core_bg.wasm`. TypeScript definitions are also generated: `gql_core.d.ts`, `gql_core_bg.d.ts` [^4]. The acceptance criteria expect `gql_core.js` and a `.wasm` file — this matches.

3. **`--target web` requires manual WASM loading**: Unlike `bundler` target, the `web` output does not auto-load the WASM binary. The consuming JS code must call `init()` and then use `fetch()` or similar to load the `.wasm` file [^2].

4. **wasm-opt performance on Linux**: The wasm-opt bundled with wasm-pack has known pathological performance issues on Linux due to musl allocator problems, potentially causing 10x slower builds [^7]. For this project's purposes (a playground), this is likely acceptable, but worth noting if build times become problematic.

5. **`pack`/`publish` commands break with custom `--out-dir`**: If the project ever wants to use `wasm-pack pack` or `wasm-pack publish`, they must use the default `pkg` directory [^6]. Not relevant for this task since the output goes directly into the web app.

### Alternative: Manual Pipeline (if wasm-pack is rejected)

If the team decides not to use an archived tool, the equivalent manual pipeline is:

```bash
# Step 1: Compile Rust -> WASM
cargo build --target wasm32-unknown-unknown --release -p gql-core

# Step 2: Generate JS glue code
wasm-bindgen --target web \
  ./target/wasm32-unknown-unknown/release/gql_core.wasm \
  --out-dir ../web/src/wasm

# Step 3 (optional): Optimize with wasm-opt
wasm-opt -O3 \
  ../web/src/wasm/gql_core_bg.wasm \
  -o ../web/src/wasm/gql_core_bg.wasm
```

**Caveat**: The `wasm-bindgen-cli` version must match the `wasm-bindgen` crate version in Cargo.toml, or it will error. This requires explicit pinning [^3].

### Files the Build Produces (in `web/src/wasm/`)

| File | Source |
|------|--------|
| `gql_core.js` | JS wrapper from wasm-bindgen |
| `gql_core_bg.wasm` | Compiled WebAssembly binary |
| `gql_core.d.ts` | TypeScript type definitions |
| `gql_core_bg.d.ts` | Type defs for the _bg module |
| `package.json` | Auto-generated npm metadata (may need removal) |

---

[^1]: https://github.com/wasm-bindgen/wasm-pack/releases/tag/v0.15.0
[^2]: https://rustwasm.github.io/docs/wasm-pack/commands/build.html
[^3]: https://github.com/wasm-bindgen/wasm-bindgen/issues/4634
[^4]: https://github.com/rustwasm/wasm-pack/issues/697
[^5]: https://github.com/rustwasm/wasm-pack/issues/1369
[^6]: https://github.com/rustwasm/wasm-pack/issues/811
[^7]: https://nickb.dev/blog/life-after-wasm-pack-an-opinionated-deconstruction/

<!-- SECTION:NOTES:END -->
