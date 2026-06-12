---
id: TASK-39
title: 'Fix: share.ts uses Node-only Buffer, breaking URL sharing in the browser'
status: To Do
assignee: []
created_date: '2026-06-12 12:00'
labels:
  - review-followup
milestone: m-4
dependencies:
  - TASK-23
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-23 (web/src/share.ts:14,28). encode() and decode() call Buffer.from(), a Node.js global. The browser build has no Buffer polyfill (vite.config.ts defines none and no node-polyfills plugin is installed), so at runtime in the deployed app Buffer is undefined: encode() throws ReferenceError on every workspace edit (the debounced effect in App.tsx) and decode() throws on load. The share feature is therefore entirely non-functional in a real browser. The Vitest suite is green only because it runs under jsdom on Node, where Buffer exists — false confidence: AC#2 (hash updates) and AC#3 (restore from URL) are unmet at runtime. The task plan specifically called for Uint8Array.toBase64()/fromBase64() (or btoa/atob) precisely to avoid this. Axis: Correct/Resilient.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/src/share.ts contains zero references to Buffer (grep -n Buffer web/src/share.ts returns nothing)
- [ ] #2 encode/decode use only browser-available APIs (btoa/atob over a binary string, or Uint8Array.toBase64/fromBase64) and the existing round-trip test still passes
- [ ] #3 A test asserts encode() output after the #w= prefix is URL-safe: contains no +, /, or = characters
- [ ] #4 nix develop -c bash -c 'cd web && pnpm test --run' passes and nix develop -c bash -c 'cd web && pnpm tsc --noEmit' passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run "direnv allow" once, or prefix every command with "nix develop -c". Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Open web/src/share.ts. The two offending lines are uint8ToBase64url (uses Buffer.from(bytes).toString("base64")) and base64urlToUint8 (uses Buffer.from(s, "base64")). Both rely on the Node-only Buffer global.

2. Rewrite uint8ToBase64url(bytes: Uint8Array) to use the browser btoa path:
   - Build a binary string: let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
   - const b64 = btoa(bin);
   - return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
   (btoa and atob are available in browsers and in jsdom, so tests still run.)

3. Rewrite base64urlToUint8(str: string) to reverse it:
   - let s = str.replace(/-/g, "+").replace(/_/g, "/");
   - while (s.length % 4 !== 0) s += "=";
   - const bin = atob(s);
   - const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
   - return bytes;

4. Leave pako.gzip / pako.inflate, the HASH_PREFIX logic, and the public encode/decode signatures unchanged. Confirm no Buffer reference remains: grep -n Buffer web/src/share.ts must be empty.

5. In web/src/share.test.ts add a test: encode(SAMPLE_PAYLOAD).slice("#w=".length) matches /^[A-Za-z0-9_-]+$/ (no +, /, or = characters). Keep all existing tests; the round-trip test must still pass.

6. Run and confirm green:
   - nix develop -c bash -c "cd web && pnpm test --run"
   - nix develop -c bash -c "cd web && pnpm tsc --noEmit"
   - nix develop -c bash -c "cd web && pnpm lint"

OUT OF SCOPE: do not change App.tsx; the integration there is correct once encode/decode are browser-safe.
<!-- SECTION:PLAN:END -->
