---
id: TASK-49
title: >-
  Remove zstd spike code — uninstall @bokuweb/zstd-wasm and delete benchmark
  tests
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-14 12:22'
updated_date: '2026-06-14 12:26'
labels:
  - cleanup
milestone: m-4
dependencies:
  - TASK-44
priority: low
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-44 concluded that zstd compression is a NO-GO (gzip wins, bundle cost too high). The spike left behind production clutter: `@bokuweb/zstd-wasm` was installed as a `dependencies` entry (not devDependencies) and `web/src/zstd-bundle.test.ts` exists solely to measure bundle sizes of a package we are not using.

Files to remove:
- `web/src/zstd-bundle.test.ts` — entire file
- Remove `@bokuweb/zstd-wasm` from `web/package.json` dependencies
- Run `pnpm install` to regenerate `web/pnpm-lock.yaml`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 @bokuweb/zstd-wasm does not appear in web/package.json
- [x] #2 web/src/zstd-bundle.test.ts is deleted
- [x] #3 nix develop -c bash -c 'cd web && pnpm test run' passes with no references to zstd-bundle
- [x] #4 nix develop -c bash -c 'cd web && pnpm tsc --noEmit && pnpm lint' passes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed @bokuweb/zstd-wasm from web/package.json dependencies and deleted web/src/zstd-bundle.test.ts. Ran pnpm install to regenerate pnpm-lock.yaml. Test suite drops from 94 to 89 tests (the 5 deleted bundle-size assertions). pnpm tsc --noEmit and pnpm lint pass cleanly.
<!-- SECTION:FINAL_SUMMARY:END -->
