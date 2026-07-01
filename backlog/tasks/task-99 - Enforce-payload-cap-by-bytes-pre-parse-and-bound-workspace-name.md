---
id: TASK-99
title: 'Enforce payload cap by bytes, pre-parse, and bound workspace name'
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:27'
updated_date: '2026-07-01 23:34'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SEC-DEF-1.00, SEC-ERR-1.00. functions/api/workspaces/[id].ts:23-47 checks payload.length (UTF-16 code units, not bytes), parses the whole body into memory before the size check, and leaves name unbounded. On the Workers free tier this is a memory/CPU DoS vector and lets stored size exceed the documented 1 MB contract. Fix: reject early on the Content-Length header, measure payload bytes with TextEncoder, and add a bound on name length.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a >1 MB body is rejected with 413 before the full JSON parse
- [x] #2 multi-byte payloads are measured in bytes, not UTF-16 length
- [x] #3 an oversized name is rejected with 400
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Problem

`functions/api/workspaces/[id].ts` (onRequestPut) has three related gaps:

1. Reads the whole body via `ctx.request.json()` before any size check, so
   an attacker can force a full JSON parse of an arbitrarily large body
   (CPU + memory cost) on a Workers free-tier invocation limited to 10ms
   CPU burst-to-50ms.
2. The size guard `payload.length > PAYLOAD_SIZE_LIMIT` counts UTF-16 code
   units, not bytes. Multi-byte characters (e.g. CJK, 3 bytes/UTF-8 vs 1
   UTF-16 unit) let a payload store up to ~3x the documented 1 MB limit.
3. `name` has no length bound at all — a large `name` in an otherwise
   small body slips past the payload check entirely.

## Fix — single file: `functions/api/workspaces/[id].ts`

In `onRequestPut`, replace the `ctx.request.json()` + `payload.length` checks
with:

1. **Fast-path reject on declared Content-Length** (before touching the
   body at all):
   ```ts
   const contentLength = ctx.request.headers.get("content-length");
   if (contentLength !== null && Number(contentLength) > PAYLOAD_SIZE_LIMIT) {
     return Response.json({ error: "Payload too large (max 1 MB)" }, { status: 413 });
   }
   ```
   This is the primary DoS mitigation: reject before allocating a buffer
   for the body when the client honestly declares an oversized request.

2. **Read the body as text, then measure real UTF-8 bytes before parsing**
   (defends against a missing/understated Content-Length header — the
   body is already buffered by `.text()`, but we still gate the expensive
   `JSON.parse` on the byte check):
   ```ts
   let rawBody: string;
   try {
     rawBody = await ctx.request.text();
   } catch {
     return Response.json({ error: "Invalid request body" }, { status: 400 });
   }

   if (new TextEncoder().encode(rawBody).length > PAYLOAD_SIZE_LIMIT) {
     return Response.json({ error: "Payload too large (max 1 MB)" }, { status: 413 });
   }

   let body: { name: string; payload: string; version: number };
   try {
     body = JSON.parse(rawBody) as typeof body;
   } catch {
     return Response.json({ error: "Invalid JSON body" }, { status: 400 });
   }
   ```
   Because this check is on the whole raw body (not just the `payload`
   field), it automatically bounds `payload` in bytes too — the old
   `payload.length > PAYLOAD_SIZE_LIMIT` line can be deleted entirely.

3. **Add a byte-bounded `name` check**, after the existing
   `typeof name !== "string"` validation:
   ```ts
   const NAME_MAX_BYTES = 256; // generous for a display name; not a documented contract elsewhere

   if (new TextEncoder().encode(name).length > NAME_MAX_BYTES) {
     return Response.json(
       { error: `Name too long (max ${NAME_MAX_BYTES} bytes)` },
       { status: 400 },
     );
   }
   ```
   `NAME_MAX_BYTES` is a new, previously-undocumented limit — 256 bytes is
   a reasonable default for a workspace display name; adjust only if
   product wants a different value (no existing constraint or product doc
   sets one).

## Tests — `functions/__tests__/workspaces.test.ts`

Add to the `PUT /api/workspaces/:id` describe block:

- **Multi-byte payload over 1 MB in bytes but under 1 MB in UTF-16 units**:
  build `payload` from a 3-byte-UTF-8 character (e.g. `"あ".repeat(400_000)`
  → 400,000 UTF-16 units / ~1.2 MB UTF-8 bytes) and assert 413. This is the
  regression test for AC #2 — it fails under the current `.length` check
  and passes once bytes are measured with `TextEncoder`.
- **Oversized `name`**: `name: "x".repeat(300)` (or whatever exceeds
  `NAME_MAX_BYTES`), small valid payload, assert 400 with a body-parseable
  error.
- Keep the existing ASCII `"x".repeat(1_048_577)` 413 test — it still
  passes (ASCII: 1 byte per char) and continues to cover the
  Content-Length-header fast path, since Node's `fetch` `Request`
  constructor computes `Content-Length` from the string body automatically.
- Sanity-check during implementation: confirm in a quick scratch test that
  the mocked `Request` actually sets `content-length` from the JSON string
  body (Node's `undici` Request does this per-spec) so the header-based
  fast path is exercised, not just the post-`.text()` byte check. If for
  some reason it isn't observable in this environment, note it in the PR
  but keep the header check regardless since Cloudflare's Workers runtime
  does send `Content-Length` for both real HTTP requests and Pages
  Functions.

## Verification

```sh
web/node_modules/.bin/tsc --project functions/tsconfig.json --noEmit
web/node_modules/.bin/tsc --project functions/__tests__/tsconfig.json --noEmit
cd web && pnpm test:functions
```

All three acceptance criteria are covered by the changes above:
- AC #1: Content-Length fast path + byte check before `JSON.parse` → 413 pre-parse.
- AC #2: whole-body `TextEncoder` byte measurement replaces UTF-16 `.length`.
- AC #3: new `NAME_MAX_BYTES` check → 400 on oversized name.

## Scope note

No sub-tickets: this is a single-file fix (~20-30 changed lines) plus two
new test cases in one existing test file, with no architectural ambiguity.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in functions/api/workspaces/[id].ts (onRequestPut): (1) fast-path reject on Content-Length header before touching the body; (2) read body via .text() and measure real UTF-8 bytes with TextEncoder before JSON.parse, replacing the old payload.length UTF-16 check; (3) added NAME_MAX_BYTES=256 byte-bounded check on name. Added two regression tests in functions/__tests__/workspaces.test.ts: multi-byte payload over 1MB in bytes but under in UTF-16 units (413), and oversized name (400). Verified: tsc --project functions/tsconfig.json --noEmit, tsc --project functions/__tests__/tsconfig.json --noEmit, and pnpm test:functions (60/60 pass).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the workspace PUT handler to reject oversized bodies before parsing: added a Content-Length fast-path check, replaced the UTF-16 .length payload check with a real UTF-8 byte count via TextEncoder, and added a 256-byte cap on the workspace name. Added regression tests for a multi-byte over-limit payload and an oversized name; all functions tests and type checks pass.
<!-- SECTION:FINAL_SUMMARY:END -->
