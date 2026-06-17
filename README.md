# GQL Fiddle

A browser-only GraphQL federation playground. Author multiple subgraph schemas,
compose them into a supergraph, inspect the query plan, and run queries against
deterministic **mock** data — with **no backend**.

The GraphQL brain is Rust compiled to WebAssembly (Apollo's `apollo-compiler`
and `apollo-federation`); the UI is a TypeScript/React shell.

## Getting started

Requires [Nix](https://nixos.org/) with flakes (and ideally
[direnv](https://direnv.net/)).

```sh
direnv allow          # or: nix develop
# then, for the web shell:
cd web && pnpm install && pnpm dev
```

The Nix flake pins the entire toolchain (Rust + wasm target, wasm-bindgen,
wasm-opt, Node, pnpm, lefthook). Git hooks install automatically on shell entry.

## Layout

```
crates/gql-core/   Rust/WASM core (validate, compose, plan, mock-execute)
web/               Vite + React + TS shell
docs/plans/        Design and implementation plan
flake.nix          Pinned toolchain
lefthook.yml       Git hooks (fmt/lint/typecheck on commit, tests on push)
```
