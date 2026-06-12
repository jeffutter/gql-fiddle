---
id: TASK-23
title: Serialize the workspace into a shareable URL and restore it
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 11:43'
labels: []
milestone: m-4
dependencies:
  - TASK-19
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Let users share their whole workspace via a URL. Encode the workspace into the URL hash; on load, restore from it. Because mock data is seed-deterministic, a shared URL reproduces identical results.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web/src/share.ts has encode/decode (JSON -> gzip -> base64 and back)
- [x] #2 Editing the workspace updates location.hash (debounced)
- [x] #3 Loading a URL with a valid hash restores subgraphs, query, variables, and seed
- [x] #4 A corrupt hash falls back to the default workspace without crashing
- [x] #5 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->





## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

The store (web/src/store.ts) is Zustand with persist middleware (localStorage key: graphql-playground). It has individual subgraph setters but no bulk setSubgraphs -- use useWorkspace.getState().set(...) for restoring from URL. App.tsx debounces composition at 300ms via COMPOSE_DEBOUNCE_MS.

1. The workspace to save is: subgraphs (array of name+sdl), query, variables, seed. Do NOT save derived state (supergraphSdl, composeErrors, composeHints) or activeSubgraph. On restore, activeSubgraph will default back to 0 from the store's initial state.

2. Install pako for gzip compression:
   Run: nix develop -c bash -c 'cd web && pnpm add pako && pnpm add -D @types/pako'
   This adds ~50 KB gzipped. Both packages are lightweight and well-typed.

3. Add web/src/share.ts with encode/decode:
   a) Declare base64 methods at top (project tsconfig uses ES2022+DOM -- Uint8Array.toBase64() is baseline in browsers but may need a declaration for strict TS):
      interface Uint8Array { toBase64(): string; static fromBase64(str: string): Uint8Array; }
   b) import * as pako from "pako";
   c) Export WorkspacePayload interface: { subgraphs: {name: string, sdl: string}[], query: string, variables: string, seed: number }
   d) Helper uint8ToBase64url(bytes): bytes.toBase64(), replace + with -, / with _, strip = padding.
      Helper base64urlToUint8(str): reverse replacements, pad to multiple of 4, Uint8Array.fromBase64(str).
   e) encode(payload: WorkspacePayload): JSON.stringify -> pako.gzip (returns Uint8Array) -> uint8ToBase64url -> prepend "#w=".
      decode(hash: string): strip "#w=" prefix if present -> base64urlToUint8 -> pako.inflate with { to: "string" } -> JSON.parse as WorkspacePayload.
   Notes: pako.gzip() has no built-in base64 option. Use pako.inflate (not ungzip) since it autodetects gzip via header. URL-safe base64 means the hash fragment needs no encodeURIComponent.

4. In App.tsx, add a debounced effect to update location.hash on workspace edits:
   a) New ref: const hashUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   b) New useEffect depending on [subgraphs, query, variables, seed]:
      - clearTimeout any pending timer.
      - Schedule setTimeout(300ms -- match COMPOSE_DEBOUNCE_MS) that reads useWorkspace.getState(), builds a WorkspacePayload, calls encode(payload), assigns to location.hash.
      - Cleanup clears timeout.
   300ms debounce prevents flooding the hash on rapid keystrokes.

5. On app load (mount only), decode any URL hash:
   New useEffect with [] dependency array in App.tsx:
   a) Read location.hash. Skip if empty or does not start with "#w=".
   b) Try: call decode(hash), then useWorkspace.getState().set({ subgraphs, query, variables, seed, activeSubgraph: 0 }).
   c) Catch: console.warn the error and fall through to defaults (Zustand persist middleware already supplies them).
   Empty dependency array ensures this fires once before any user edits.

6. Corrupt hash handling:
   The try/catch covers all failure modes: invalid base64, truncated gzip, malformed JSON. console.warn gives debugging visibility without UI noise. Fall-through to localStorage persist state or factory defaults on first load.

7. Verify manually:
   a) Edit subgraph SDL, query, variables, seed. Copy URL from address bar. Open in new tab -- confirm identical workspace loads.
   b) Test corrupt hash: mangle the fragment manually, reload -- should show default workspace without errors beyond the warning.
   c) Run: nix develop -c bash -c 'cd web && pnpm tsc --noEmit' and pnpm lint -- both must pass.

8. Tests for share.ts (add web/src/share.test.ts):
   a) Round-trip: decode(encode(payload)) equals original payload for a known workspace with multiple subgraphs.
   b) Decode returns correct subgraphs, query, variables, and seed values.
   c) Decode throws on empty string, random base64, and truncated gzip data (assert with toThrow).
   d) Encode produces output starting with "#w=" prefix.
<!-- SECTION:PLAN:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: Serialize workspace into shareable URL hash

## Summary
Encode the workspace (subgraphs, query, variables, seed) as JSON → gzip-compress with pako → base64-encode into `location.hash` for shareability. On app load, decode the hash and hydrate the Zustand store before rendering. A simple try/catch around decode handles corrupt hashes by falling back to defaults.

## Findings

### 1. Compression: pako gzip/ungzip
**Recommendation**: Use `pako.gzip()` for compression and `pako.inflate()` (with `{ to: 'string' }`) for decompression. Pako is a zlib port, produces binary-identical output to native zlib, and runs at C-like speeds in modern JS engines (~10 ops/sec for 1 MB gzip).

**API signatures (from @types/pako):**

```typescript
// Compress: string → Uint8Array (gzip wrapper)
function gzip(data: Data | string, options?: DeflateFunctionOptions): Uint8Array;

// Decompress: Uint8Array → string (autodetects gzip/deflate via header)
function inflate(data: Data, options: InflateFunctionOptions & { to: "string" }): string;
// or equivalently (shortcut — same thing):
function ungzip(data: Data, options: InflateFunctionOptions & { to: "string" }): string;

type DeflateFunctionOptions = {
  level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  windowBits?: number;
  memLevel?: number;
  strategy?: StrategyValues;
  raw?: boolean;
};

type InflateFunctionOptions = {
  windowBits?: number;
  raw?: boolean;
  to?: "string";
};

type Data = Uint8Array | ArrayBuffer;
```

**Usage pattern for share.ts:**
```
encode(workspace):
  const json = JSON.stringify(workspace);          // string
  const gzipped = pako.gzip(json);                 // Uint8Array
  const b64 = uint8ToBase64(gzipped);              // string
  return "#w=" + b64;

decode(hashValue):
  const jsonStr = pako.inflate(base64ToUint8(b64), { to: "string" });
  return JSON.parse(jsonStr) as WorkspacePayload;
```

**Gotcha**: `pako.gzip()` returns a `Uint8Array`, not a string. You must convert it to base64 yourself — pako does not have a built-in `{ to: 'base64' }` option. The `to: 'string'` option only exists on inflate (decompress), not gzip.

### 2. Base64 encoding/decoding
**Recommendation**: Use native browser APIs — no extra dependency needed.

- **Encode**: `Uint8Array.prototype.toBase64()` — available natively in all modern browsers (baseline Sept 2025). For URL safety, replace `+` → `-`, `/` → `_`, strip trailing `=` padding: `.replaceAll('+', '-').replaceAll('/', '_').replace(/=/g, '')`.
- **Decode**: `Uint8Array.fromBase64()` — also native baseline. For URL-safe input, reverse the replacements first: `.replaceAll('-', '+').replaceAll('_', '/')`, then add back padding as needed (`while (str.length % 4) str += '='`).

**TypeScript note**: TypeScript 5.6+ includes `Uint8Array.prototype.toBase64()` and `fromBase64()` in lib definitions. If the project's TS config doesn't include them, add `"dom"` or `"esnext"` to lib, or declare:
```typescript
interface Uint8Array {
  toBase64(): string;
  static fromBase64(str: string): Uint8Array;
}
```

**Fallback** (if TS lib doesn't include these methods yet): use `btoa()` / `atob()` with a manual byte loop, or add the lightweight `@waiting/base64` package. But prefer native — it's baseline now.

### 3. URL hash size limits
**Chromium**: ~2 MB (2,097,152 chars) for full URLs including hash.
**Firefox**: ~2 MB.
**Safari**: ~2 MB.
**Edge (legacy)**: ~2,083 chars — but the project targets modern browsers and legacy Edge is EOL.

For GraphQL SDLs, gzip + base64url typically yields 1.5–2× the original size for small inputs but compresses well for larger multi-subgraph workspaces. A workspace with 3–5 subgraphs of moderate SDL should stay well under 100 KB encoded — comfortably within limits.

**Gotcha**: Hash fragments are never sent to the server, so they don't affect server logs or CDN caching. However, `location.hash` changes do NOT trigger a page reload and are not included in HTTP requests — this is ideal for our use case.

### 4. Hash vs History API tradeoffs
The task specifies `location.hash`. This is the right choice here because:
- **No history pollution**: Changing hash doesn't create browser history entries (unlike `pushState`), so rapid debounced updates won't fill the back-button stack.
- **Zero server impact**: Hash is purely client-side; no server routing needed.
- **Bookmarkable**: The full URL with hash can be bookmarked and shared.

If you later want cleaner URLs (no `#`), use `history.replaceState()` instead — but it creates history entries on every debounced update, requiring careful management to avoid back-button issues. For a shareable-playground tool, hash is simpler and correct.

### 5. Store integration points
The existing store (`web/src/store.ts`) uses Zustand with `persist` middleware (localStorage). The workspace payload to save/restore:

```typescript
interface WorkspacePayload {
  subgraphs: SubgraphInput[];   // { name: string, sdl: string }[]
  query: string;
  variables: string;
  seed: number;
}
```

**Do NOT persist**: `activeSubgraph`, `supergraphSdl`, `composeErrors`, `composeHints` — these are derived state. The task explicitly says "Do NOT save derived state (the supergraph)."

**Integration approach**: On app load (in `App.tsx` or a top-level effect), check `location.hash`. If it starts with `#w=`, decode and call the appropriate store setters (`setSubgraphs`, `setQuery`, `setVariables`, `setSeed`). Wrap in try/catch — on failure, silently fall back to defaults.

**Debounced hash update**: On any workspace edit (subgraph SDL change, query change, variables change, seed change), schedule a debounced effect (~300 ms, matching the existing compose debounce pattern already used in App.tsx) that reads current store state and updates `location.hash`. Use `useEffect` with a `setTimeout`-based debounce — no external library needed since lodash isn't installed.

### 6. Error handling for corrupt hashes
**Pattern**: Wrap decode in try/catch. If any step fails (invalid base64, invalid gzip, invalid JSON), catch and fall back to defaults. Log a console warning for debugging but do not crash the app or show an error UI — the user experience should be seamless.

```typescript
try {
  const workspace = decode(hashValue);
  hydrateStore(workspace);
} catch (e) {
  console.warn('Failed to decode workspace from URL hash, using defaults:', e);
  // store already has defaults via Zustand persist middleware
}
```

### 7. Package installation
Per the task plan: `pnpm add pako && pnpm add -D @types/pako` inside `web/`. Both are lightweight (~50 KB gzipped for pako). The TypeScript types from `@types/pako` cover all exported functions and classes.

## Sources
- **Kept**: Pako 2.1.0 API docs (https://nodeca.github.io/pako) — primary source for gzip/ungzip usage patterns and performance benchmarks
- **Kept**: @types/pako DefinitelyTyped definitions (https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/pako/index.d.ts) — exact TypeScript type signatures for all pako functions
- **Kept**: MDN Uint8Array.toBase64() / fromBase64() (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64) — native base64 APIs, baseline since Sept 2025
- **Kept**: URL length limits investigation (https://github.com/simonw/research/tree/main/url-limits-investigation) — cross-browser max URL lengths including hash fragments
- **Kept**: Hash vs History API comparison (https://stackoverflow.com/questions/9340121) — tradeoffs for client-side state management
- **Kept**: Base64 vs Base64URL comparison (https://dev.to/hamzamoustaid/base64-vs-base64url-vs-url-encoding-when-should-you-use-each-4k3e) — URL-safe encoding considerations
- **Dropped**: zipurl npm package (https://github.com/zerodevx/zipurl) — overkill; task specifies pako + manual base64, no need for a dedicated library
- **Dropped**: @waiting/base64 npm package — native APIs are baseline now, no need for a polyfill

## Gaps
1. **Exact TypeScript lib config**: The project uses TS 5.6.3 — need to verify whether `Uint8Array.prototype.toBase64()` is in the active lib definitions or if a type declaration is needed. Check `web/tsconfig.json`.
2. **Typical workspace payload size**: No benchmark exists for how large a realistic multi-subgraph GraphQL playground workspace serializes to after gzip+base64. Should test with 3–5 subgraphs of realistic SDLs to confirm hash stays well under the ~2 MB limit.
3. **Concurrent hash reads**: If the user opens the same URL in multiple tabs, each tab independently decodes from its own hash — no cross-tab sync needed, but worth noting.
4. **URL encoding edge cases**: The `#` character inside the base64 payload is impossible (base64 uses A-Z, a-z, 0-9, +, /). With URL-safe replacement (+→-, /→_), the payload contains only safe characters. No encodeURIComponent needed for the hash fragment itself.

<!-- SECTION:NOTES:END -->
