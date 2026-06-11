# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A browser-only GraphQL **federation** playground with no backend. Users author
multiple subgraph schemas, compose them into a supergraph, inspect the query
plan, and run queries against deterministic **mock** data — entirely client-side.
The GraphQL logic is Rust compiled to WASM; the UI is a TypeScript/React shell.

Read `backlog/docs/doc-1 - GraphQL-Playground-Design.md` (the design) and
`backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md` (ordered tasks,
milestones, acceptance criteria) before non-trivial work. Work is tracked as
Backlog.md tasks under `backlog/tasks/` — see CLAUDE.md for the workflow.

## Toolchain: everything runs inside the Nix flake

The C linker, Rust+wasm target, `wasm-bindgen`/`wasm-opt`, Node, pnpm, and
lefthook only exist inside the dev shell. Run commands via `direnv` (auto-loads
on `cd`) or prefix with `nix develop -c`. Outside the shell `cargo` fails with
`linker 'cc' not found`.

**The flake only sees git-tracked files** — after creating a new file, `git add`
it before `nix develop` will pick it up, or you get a confusing "not tracked"
error.

## Common commands

Rust core (`crates/gql-core`):
```sh
cargo test -p gql-core                              # native unit tests
cargo test -p gql-core <name>                       # single test by name
cargo fmt --check                                   # pre-commit enforces this
cargo clippy --all-targets -- -D warnings           # pre-commit enforces this
wasm-pack test --headless --chrome crates/gql-core  # browser tests (CI only; needs Chrome)
```

Web shell (run from `web/`):
```sh
pnpm install
pnpm build:wasm           # build the wasm artifact into web/src/wasm/
pnpm dev                  # initial wasm build + vite dev server + cargo-watch for rust changes
pnpm tsc --noEmit         # typecheck (pre-commit enforces)
pnpm lint                 # eslint (pre-commit enforces)
pnpm test run             # vitest once
pnpm test run <file>      # single test file
pnpm prettier --check .   # pre-commit enforces; use --write to fix
```

Git hooks (lefthook, auto-installed via `.envrc`): **pre-commit** = fmt/lint/
typecheck on staged files; **pre-push** = `cargo test` + `pnpm test`. WASM
browser tests are CI-only (too slow / need a browser).

## Architecture

**The JS↔Rust boundary is JSON strings.** Every `#[wasm_bindgen]` export in
`crates/gql-core/src/lib.rs` takes JSON in and returns a JSON envelope out.
`lib.rs` functions are thin wrappers; real logic lives in sibling modules
(`compose`, `validate`, `plan`, `mock`) as plain Rust returning
`serde_json::Value`, so native `cargo test` exercises it without a browser.
`dto.rs` holds the boundary serde types; `web/src/core/types.ts` is the TS
mirror. **The UI depends only on these shapes, never on apollo-federation's
internal types** — Apollo API churn stays contained in the wrapper modules.

**No function panics on bad input.** Malformed schemas/queries are normal
outcomes returned as error envelopes (`{ ok: false, errors }` /
`{ diagnostics }`), not exceptions. A `console_error_panic_hook` is only a
last-resort net.

**No federated execution.** Because data is mocked, the query plan is *not*
executed across subgraphs. The flow is: `compose` subgraphs → supergraph →
derive the client-facing API schema → mock-execute the query against that single
schema (`mock.rs`, a deterministic field-walker). `plan` exists purely to
*visualize* how a query federates and is fully decoupled from execution. When
implementing `plan`, map Apollo's plan into our own slim `QueryPlan` DTO — do not
expose Apollo's internal type.

**Determinism via `seed`.** `execute_mock` generates values from a hash of
`(seed, path, field)`, so same schema + query + seed = identical output. This is
what makes shareable URLs and snapshot tests work; preserve it.

## Apollo crates: pinned, unstable, not yet wired

`apollo-compiler` and `apollo-federation` are pinned **exact** (`=1.32.0`,
`=2.15.0`) and currently **commented out** in `crates/gql-core/Cargo.toml`. The
module bodies are `UNIMPLEMENTED` stubs. `apollo-federation` has **no semver
guarantees** (Apollo treats it as Router-internal) — any version may break the
API, so always read the docs/source for the pinned version, and keep `compose`
golden tests as the regression net when bumping it.

Uncommenting these and implementing real composition is **Spike 0** — the
make-or-break step that proves `apollo-federation` compiles to and runs in wasm.
If it surfaces a `getrandom` wasm error, enable `getrandom`'s `js` feature
(already noted in `Cargo.toml`). `tests/wasm.rs` is Spike 0's permanent home.

## Gotchas already encountered

- `wasm-bindgen-cli` (from nixpkgs) must match the `wasm-bindgen` crate version
  in `Cargo.toml` — the classic Nix/WASM footgun. If nixpkgs lags, override it.
- pnpm 10+ blocks dependency build scripts; allowed builds live in
  `web/pnpm-workspace.yaml` under `allowBuilds` (not the `package.json` `pnpm`
  field, which pnpm 11 ignores).
