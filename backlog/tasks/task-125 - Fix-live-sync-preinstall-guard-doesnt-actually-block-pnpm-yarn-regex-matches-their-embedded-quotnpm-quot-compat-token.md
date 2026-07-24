---
id: TASK-125
title: >-
  Fix: live-sync preinstall guard doesn't actually block pnpm/yarn (regex
  matches their embedded &quot;npm/?&quot; compat token)
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-24 03:06'
updated_date: '2026-07-24 04:09'
labels:
  - review-followup
dependencies:
  - TASK-124
priority: high
type: bug
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-124 (live-sync/package.json). TASK-124's AC #2 required the new `preinstall` script to fail fast when invoked via a non-npm user agent, specifically to stop pnpm from silently corrupting live-sync/node_modules again (the exact recurrence TASK-123 and TASK-124 both exist to prevent). The AC was checked off, but the guard does not actually work.

The guard is: `if (!/\bnpm\b/.test(process.env.npm_config_user_agent||'')) { ...reject... }`

Verified live in this repo with the real package managers installed (pnpm 11.10.0, yarn 1.22.22, npm 10.9.8):
- npm sets `npm_config_user_agent` to `"npm/10.9.8 node/v22.23.1 linux x64 workspaces/false"`
- pnpm sets it to `"pnpm/11.10.0 npm/? node/v24.18.0 linux x64"`
- yarn sets it to `"yarn/1.22.22 npm/? node/v24.18.0 linux x64"`

Both pnpm and yarn embed a literal `npm/?` compatibility token in their user-agent string. The word-boundary regex `\bnpm\b` matches that token too, so the guard passes (exits 0) for real pnpm and yarn invocations — it only ever rejected the synthetic user-agent string (`pnpm/9.0.0`, with no `npm/?` token) that TASK-124's own verification step fabricated, which is why the gap wasn't caught. In practice, `pnpm install` run against live-sync/ today would sail through the guard exactly as before TASK-124, silently corrupting node_modules again.

Axis: Correctness (an acceptance criterion was checked off that isn't actually true) and Resilience (the one thing this guard exists to catch, it doesn't catch).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Running the preinstall script with pnpm's real user-agent shape (npm_config_user_agent="pnpm/11.10.0 npm/? node/v24.18.0 linux x64" npm run preinstall, from inside live-sync/) exits non-zero with the existing clear error message
- [x] #2 Running the preinstall script with yarn's real user-agent shape (npm_config_user_agent="yarn/1.22.22 npm/? node/v24.18.0 linux x64" npm run preinstall) exits non-zero with the existing clear error message
- [x] #3 Running the preinstall script with npm's real user-agent (plain npm run preinstall, or npm_config_user_agent="npm/10.9.8 node/v22.23.1 linux x64 workspaces/false" npm run preinstall) exits 0
- [x] #4 nix develop -c npm --prefix live-sync test passes (26/26) after a clean rm -rf live-sync/node_modules && npm --prefix live-sync install
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions. This ticket is scoped to live-sync/package.json's preinstall script only.

1. Open live-sync/package.json. Find the "preinstall" script under "scripts":
   "preinstall": "node -e \"if (!/\\bnpm\\b/.test(process.env.npm_config_user_agent||'')) { console.error('ERROR: live-sync is an npm-only project — do not run pnpm/yarn here. Use: npm --prefix live-sync install'); process.exit(1); }\"",

2. Replace the regex `/\bnpm\b/` with `/^npm\//` — i.e. check that npm_config_user_agent STARTS WITH "npm/", not that it merely contains the word "npm" anywhere. This is the same detection approach corepack uses, and it correctly distinguishes real npm from pnpm/yarn, both of which append their own "npm/?" compatibility token later in the string. The new script line:
   "preinstall": "node -e \"if (!/^npm\\//.test(process.env.npm_config_user_agent||'')) { console.error('ERROR: live-sync is an npm-only project — do not run pnpm/yarn here. Use: npm --prefix live-sync install'); process.exit(1); }\"",

3. Verify against real package managers (do not fabricate user-agent strings — use the actual values each tool sets, which you can print with `node -e "console.log(process.env.npm_config_user_agent)"` invoked via `npm run <script>`, `pnpm run <script>`, and `yarn <script>` on a throwaway script, or just reuse the values below which were captured live in this environment):
   a. `cd live-sync && npm_config_user_agent="pnpm/11.10.0 npm/? node/v24.18.0 linux x64" npm run preinstall` — must exit non-zero with the ERROR message.
   b. `cd live-sync && npm_config_user_agent="yarn/1.22.22 npm/? node/v24.18.0 linux x64" npm run preinstall` — must exit non-zero with the ERROR message.
   c. `cd live-sync && npm run preinstall` (real npm, no override) — must exit 0 with no output.
   If `pnpm` and/or `yarn` binaries are available in the environment, additionally confirm directly: `cd live-sync && pnpm install` and `cd live-sync && yarn install` both abort with the ERROR message instead of installing.

4. Do a clean reinstall to prove npm still works end-to-end: `rm -rf live-sync/node_modules && nix develop -c npm --prefix live-sync install`.

5. Run: `nix develop -c npm --prefix live-sync test` — confirm 26/26 tests pass.

6. Run: `git status` to confirm only live-sync/package.json (and this task file) show as changed — no pnpm-lock.yaml/pnpm-workspace.yaml artifacts reappeared.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed preinstall guard regex from /\bnpm\b/ to /^npm\// so it checks that npm_config_user_agent STARTS WITH 'npm/' rather than merely containing the word 'npm'. This correctly rejects pnpm/yarn whose user-agent strings embed an 'npm/?' compat token (e.g. 'pnpm/11.10.0 npm/? node/v24.18.0 linux x64'). Verified: pnpm agent → exit 1, yarn agent → exit 1, real npm → exit 0. All 26/26 live-sync tests pass after clean reinstall.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
One-line fix in live-sync/package.json: changed preinstall regex from /\bnpm\b/ (matches anywhere, including pnpm/yarn's 'npm/?' compat token) to /^npm\// (must start with 'npm/'). Verified against real user-agent strings for all three package managers. All 26 live-sync tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
