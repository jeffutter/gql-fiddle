# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A browser-first GraphQL federation playground. Users author multiple subgraph
schemas, compose them into a supergraph, inspect the query plan, and run queries
against deterministic mock data — entirely client-side via WebAssembly.

The GraphQL brain is Rust compiled to WebAssembly (`crates/gql-core`) using
`apollo-compiler` and `apollo-federation`. The UI is a TypeScript/React shell
(`web/`). A lightweight backend in **Cloudflare Pages Functions** (`functions/`)
handles cloud accounts and cross-device workspace sync.

---

## Getting started

Everything — Rust toolchain, wasm target, wasm-pack, Node, pnpm, lefthook —
lives inside the Nix dev shell. Outside the shell `cargo` fails with `linker
'cc' not found`.

```sh
# Nix + direnv (auto-loads on cd)
direnv allow      # one time; shell re-activates on every cd

# Or manually
nix develop
```

**Critical gotcha:** the Nix flake only sees git-tracked files. After creating
any new file, `git add` it before running build commands or you get a
confusing "not tracked" error.

---

## Commands

### Rust core

```sh
cargo test -p gql-core              # native unit tests (no browser)
cargo test -p gql-core <name>       # run a single test by name
cargo fmt --check                   # formatting (pre-commit enforces)
cargo clippy --all-targets -- -D warnings   # linting (pre-commit enforces)

# WASM browser tests — CI only (requires Chrome)
wasm-pack test --headless --chrome crates/gql-core
```

### Web shell (run from `web/`)

```sh
pnpm install                  # install JS deps
pnpm build:wasm               # compile Rust → WASM → web/src/wasm/
pnpm dev                      # build:wasm + Vite dev server + cargo-watch
pnpm build                    # production build (tsc + vite)
pnpm test run                 # vitest unit tests (once)
pnpm test run <file>          # run a single test file
pnpm tsc --noEmit             # typecheck (pre-commit enforces)
pnpm lint                     # eslint (pre-commit enforces)
pnpm prettier --check .       # formatting check; use --write to fix
pnpm e2e                      # Playwright end-to-end tests
```

### Backend / Pages Functions (run from project root)

```sh
wrangler pages dev web/dist          # local dev server (http://localhost:8788)
wrangler types                       # regenerate worker-configuration.d.ts
web/node_modules/.bin/tsc --project functions/tsconfig.json --noEmit   # typecheck functions
web/node_modules/.bin/tsc --project functions/__tests__/tsconfig.json --noEmit  # typecheck tests
cd web && pnpm test:functions        # run functions unit tests (better-sqlite3 shim)
```

### Migrations

```sh
# Local: apply pending migrations to the wrangler dev SQLite instance.
wrangler d1 migrations apply gql-fiddle-db --local

# Production: apply pending migrations to the live D1 database.
wrangler d1 migrations apply gql-fiddle-db --remote

# List applied migrations.
wrangler d1 migrations list gql-fiddle-db
```

Migration files live in `migrations/` and are numbered sequentially:

| File | Contents |
|------|----------|
| `0001_initial.sql` | `users` and `workspaces` tables |
| `0002_users_wrapped_dek.sql` | Adds `wrapped_dek TEXT` column to `users` (stores the client-generated DEK wrapped with the server KWK) |

Each migration is applied exactly once; wrangler tracks applied migrations in a
`d1_migrations` metadata table.

### Git hooks (lefthook)

`pre-commit` runs in parallel: `cargo fmt --check`, `cargo clippy`,
`prettier`, `eslint`, `tsc --noEmit`, `cargo test`, `pnpm test run` — all
scoped to staged files where applicable. `pre-push` runs the full test suites.

---

## Backend (Cloudflare Pages Functions)

The backend lives in `functions/` at the project root. Cloudflare Pages
bundles these alongside the static `web/dist` output automatically — no
separate Worker or service is needed.

### Layout

```
functions/
  api/
    health.ts         GET /api/health → { ok: true, bindings: { db, sessions } }
    auth/
      login.ts        GET /api/auth/login — unified redirect (→ GitHub in prod, → dev-login in dev)
      github.ts       GET /api/auth/github — generate state, redirect to GitHub
      github/
        callback.ts   GET /api/auth/github/callback — validate state, exchange code, mint session
      me.ts           GET /api/auth/me — return current user or 401
      logout.ts       POST /api/auth/logout — delete session from KV, clear cookie
      dev-login.ts    GET /api/auth/dev-login — dev-only bypass (404 in production)
      enc-meta.ts     GET /api/auth/enc-meta — returns { kwk, wrapped_dek } for the session user
                      PUT /api/auth/enc-meta — stores the client-generated wrapped DEK
    workspaces/
      index.ts        GET /api/workspaces[?since=<epochMs>] — list user's workspaces
      [id].ts         PUT /api/workspaces/:id — upsert; DELETE /api/workspaces/:id — soft-delete
  _lib/
    db.ts             D1 data-access helpers (getOrCreateUser, listWorkspaces, upsertWorkspace,
                        softDeleteWorkspace, getWrappedDek, setWrappedDek)
    auth.ts           Auth primitives: state, session, requireUser, cookie helpers
  __tests__/
    d1-mock.ts        better-sqlite3-backed D1Database shim for tests
    db.test.ts        Unit tests for db.ts
    auth.test.ts      Unit tests for auth.ts
    dev-auth.test.ts  Unit tests for login.ts + dev-login.ts
    enc-meta.test.ts  Unit tests for enc-meta.ts (KWK generation, DEK wrap/unwrap)
    workspaces.test.ts Unit tests for workspace REST API
    tsconfig.json     Test-only TypeScript config (adds node + better-sqlite3 types)
  tsconfig.json       Workers-runtime TypeScript config (excludes __tests__)
migrations/
  0001_initial.sql    Creates users and workspaces tables
  0002_users_wrapped_dek.sql  Adds wrapped_dek column to users
wrangler.jsonc        Pages project config (D1 + KV bindings)
.dev.vars.example     Template for local secrets (copy to .dev.vars, which is gitignored)
worker-configuration.d.ts  Generated by `wrangler types` (gitignored)
```

### Local development

`wrangler` is included in the Nix dev shell. Run from the **project root**:

```sh
# Build the frontend first (wrangler serves it as the static layer).
cd web && pnpm build && cd ..

# Start the Pages dev server with Functions + D1 (local SQLite) + KV (in-memory).
wrangler pages dev web/dist
# → http://localhost:8788
# → http://localhost:8788/api/health  returns {"ok":true,"bindings":{"db":true,"sessions":true}}
```

`wrangler pages dev` hot-reloads Functions but not the Vite frontend. Run
`pnpm build` (from `web/`) to rebuild the frontend, then refresh. Local D1
state lives in `.wrangler/state/v3/d1/` (gitignored).

### Auth (GitHub OAuth)

The auth flow uses GitHub OAuth 2.0 (Authorization Code). Sessions are stored
in KV as opaque tokens; the GitHub access token is used once to fetch the user
profile and is then discarded — it is never persisted.

#### OAuth App setup

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
   - **Homepage URL:** `https://<project>.pages.dev`
   - **Authorization callback URL:** `https://<project>.pages.dev/api/auth/github/callback`
2. For local dev, add a second callback URL (or a separate app):
   `http://localhost:8788/api/auth/github/callback`
3. Copy the **Client ID** and generate a **Client Secret**.

#### Required secrets

Never commit these values. Set them via Wrangler or the Cloudflare dashboard:

```sh
wrangler pages secret put GITHUB_CLIENT_ID
wrangler pages secret put GITHUB_CLIENT_SECRET
```

For local dev, add to `.dev.vars` (gitignored by default):

```ini
GITHUB_CLIENT_ID=<your_client_id>
GITHUB_CLIENT_SECRET=<your_client_secret>
```

#### Session design

- Cookie name: `__session`, attributes: `HttpOnly; Secure; SameSite=Lax`
- **Fixed 30-day TTL** — no sliding renewal. A new login always mints a fresh
  token. Old tokens expire naturally after 30 days of non-use.
- Tokens are stored in KV as `session:<uuid>` → `{ user_id, created_at }`.

#### State tokens (CSRF prevention)

OAuth state tokens are stored in KV as `state:<uuid>` with a **10-minute TTL**
and deleted immediately upon use (one-time tokens). If the callback receives a
state that does not match a KV entry, the request is rejected with 400.

#### Local development auth bypass

GitHub OAuth requires a registered App and an internet round-trip. For local
dev, a bypass is available that mints a real KV session without GitHub:

```sh
# Copy the example file and adjust values
cp .dev.vars.example .dev.vars
# .dev.vars is gitignored — never commit it

# Start the dev server — it reads .dev.vars automatically
wrangler pages dev web/dist

# Sign in instantly (no GitHub, no browser redirect to GitHub)
open http://localhost:8788/api/auth/dev-login
```

The `ENVIRONMENT` variable controls which auth flow is used:
- `ENVIRONMENT=development` (default when unset) → `/api/auth/login` redirects to `/api/auth/dev-login`
- `ENVIRONMENT=production` → `/api/auth/login` redirects to `/api/auth/github`

`DEV_USER_ID` (in `.dev.vars`) sets the synthetic user's login name; defaults
to `dev-user-1`. To simulate two different users, run a second `wrangler pages
dev` on a different port with `DEV_USER_ID=dev-user-2` in its `.dev.vars`.

---

### Workspace API

All endpoints require a valid `__session` cookie (set by the auth flow).
Cross-user access returns 404 (not 403) to avoid id enumeration.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces` | Full snapshot — live (non-deleted) workspaces for the caller |
| GET | `/api/workspaces?since=<epochMs>` | Delta — rows updated after `since`, including soft-deleted rows so clients learn about deletions |
| PUT | `/api/workspaces/:id` | Upsert. Body: `{ name, payload, version }`. Returns 200 + row on accept, 409 + current row on stale version |
| DELETE | `/api/workspaces/:id` | Soft-delete (sets `deleted_at`, bumps `version`). Returns 204 |

**Last-write-wins:** a PUT is accepted when `incoming.version >= stored.version`.
On 409 the response body includes the current server row so the client can adopt
it and move forward without manual conflict resolution.

**Payload cap:** 1 MB per workspace (413 if exceeded).

**Soft-delete propagation:** DELETE bumps `version` and sets `updated_at`, so
the deleted row appears in subsequent `?since` delta reads. Clients use this to
remove locally cached workspaces that were deleted on another device.

---

### Encryption

Workspace payloads are encrypted before being sent to the server so that neither
the database nor KV store alone can read user data. Implementation lives in
`web/src/encryption.ts`.

**Two-layer key system:**

- **KWK (Key Wrapping Key)** — a random 256-bit key generated server-side and
  stored in KV under `kwk:<user_id>`. Never leaves the server.
- **DEK (Data Encryption Key)** — a random 256-bit key generated in the
  browser. The browser wraps (encrypts) it with the KWK and stores the
  `wrapped_dek` in D1 (the `users.wrapped_dek` column added in migration 0002).
  The plaintext DEK is never sent to the server.

**Key bootstrap flow (`initEncryption`, called on login):**

1. `GET /api/auth/enc-meta` → receives the KWK (from KV) and `wrapped_dek`
   (from D1, may be null on first login).
2. If `wrapped_dek` is present, decrypt it with the KWK to recover the DEK.
3. If not (first device), generate a fresh DEK, wrap it with the KWK, and
   `PUT /api/auth/enc-meta` to persist the `wrapped_dek`.
4. Cache the DEK in `localStorage` for offline resilience.

**Payload format:**
- `CE1:<base64(iv + ciphertext)>` — current format: deflate-compressed then
  AES-256-GCM encrypted.
- `E1:<base64(iv + ciphertext)>` — legacy: encrypted without compression.
- No prefix — legacy plaintext (pre-encryption workspaces, decrypted on read).

Both `decrypt()` and `encrypt()` are transparent to the sync layer; `sync.ts`
calls them without needing to know the format details.

**Anonymous / offline mode:** `getOrCreateKey()` falls back to a locally
generated DEK cached in `localStorage`. Workspaces saved without a server-side
KWK are encrypted locally only.

---

### Provisioning (one-time, per Cloudflare account)

```sh
# 1. Create the D1 database — prints a database_id UUID.
wrangler d1 create gql-fiddle-db

# 2. Create the KV namespace — prints a namespace_id.
wrangler kv namespace create SESSIONS
```

Update `wrangler.jsonc` with the real IDs, then configure the same IDs as
**bindings in the Pages project settings** (dashboard → Pages → gql-fiddle →
Settings → Functions → KV/D1 bindings) so deployed Functions can reach the
real resources.

Resource IDs are not secrets and can be committed. Actual secrets (GitHub
OAuth client ID/secret, etc.) are added via `wrangler pages secret put <KEY>`
or the Cloudflare dashboard.

### CI token scopes

`CLOUDFLARE_API_TOKEN` must have:
- **Cloudflare Pages** — Edit (deploy Pages project + Functions)
- **D1** — Edit (create/migrate D1 databases)
- **Workers KV Storage** — Edit (create KV namespaces)
- **Account Settings** — Read (required by wrangler introspection)

`CLOUDFLARE_ACCOUNT_ID` — numeric account ID from the Cloudflare dashboard URL.

### TypeScript for functions

Functions are compiled by wrangler automatically (TypeScript → JS via esbuild).
For IDE type checking, generate the global `Env` type from `wrangler.jsonc`:

```sh
wrangler types          # emits worker-configuration.d.ts (gitignored)
```

Re-run `wrangler types` whenever `wrangler.jsonc` bindings change.

### Cloudflare free-tier limits (relevant to this project)

| Resource | Free tier limit | Notes |
|----------|-----------------|-------|
| Pages Functions requests | 100,000 / day | Resets daily; hard limit on free plan |
| Pages Functions CPU time | 10 ms / invocation | Burst to 50 ms; sync API calls are well within this |
| D1 reads | 5,000,000 / day | Row reads, not query count |
| D1 writes | 100,000 / day | Row writes |
| D1 storage | 5 GB | Total across all databases |
| KV reads | 100,000 / day | Eventually consistent |
| KV writes | 1,000 / day | Strongly consistent |
| KV storage | 1 GB | Total |

All limits apply per Cloudflare account. The sync API is lightweight and will
comfortably fit within the free tier for personal use.

---

## Repository layout

```
functions/
  api/
    health.ts       GET /api/health (liveness + binding probe)
    auth/
      github.ts     GET /api/auth/github (OAuth initiation)
      github/
        callback.ts GET /api/auth/github/callback (OAuth callback)
      me.ts         GET /api/auth/me (current user or 401)
      logout.ts     POST /api/auth/logout (invalidate session)
      enc-meta.ts   GET/PUT /api/auth/enc-meta (KWK + wrapped DEK exchange)
  _lib/
    db.ts           D1 data-access helpers (users + workspaces CRUD, LWW upsert, DEK storage)
    auth.ts         Auth primitives (state, session, requireUser, cookies)
  __tests__/        Unit tests with better-sqlite3 D1 shim and KV mock
  tsconfig.json     Workers-runtime TypeScript config
migrations/
  0001_initial.sql  users + workspaces schema
  0002_users_wrapped_dek.sql  wrapped_dek column for two-layer encryption
wrangler.jsonc      Cloudflare Pages config (D1 + KV bindings)
.dev.vars.example   Template for local secrets

crates/gql-core/        Rust/WASM library
  src/
    lib.rs              WASM exports — thin JSON wrappers only
    compose.rs          Subgraph composition via apollo-federation
    validate.rs         SDL + operation validation via apollo-compiler
    plan.rs             Query plan tree construction (visualization only)
    mock.rs             Deterministic mock execution
    api_schema.rs       Derive client-facing API schema from supergraph
    node_at_pos.rs      Cursor-aware SDL node lookup (hover/highlight support)
    dto.rs              Serde types for the JS↔Rust boundary
  tests/
    wasm.rs             Browser smoke tests (CI only)

web/
  src/
    App.tsx             Root component — layout, editors, all UI wiring
    AboutModal.tsx      About / version modal
    EntityOwnershipGraph.tsx  Force-directed entity ownership graph (D3)
    ExecutionTimeline.tsx     Gantt-style execution timeline per subgraph fetch
    PlanTree.tsx        Query plan tree renderer
    QueryShape.tsx      Query shape / field-set summary view
    SchemaTree.tsx      Hierarchical schema tree (types → fields → args)
    SequenceDiagram.tsx Mermaid sequence diagram renderer
    TourAuthoringPanel.tsx  Slide-deck tour builder (create + edit tours in-app)
    TourPlayback.tsx    Full-screen tour player (step-through, progress, highlight)
    TypeGraph.tsx       Force-directed type relationship graph (D3)
    auth.ts             Auth client (fetchCurrentUser, login, logout) + useAuth Zustand store
    encryption.ts       AES-256-GCM two-layer key system (KWK/DEK, compress+encrypt)
    hooks.ts            Shared React hooks
    monacoTheme.ts      Shared Monaco + Mermaid theme tokens
    planToFieldRanges.ts  Map plan fetch nodes to query source ranges (field highlights)
    planToMermaid.ts    PlanNode → Mermaid sequenceDiagram text
    planToTimeline.ts   PlanNode → ExecutionTimeline data
    queryToQueryShape.ts  Parse query → field-set summary
    schemaToEntityGraph.ts  Parse supergraph → entity ownership data
    schemaToSchemaTree.ts   Parse schema → hierarchical tree
    schemaToTypeGraph.ts    Parse schema → type relationship graph data
    share.ts            URL encode/decode (gzip + base64url); workspace + tour types
    store.ts            Zustand workspace store (persisted to localStorage, v5)
    subgraphColors.ts   Deterministic per-subgraph color assignment
    sync.ts             Cloud sync engine (pull-on-login, auto-save, delta refresh)
    tourHighlight.ts    Monaco decoration helpers for tour step anchors
    theme.css           All design tokens + semantic component classes
    core/
      index.ts          loadCore() — lazy WASM loader + typed wrapper
      types.ts          TypeScript mirror of dto.rs types
    wasm/               Generated by wasm-pack (not committed)
  e2e/                  Playwright tests
```

---

## Architecture

### JS↔Rust boundary

Every `#[wasm_bindgen]` export takes a JSON string and returns a JSON string.
The six exports:

| Export | Input | Output |
|--------|-------|--------|
| `validate_subgraph(sdl)` | SDL string | `{ diagnostics: Diagnostic[] }` |
| `compose(subgraphs_json)` | `[{ name, sdl }]` | `{ ok, supergraph_sdl?, api_schema_sdl?, hints?, errors? }` |
| `validate_query(supergraph_sdl, operation)` | two strings | `{ diagnostics: Diagnostic[] }` |
| `plan(supergraph_sdl, operation, op_name?)` | strings | `{ ok, query_plan? }` or `{ ok, errors }` |
| `execute_mock(supergraph_sdl, operation, seed, mock_config)` | strings + u64 + config | `{ data, errors? }` |
| `node_at_position(sdl, line, col)` | SDL string + cursor position | `{ node_type?, name?, ... }` — cursor-aware SDL node metadata |

The TypeScript wrapper in `web/src/core/index.ts` parses/stringifies and
exposes a typed `GqlCore` interface. All UI code calls `loadCore()` and uses
that interface — never the raw WASM namespace.

`dto.rs` owns the canonical Rust shapes. `web/src/core/types.ts` is the
TypeScript mirror. **These two files must stay in sync.** The UI never imports
apollo-federation types.

### Data flow

1. User edits a subgraph SDL → `validate_subgraph` shows squiggles live.
   `node_at_position` drives hover tooltips and field-range highlights.
2. On change (300 ms debounce) → `compose` → supergraph SDL stored in Zustand.
   Last good supergraph is kept when composition fails.
3. User runs a query → `plan` + `execute_mock` called with the supergraph SDL.
4. Results rendered across multiple tabs: Plan tree, Sequence Diagram, Execution
   Timeline, Schema Tree, and raw JSON Output.

### No panics

No WASM export panics on bad input. Malformed SDL and invalid queries are
normal outcomes returned as error envelopes. `console_error_panic_hook` is a
last-resort net for logic bugs only.

### Determinism

`execute_mock` derives field values from `hash(seed, path, field_name)`. Same
schema + query + seed always produces identical output. Preserve this invariant
— it underpins shareable URLs and snapshot tests.

### No federated execution

Composition produces a supergraph and an API schema. Mock execution runs against
the API schema only — there is no subgraph-level execution. The query plan is
computed and visualised purely for educational value; it does not drive
execution.

---

## State management

`web/src/store.ts` — a single Zustand store (key `"graphql-playground"`,
version 5) persisted to `localStorage`. The key is a legacy internal
identifier predating the gql-fiddle rebrand and is kept stable to avoid
wiping existing users' saved workspaces. It holds:

- `workspaces: WorkspaceEntry[]` — the user's named workspaces (v4+)
- `activeWorkspaceIndex: number`
- `vimMode: boolean`

Each `WorkspaceEntry` contains:
- `name`, `subgraphs`, `activeSubgraph`, `queryTabs`, `activeQueryTab`, `seed`, `mockConfig`, `tourDraft`
- `id: string` — stable client-generated UUID for cloud sync (added in v5)
- `version: number` — monotonic counter for last-write-wins conflict resolution (added in v5)

Composition result is *derived* state — recomputed whenever subgraphs change,
never hand-set by the user.

`tourDraft` holds the in-progress `Tour` object while authoring. It is persisted
locally but **not synced to the cloud** — tours are shared via `#t=` URLs.

### Sync model

When logged in, `web/src/sync.ts` (initialized via `initSync()` in `App.tsx`)
layers cloud sync on top of localStorage:

- **Pull on login:** on auth status → "authed", `initEncryption()` is called
  first to bootstrap the DEK, then a full `GET /api/workspaces` snapshot is
  pulled and merged with local data using **last-write-wins** (higher `version`
  wins; remote soft-deletes honored). Local-only workspaces are pushed up.
- **Encryption:** every `payload` field is deflate-compressed and AES-256-GCM
  encrypted via `encryption.ts` before upload; decrypted on pull.
- **Auto-save:** debounced 300 ms `PUT /api/workspaces/:id` per changed
  workspace; `version` is bumped before each push. On 409 (stale version) the
  client adopts the server row.
- **Delete:** removing a workspace while logged in calls
  `DELETE /api/workspaces/:id` (soft-delete on the server).
- **Offline fallback:** edits made while offline (or before login) are queued
  in memory and flushed on the `online` event or next login. localStorage
  remains authoritative at all times — no edits are lost.
- **Anonymous mode:** no API calls. localStorage-only behavior is unchanged.
- **No sync loop:** a store update triggered by a pull (within `isSyncing=true`)
  does not re-queue a debounced save.

### Cross-device refresh strategy

When the tab regains focus or becomes visible (`visibilitychange`), a delta
`GET /api/workspaces?since=<lastPullTs>` is issued and merged into the store.
Throttled to at most **one delta pull per 15 seconds** to respect D1 read
limits.

Polling: every **20 seconds** while the tab is visible.

Sync status indicator: an 8 px dot in the page header (synced/saving/offline/error)
using existing CSS variables — no hardcoded colors, no layout shift.

---

## URL sharing

`web/src/share.ts` encodes/decodes state as URL hash fragments.

**Workspace share:**
```
#w=<base64url(gzip(JSON))>
```
The `WorkspacePayload` contains subgraphs, queryTabs, activeQueryTab, and seed.
The Share button writes this fragment and copies the URL to the clipboard;
navigating to such a URL restores the workspace and then clears the fragment.
Old single-query URLs (without `queryTabs`) are decoded gracefully on the fly.

**Tour share:**
```
#t=<base64url(gzip(JSON))>
```
A `Tour` object contains `base: WorkspacePayload` and `steps: TourStep[]`.
Each `TourStep` has a `title`, optional `description`, an optional SDL cursor
`anchor` (line + col), and optional `overrides: Partial<WorkspacePayload>` that
are merged onto the base for that step. Navigating to a `#t=` URL launches the
tour player automatically.

---

## Tour system

Tours are slide-deck-style walkthroughs of a GraphQL federation workspace.
They are authored in-app and shared as `#t=` URLs — no backend required.

**Authoring** (`TourAuthoringPanel.tsx`):
- Accessible via a toolbar button when a workspace is open.
- Each step has a title, description (markdown), and an optional schema anchor
  (click-to-set in the Monaco editor via `node_at_position`).
- Steps can override any `WorkspacePayload` field (subgraphs, query, seed, etc.)
  to show progression across the tour.
- The draft is saved to `tourDraft` in the workspace store; a "Share tour" button
  encodes the finished tour as a `#t=` URL.

**Playback** (`TourPlayback.tsx`):
- Full-screen overlay driven by the `Tour` decoded from the `#t=` URL hash.
- Prev/Next navigation; progress indicator.
- Each step applies `resolveTourStep(tour, stepIndex)` (merges step overrides
  onto the base payload) and renders the workspace in read-only mode.
- If an anchor is set, `tourHighlight.ts` places a Monaco decoration on the
  referenced schema node.

---

## UI layout

`App.tsx` is the single root component. There is no routing.

**Desktop** — three vertical panels via `react-resizable-panels`:
1. **Left** — subgraph tab bar + Monaco editor (federation SDL); `node_at_position`
   drives hover info and field-range decorations after a query runs.
2. **Middle** — query tab bar + Monaco query editor + variables editor + Run controls.
   Below the query editor: results tabs after execution.
3. **Right** — two stacked sub-panels:
   - **Schema panel** (always visible): tabs — Type Graph | Entities | Supergraph SDL | API SDL
   - **Results panel** (post-query): tabs — Plan | Sequence | Timeline | Schema Tree | Output

**Results tabs:**

| Tab | Component | Description |
|-----|-----------|-------------|
| Plan | `PlanTree` | Interactive query plan tree |
| Sequence | `SequenceDiagram` | Mermaid sequence diagram |
| Timeline | `ExecutionTimeline` | Gantt-style timeline per fetch group |
| Schema Tree | `SchemaTree` | Hierarchical type/field tree |
| Output | — | Raw JSON mock execution output |

**Schema tabs:**

| Tab | Component | Description |
|-----|-----------|-------------|
| Type Graph | `TypeGraph` | Force-directed type relationship graph |
| Entities | `EntityOwnershipGraph` | Entity ownership by subgraph |
| Supergraph SDL | — | Raw composed supergraph SDL |
| API SDL | — | Client-facing API schema SDL |

**Mobile** (≤768 px) — a top tab bar switches between Schema, Query, Output,
and Results views. A "Select Text" overlay button opens a read-only Monaco view
for copy/paste.

**Monaco setup** — workers are configured inline in `App.tsx`. `monaco-graphql`
is initialized once after first successful composition, supplying the API schema
for query intellisense. The singleton `MonacoGraphQLAPI` lives in module scope.

---

## Visual design

This project has a **committed aesthetic** — maintain it; don't reinvent it per
change. It's an IDE-like, dense developer tool, styled accordingly.

**The look:** a dark theme of deep *messenger navy* surfaces (named after a
Bellroy navy bag) with a single *mustard-yellow* accent. Cool, crisp, not muddy.
A warm-dark + GraphQL-magenta attempt was explicitly rejected as muddy — don't
go back there.

**Single source of truth — `web/src/theme.css`.** All color/typography lives in
design tokens (CSS custom properties) and semantic component classes
(`.btn`, `.btn--primary`, `.tab`, `.panel`, `.panel__header`, `.panel__actions`,
`.code-block`, `.callout`, `.badge`, `.editor`, `.section-title`, `.empty-state`,
`.mobile-tab`, `.overlay`, …). Re-skinning is a one-file change.

- **Never hardcode a color, font, radius, or border in a component.** Reference a
  class or `var(--token)`. The old `App.tsx` had the same hex repeated across ~50
  inline styles; that is the anti-pattern this replaced.
- **Surfaces layer light-to-dark:** `--bg` (app) → `--surface` (editors/cards) →
  `--surface-2` (active/hover) → `--surface-3`. Borders: `--border`,
  `--border-strong`. Text: `--text`, `--text-muted`, `--text-faint`. Status:
  `--success` / `--danger` / `--warning`, each with a soft fill + border variant.
- **Use the accent sparingly — it's chrome only:** primary action (Run), active
  tab underline, focus rings, links, plan service names, Mermaid actor borders,
  editor cursor. Everything else is neutral. **Code syntax colors stay
  conventional** (blue/cyan/green/orange) — mustard never leaks into token
  highlighting.

**Matched editor/diagram themes — `web/src/monacoTheme.ts`.** Monaco and Mermaid
are themed to the same tokens so they blend into panels. Any new Monaco `<Editor>`
must pass `theme={MONACO_THEME}`, `beforeMount={(m) => defineMonacoTheme(m)}`, and
`options={EDITOR_OPTIONS}` (shared: no minimap, padding, mono font). Mermaid uses
`MERMAID_THEME_VARIABLES`.

**Layout conventions:**

- Columns are `.panel` (flex column, full height). Each panel reads top-to-bottom
  as **header row → tabs/controls row → content**, and panels are kept on a shared
  grid so those rows align across columns (e.g. the *Subgraphs* and *Output*
  titles align; their tab strips align below). Don't let a near-miss alignment
  creep back in.
- Section titles are small uppercase tracked labels (`.section-title`), not heavy
  headings.
- Panel gutters come from sized `.resize-handle`s (the library renders them
  zero-size; CSS gives them width/height per `aria-orientation` plus a grab
  indicator). Editor cards must never touch.

**Typography:** system UI sans for chrome, a monospace stack for all code/results
(`--font-ui`, `--font-mono`). This is a deliberate IDE aesthetic — do **not**
swap in a decorative display font.

**Skeuomorphic touch:** a faint paper-grain overlay (`.app::before`, ~2.5% SVG
noise). Subtle by design; keep it understated.

---

## Apollo crates

`apollo-compiler = "=1.32.0"` and `apollo-federation = "=2.15.0"` are pinned
exact in `crates/gql-core/Cargo.toml`. `apollo-federation` has no semver
guarantees — treat version bumps as deliberate, tested events and verify against
the compose golden tests.

`getrandom` with `wasm_js` feature is scoped to
`cfg(target_arch = "wasm32")` so it applies only to WASM builds and does not
affect `cargo test`.

---

## Testing

| Layer | Tool | Command |
|-------|------|---------|
| Rust native | cargo test | `cargo test -p gql-core` |
| Rust WASM | wasm-bindgen-test + Chrome | `wasm-pack test --headless --chrome crates/gql-core` (CI only) |
| Rust snapshots | insta | auto-updated with `cargo insta review` |
| Web unit | vitest + jsdom | `pnpm test run` (from `web/`) |
| Web e2e | Playwright | `pnpm e2e` (from `web/`) |
| Functions unit | vitest + better-sqlite3 shim | `pnpm test:functions` (from `web/`) |

Compose golden tests in `compose.rs` are the primary regression net for Apollo
crate version bumps. Mock determinism tests in `mock.rs` guard the seed/hash
contract. Web unit tests cover `store.ts`, `share.ts`, `planToMermaid.ts`, and
related transformation modules. The encryption integration test
(`sync-encryption.integration.test.ts`) exercises the full encrypt/decrypt round
trip across sync. Functions unit tests include `enc-meta.test.ts` for the
KWK/DEK key exchange endpoints.

---

## Gotchas

- **`wasm-bindgen-cli` must match the `wasm-bindgen` crate version** — they
  are coupled at the binary protocol level. If `pnpm build:wasm` fails with a
  version mismatch, override `wasm-bindgen-cli` in the flake or pin the crate
  to match nixpkgs.

- **pnpm 10+ blocks dependency build scripts** — allowed builds are listed in
  `web/pnpm-workspace.yaml` under `allowBuilds`. The `package.json` `pnpm`
  field is ignored by pnpm 11+, so keep the list in `pnpm-workspace.yaml`.

- **`RUSTFLAGS` leakage** — the flake's `shellHook` unsets `RUSTFLAGS` to
  prevent host flags from contaminating WASM builds. Don't set `RUSTFLAGS`
  globally; use `.cargo/config.toml` target-scoped flags.

- **New files must be `git add`-ed** before the Nix flake can see them.

- **`localStorage` key stability** — the Zustand store persists under
  `"graphql-playground"` (legacy name, kept stable to avoid wiping users'
  saved workspaces). Don't change this key. Migrations key off the `version`
  field inside the persisted state, not the storage key.

- **Migration `0002` must be applied before encryption works** — if `wrapped_dek`
  column is missing, the `enc-meta` endpoint returns a 500. Run
  `wrangler d1 migrations apply gql-fiddle-db --local` after pulling this migration.

# Frontend Aesthetics

> **This project already has a committed aesthetic — see [Visual design](#visual-design) above.**
> When working on existing UI, extend that system (tokens + classes in
> `web/src/theme.css`); do not introduce competing themes or fonts. The general
> guidance below is for greenfield surfaces and for the kind of thinking that
> produced the current system — not a license to re-skin during maintenance.

You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are clean, readable, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
