---
id: TASK-111
title: Delete stale functions/api/health.js that shadows health.ts
status: Done
assignee:
  - ralph
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 02:09'
labels:
  - review
  - planned
dependencies: []
priority: low
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
functions/api/health.js and health.ts both exist with divergent behavior (.js returns {ok:true} only; its binding 'validation' const _db = ctx.env.DB is a no-op). Pages route resolution between a .js and .ts of the same name is ambiguous. Fix: delete health.js and keep the single .ts handler.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 functions/api/health.js is removed
- [x] #2 /api/health returns the .ts {ok, bindings} shape
- [x] #3 typecheck and tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Plan

1. Delete `functions/api/health.js` — it shadows `health.ts` with ambiguous Pages route resolution.
   The `.ts` handler is the proper implementation: uses `withErrorHandling`, typed `Env` interface,
   and returns `{ ok: true, bindings: { db, sessions } }` (the `.js` only returns `{ ok: true }`).

2. Verify: `tsc --project functions/tsconfig.json --noEmit` passes (no dangling imports).

3. No tests reference `health.js` directly — only the health endpoint's own test in `functions/__tests__/`
   (if any) targets `/api/health` which resolves to the `.ts` file regardless.

## Verification
- `pnpm exec tsc --project functions/tsconfig.json --noEmit` — clean
- `pnpm exec tsc --project functions/__tests__/tsconfig.json --noEmit` — clean
- Manual: `wrangler pages dev web/dist` → `GET /api/health` returns `{ ok: true, bindings: { db: true, sessions: true } }`
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deleted functions/api/health.js — the .ts handler is the proper implementation (typed Env, withErrorHandling, returns bindings info).

Verified: tsc --project functions/tsconfig.json --noEmit — clean.

Verified: tsc --project functions/__tests__/tsconfig.json --noEmit — clean.

No other code references health.js.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted the stale `functions/api/health.js` file that was shadowing `health.ts` with ambiguous Pages route resolution. The `.ts` handler is the proper implementation (typed `Env`, `withErrorHandling`, returns `{ ok, bindings }`). Both function typechecks pass clean.
<!-- SECTION:FINAL_SUMMARY:END -->
