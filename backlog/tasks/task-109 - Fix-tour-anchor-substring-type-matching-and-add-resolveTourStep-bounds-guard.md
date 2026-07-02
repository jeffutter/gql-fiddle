---
id: TASK-109
title: Fix tour anchor substring type matching and add resolveTourStep bounds guard
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:28'
updated_date: '2026-07-02 14:45'
labels:
  - review
  - planned
dependencies: []
priority: medium
ordinal: 146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/tourHighlight.ts:41 gates the field-anchor branch with line.includes(typeName), so anchor 'User' latches onto 'type UserProfile {' or a field line 'user: User' — highlighting the wrong line (the no-fieldName branch already uses a precise regex). Also typeName/fieldName are interpolated into new RegExp unescaped (throws on regex metacharacters). Separately, web/src/share.ts:145 resolveTourStep does no bounds check on stepIndex — tour.steps[stepIndex] can be undefined (empty steps / out-of-range initialStepIndex) and step.overrides then throws. Fix: reuse the precise declaration regex for the enter-type test, escapeRegExp interpolated names, and guard 'if (\!step) return tour.base;'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 an anchor for User.id highlights User, not UserProfile
- [x] #2 a field name containing regex metacharacters does not throw
- [x] #3 an out-of-range or empty tour step returns the base payload without throwing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Two independent, small bug fixes in web/src/. No sub-tickets needed — this
is a single focused session (~20-30 lines across 2 files + tests).

## 1. web/src/tourHighlight.ts — precise type-anchor matching + regex escaping

Root cause: `findAnchorLine`'s field-anchor branch (line 41) uses
`line.includes(typeName)` as a substring test to detect "entering the type
block", so anchor `User` also matches `type UserProfile {` and any line
containing `User` as a substring (e.g. `user: User`). The no-fieldName
branch (line 56) already does this correctly with an anchored regex:
`^(type|interface)\s+${typeName}[\s{@]`.

Also, `typeName` and `fieldName` are interpolated into `new RegExp(...)`
unescaped in both branches (lines 46 and 56) — a type/field name containing
regex metacharacters (e.g. from a schema with unusual names, though in
practice GraphQL names are `/[_A-Za-z][_0-9A-Za-z]*/` — still, defend
against it per the acceptance criteria) will throw.

Fix:
- Add a small local `escapeRegExp(s: string): string` helper at the top of
  tourHighlight.ts (replace regex metacharacters with escaped versions —
  standard `s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`).
- In `findAnchorLine`, replace the field-branch's `line.includes(typeName)`
  gate (line 41) with the same anchored declaration regex used by the
  no-fieldName branch: `new RegExp(\`^(type|interface)\\s+${escapeRegExp(typeName)}[\\s{@]\`).test(line)`.
  This makes both branches share the identical "is this the declaration
  line for typeName" test — consider factoring it into one small helper
  (e.g. `isTypeDeclarationLine(line, typeName)`) used by both branches to
  avoid duplicating the regex construction, per the "reuse the precise
  declaration regex" instruction in the ticket.
- Escape `fieldName` before interpolating into the `fieldPattern` regex on
  line 46: `new RegExp(\`^\\s+${escapeRegExp(fieldName)}\\s*[:(]\`)`.
- Escape `typeName` in the no-fieldName branch's regex construction (line 56)
  too, for consistency and safety.

## 2. web/src/share.ts — resolveTourStep bounds guard

`resolveTourStep` (line 145-149) does `tour.steps[stepIndex]` with no bounds
check; `step.overrides` then throws a TypeError if `step` is `undefined`
(empty `steps` array, or `stepIndex` out of range from a stale/crafted
`initialStepIndex`).

Fix: add a guard immediately after the lookup:
```ts
const step = tour.steps[stepIndex];
if (!step) return tour.base;
if (!step.overrides) return tour.base;
return { ...tour.base, ...step.overrides };
```
(the two `if` branches can be combined: `if (!step || !step.overrides) return tour.base;`)

## Tests

Add/extend tests in:
- web/src/tourHighlight.test.ts — case: SDL containing both `type User {`
  and `type UserProfile {`, anchor `{ typeName: "User", fieldName: "id" }`
  must resolve to the `type User {` block, not `UserProfile`. Case: a
  fieldName/typeName containing a regex metacharacter (e.g. a name with
  `+` or `.` — construct synthetically even though real GraphQL names won't
  have one, to prove the escaping) does not throw.
- web/src/share.test.ts — extend the existing `resolveTourStep` describe
  block: call `resolveTourStep(tour, stepIndex)` with `stepIndex` out of
  range (e.g. steps.length) and with an empty `steps: []` tour, assert it
  returns `tour.base` without throwing.

## Verification

- `just check` or `web` package's `pnpm test`/`pnpm typecheck` (see
  AGENTS.md for exact commands) to confirm lint/typecheck/tests pass.
- Confirm all three acceptance criteria are covered by the new tests above.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed tourHighlight.ts: added escapeRegExp() helper and isTypeDeclarationLine() shared helper; the field-anchor branch now uses the same anchored '^(type|interface)\s+<name>[\s{@]' regex as the type-only branch instead of line.includes(typeName), and both typeName/fieldName are escaped before interpolation into RegExp. Fixed share.ts resolveTourStep: added 'if (!step || !step.overrides) return tour.base;' guard for out-of-range/empty steps. Added tests: tourHighlight.test.ts covers User vs UserProfile disambiguation, 'user: User' field-line false-positive avoidance, and regex-metacharacter names not throwing; share.test.ts covers out-of-range stepIndex and empty steps array both returning tour.base without throwing. Verified: pnpm test run (404/404 pass), pnpm tsc --noEmit (clean), eslint (clean), prettier --check (clean).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the substring-based type-block detection in tourHighlight.ts's findAnchorLine with the same anchored declaration regex used elsewhere, added regex-escaping for interpolated type/field names, and added a bounds guard in share.ts's resolveTourStep so out-of-range or empty tour steps fall back to tour.base instead of throwing. Added covering unit tests in tourHighlight.test.ts and share.test.ts; full web test suite, typecheck, eslint, and prettier all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
