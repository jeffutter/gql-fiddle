---
id: TASK-52
title: 'CI: cache pnpm store for web-checks and e2e jobs'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-15 12:11'
updated_date: '2026-06-15 22:05'
labels:
  - ci
  - infra
  - planned
dependencies:
  - TASK-50
priority: medium
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `web-checks` and `e2e` jobs (from TASK-50) each run `pnpm install --frozen-lockfile` from scratch. Add caching for pnpm's content-addressable store (the path returned by `pnpm store path`, typically `~/.local/share/pnpm/store`), keyed on `web/pnpm-lock.yaml`'s hash with a restore-key fallback. This lets `pnpm install` reuse previously-fetched packages (Monaco, Mermaid, Playwright, Vite, etc.) instead of re-downloading the full dependency tree on every run.

Note: Playwright's e2e tests launch via `process.env.CHROME` (Nix-provided Chromium, see `web/playwright.config.ts`), so no separate Playwright browser-binary cache is needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web-checks and e2e jobs cache the pnpm store keyed on web/pnpm-lock.yaml's hash, with a restore-key fallback
- [ ] #2 pnpm install --frozen-lockfile reuses cached packages on an unchanged lockfile, verified via the Actions log showing a cache hit and reduced install time
- [x] #3 The pnpm cache is named/scoped so it doesn't collide with the Cargo caches from TASK-51
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Add pnpm store caching to the `web-checks` and `e2e` jobs in `.github/workflows/ci.yml`
using `actions/cache@v4` keyed on `web/pnpm-lock.yaml`'s hash. Since pnpm comes from the
Nix flake (`pkgs.pnpm`), the store path must be resolved via `nix develop -c pnpm store path`
rather than relying on `actions/setup-node`'s built-in pnpm cache integration (which isn't
used here).

## Implementation

For both `web-checks` and `e2e` jobs, insert two new steps after
`magic-nix-cache-action` / `download-artifact` and before the `Web install` step:

```yaml
- name: Get pnpm store path
  id: pnpm-store
  run: echo "path=$(nix develop -c bash -c 'cd web && pnpm store path')" >> "$GITHUB_OUTPUT"

- name: Cache pnpm store
  uses: actions/cache@v4
  with:
    path: ${{ steps.pnpm-store.outputs.path }}
    key: pnpm-store-${{ runner.os }}-${{ hashFiles('web/pnpm-lock.yaml') }}
    restore-keys: |
      pnpm-store-${{ runner.os }}-
```

Notes:
- `pnpm store path` returns an absolute path (typically `~/.local/share/pnpm/store/v3`
  or similar under the runner's home); capturing it dynamically via `$GITHUB_OUTPUT`
  avoids hardcoding a path that could change with the pnpm version pinned in the flake.
- Key prefix `pnpm-store-` (AC #3) is distinct from the Cargo cache `shared-key`s used
  in TASK-51 (`rust-checks`, `wasm-build`, `wasm-browser-tests`), so no collision.
- `restore-keys` provides the fallback (AC #1): on a lockfile change, falls back to the
  most recent `pnpm-store-${{ runner.os }}-` entry, letting pnpm fetch only the diff.
- Both `web-checks` and `e2e` get this added independently (each runner gets its own
  cache entry under the same key — GitHub Actions cache is per-job/runner but shared
  across jobs with matching keys within a run's scope, so the second job to run can
  reuse the first's cache if keys match exactly, or fall back via restore-keys).

## Placement in ci.yml

### `web-checks` job
Insert the two new steps between `download-artifact` (Download WASM bindings) and
`Web install`.

### `e2e` job
Same placement: between `download-artifact` (Download WASM bindings) and `Web install`.

## Verification

1. Push the change (or open a PR) and confirm in the Actions log for both `web-checks`
   and `e2e`:
   - "Get pnpm store path" step resolves successfully and outputs a path.
   - "Cache pnpm store" step reports a cache miss on first run (new key), then saves
     the cache at the end of the job.
2. Trigger a second run with an unchanged `web/pnpm-lock.yaml` (e.g. push an unrelated
   small commit) and confirm:
   - The cache step reports a cache hit for both jobs.
   - The subsequent `pnpm install --frozen-lockfile` step shows noticeably reduced
     time vs the cold run (AC #2) — compare step duration in the Actions UI.
3. Confirm in the Actions "Caches" tab (repo Settings > Actions > Caches) that the
   `pnpm-store-*` cache entries are distinct from the `rust-checks` / `wasm-build` /
   `wasm-browser-tests` Cargo cache entries from TASK-51 (AC #3).

## Out of scope

- No Playwright browser-binary cache needed — e2e tests launch Chromium via
  `process.env.CHROME` (Nix-provided), per the ticket description.
- `rust-checks`, `wasm-build`, `wasm-browser-tests` jobs are untouched (Cargo caching
  is TASK-51, already done).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added pnpm store caching to both web-checks and e2e jobs in .github/workflows/ci.yml. Each job now has two new steps inserted between 'Download WASM bindings' and 'Web install': 'Get pnpm store path' (resolves the store path via 'nix develop -c bash -c "cd web && pnpm store path"' and writes it to $GITHUB_OUTPUT) and 'Cache pnpm store' (actions/cache@v4, keyed on pnpm-store-${{ runner.os }}-${{ hashFiles('web/pnpm-lock.yaml') }} with a restore-keys fallback of pnpm-store-${{ runner.os }}-). Verified locally that 'nix develop -c bash -c "cd web && pnpm store path"' resolves to a valid absolute path (/home/jeffutter/.local/share/pnpm/store/v11). YAML validated with yamllint (only pre-existing-style line-length warnings, consistent with other long run: lines in the file). The pnpm-store- key prefix is distinct from the rust-checks/wasm-build/wasm-browser-tests Cargo cache shared-keys from TASK-51 (AC #3). AC #2 (cache hit + reduced install time on a second run with unchanged lockfile) can only be confirmed by inspecting the Actions log after this is pushed and run twice -- left unchecked pending that CI verification.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added pnpm store caching (actions/cache@v4) to the web-checks and e2e jobs in .github/workflows/ci.yml, keyed on web/pnpm-lock.yaml's hash with a restore-key fallback, using a dynamically-resolved 'pnpm store path' (via nix develop) so pnpm install --frozen-lockfile can reuse previously-fetched packages. The pnpm-store- key prefix is distinct from TASK-51's Cargo cache shared-keys. AC #2 (cache hit on a repeat run) requires inspecting the Actions log after pushing.
<!-- SECTION:FINAL_SUMMARY:END -->
