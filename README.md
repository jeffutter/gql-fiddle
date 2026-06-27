# GQL Fiddle

A browser-only GraphQL federation playground. Author multiple subgraph schemas,
compose them into a supergraph, inspect the query plan, and run queries against
deterministic **mock** data — with **no backend required** for the core
experience.

The GraphQL brain is Rust compiled to WebAssembly (Apollo's `apollo-compiler`
and `apollo-federation`); the UI is a TypeScript/React shell. An optional
Cloudflare Pages Functions backend adds **cloud accounts**, **cross-device
workspace sync** (encrypted), and **tour sharing**.

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

## Features

- **Multi-subgraph federation editor** — write SDL for multiple subgraphs with
  live validation squiggles.
- **Composition** — compose subgraphs into a supergraph via `apollo-federation`
  in WebAssembly; the last good supergraph is always preserved.
- **Query plan visualization** — interactive tree, Mermaid sequence diagram,
  Gantt-style execution timeline, and schema tree views.
- **Mock execution** — deterministic mock data derived from
  `hash(seed, path, field_name)`; same schema + query + seed always returns the
  same data, so shared URLs always show the same result.
- **Schema exploration** — Type Graph, Entity Ownership Graph, and Supergraph /
  API SDL views.
- **Tour authoring & playback** — build step-by-step interactive walkthroughs
  of a workspace and share them as `#t=` URLs, no backend needed.
- **Cloud sync** — optional GitHub OAuth login; workspaces are synced
  cross-device via Cloudflare D1 + KV, encrypted with AES-256-GCM
  (client-generated DEK, server-side KWK — server never sees plaintext).
- **URL sharing** — share a workspace snapshot as a `#w=` URL; share a tour as
  a `#t=` URL.

## Layout

```
crates/gql-core/   Rust/WASM core (validate, compose, plan, mock-execute, node-at-position)
web/               Vite + React + TS shell
functions/         Cloudflare Pages Functions (auth, workspace sync, encryption key exchange)
migrations/        D1 SQL migrations
flake.nix          Pinned toolchain
lefthook.yml       Git hooks (fmt/lint/typecheck on commit, tests on push)
```

See [AGENTS.md](AGENTS.md) for full architecture documentation, command
reference, and agent-specific guidance.
