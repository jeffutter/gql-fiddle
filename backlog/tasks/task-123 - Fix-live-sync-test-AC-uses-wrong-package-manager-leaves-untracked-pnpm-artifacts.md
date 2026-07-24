---
id: TASK-123
title: >-
  Fix: live-sync test AC uses wrong package manager, leaves untracked pnpm
  artifacts
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-23 20:50'
updated_date: '2026-07-23 20:55'
labels:
  - review-followup
dependencies:
  - TASK-122
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-120, TASK-121, and TASK-122 (live-sync/). All three tickets' final acceptance criterion is 'nix develop -c pnpm --dir live-sync test run passes', but live-sync is an npm project: live-sync/package-lock.json is tracked in git and there is no tracked pnpm lockfile. Running the prescribed pnpm command fails non-interactively with ERR_PNPM_IGNORED_BUILDS (pnpm wants an interactive 'pnpm approve-builds' pass for better-sqlite3/esbuild/sharp/workerd) and, on a prior attempt, left two untracked debris files sitting in the repo: live-sync/pnpm-lock.yaml and live-sync/pnpm-workspace.yaml (the latter is a malformed stub with placeholder text like 'better-sqlite3: set this to true or false' instead of an actual pnpm config value — it does not actually grant build approval). I confirmed the underlying code changes in all three tickets are correct by running 'nix develop -c npm --prefix live-sync test' instead (18/18 tests pass) and 'nix develop -c npx --prefix live-sync tsc --noEmit' (clean) — this is a tooling/AC-command mismatch, not a code defect, but it means the literal DoD command in three Done tickets cannot be reproduced non-interactively, and the working tree carries build debris that keeps reappearing. Axis: Resilient/Organized.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 live-sync/pnpm-lock.yaml and live-sync/pnpm-workspace.yaml do not exist in the working tree (deleted, not just untracked)
- [ ] #2 .gitignore has entries for live-sync/pnpm-lock.yaml and live-sync/pnpm-workspace.yaml so pnpm cannot silently recreate tracked-looking debris there again
- [ ] #3 nix develop -c npm --prefix live-sync test passes (18/18)
- [ ] #4 nix develop -c npx --prefix live-sync tsc --noEmit -p live-sync/tsconfig.json exits clean
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions. This ticket is scoped to live-sync/ (a standalone Cloudflare Worker that uses npm, not pnpm — its tracked lockfile is live-sync/package-lock.json).

1. Run: git rm --cached live-sync/pnpm-lock.yaml live-sync/pnpm-workspace.yaml if either is tracked (it should not be — confirm with 'git ls-files live-sync/' first); then delete both files from the working tree with rm.
2. Open .gitignore at the repo root and add two lines under the existing '# Node / web' section: 'live-sync/pnpm-lock.yaml' and 'live-sync/pnpm-workspace.yaml' — this prevents them from showing up as untracked clutter if pnpm is invoked against live-sync again by mistake.
3. live-sync/package.json already declares a top-of-file 'allowScripts' map (better-sqlite3, esbuild, workerd, sharp all true) — leave this field as-is; it is unrelated to this ticket's scope even though it has no effect under npm.
4. Verify the native better-sqlite3 binding is usable in this environment: run 'nix develop -c bash -c "cd live-sync && npm rebuild better-sqlite3"' if 'npm --prefix live-sync test' reports a 'Module did not self-register' error.
5. Run: nix develop -c npm --prefix live-sync test — confirm all 18 tests across tests/session.test.ts and tests/live-session.test.ts pass.
6. Run: nix develop -c npx --prefix live-sync tsc --noEmit -p live-sync/tsconfig.json — confirm no type errors.
7. Run: git status to confirm live-sync/pnpm-lock.yaml and live-sync/pnpm-workspace.yaml no longer appear as untracked files.
8. Do NOT introduce a new pnpm-workspace.yaml or attempt to make 'pnpm --dir live-sync' work — the fix is to stop generating pnpm artifacts against an npm-managed subproject, not to make pnpm's build-approval gate pass non-interactively.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- [x] #1 live-sync/pnpm-lock.yaml and live-sync/pnpm-workspace.yaml deleted from working tree
- [x] #2 .gitignore entries added for both files under '# Node / web' section
- [x] #3 npm --prefix live-sync test: 18/18 tests pass
- [x] #4 npx --prefix live-sync tsc --noEmit exits clean (no errors)
- [x] git status confirms no untracked pnpm artifacts in live-sync/
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted live-sync/pnpm-lock.yaml and live-sync/pnpm-workspace.yaml from working tree (they were pnpm artifacts generated against an npm-managed project). Added both paths to .gitignore under the '# Node / web' section to prevent recurrence. Verified 18/18 tests pass under npm and tsc --noEmit exits clean.
<!-- SECTION:FINAL_SUMMARY:END -->
