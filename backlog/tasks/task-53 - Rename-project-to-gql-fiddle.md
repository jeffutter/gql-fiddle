---
id: TASK-53
title: Rename project to "gql-fiddle"
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-15 15:30'
updated_date: '2026-06-15 21:18'
labels:
  - rebranding
  - planned
dependencies: []
priority: low
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The project is being deployed to Cloudflare Pages under the custom domain gqlfiddle.dev with the Pages project named "gql-fiddle". Update the codebase's naming/branding to match this new identity.

This covers user-visible naming (page title, README, docs) and internal package naming (web/package.json name field), not infrastructure config (which is handled separately in the deploy setup).

Be careful with the Zustand localStorage persistence key in web/src/store.ts (currently "graphql-playground") — changing it would wipe existing users' saved workspaces. Decide deliberately whether to rename it (with a migration) or leave it as an internal-only key, and document the choice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 index.html page title reflects "gql-fiddle" / "GQL Fiddle" branding
- [x] #2 web/package.json "name" field updated to reflect the new project name
- [x] #3 README.md and AGENTS.md references to the old project name updated where they describe the product's name/identity
- [x] #4 Any in-app branding text (e.g. header/title shown in the UI) reflects the new name
- [x] #5 Decision on the localStorage persistence key ("graphql-playground") is made and documented — either left as-is with a comment explaining why, or migrated with a version bump / migration step that preserves existing users' saved workspaces
- [x] #6 pnpm build, pnpm tsc --noEmit, pnpm lint, and pnpm test run all pass after the rename
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Small, single-session rename. No sub-tickets needed — all changes are
mechanical text/name updates plus one deliberate documentation decision about
the localStorage key. Touch points (confirmed via repo-wide search, excluding
`backlog/`, `web/dist/` build output, and `web/src/wasm/` generated code):

1. `web/index.html` — `<title>GraphQL Playground</title>` → `<title>GQL Fiddle</title>`
   (AC #1).

2. `web/package.json` — `"name": "graphql-playground-web"` → `"name": "gql-fiddle-web"`
   (AC #2). Check `web/package-lock`/`pnpm-lock.yaml` for a `name:` field under
   the root project entry and update it too if pnpm's lockfile records it
   (run `pnpm install` afterward to ensure the lockfile is regenerated
   consistently — this is also required by AC #6 anyway).

3. `README.md` (AC #3):
   - `# GraphQL Playground` → `# GQL Fiddle` (title).
   - Update the prose description to reflect the new name (e.g. "GQL Fiddle is
     a browser-only GraphQL federation playground...").
   - Leave the `backlog/docs/doc-1 - GraphQL-Playground-Design.md` and
     `doc-2 - GraphQL-Playground-Implementation-Plan.md` filenames/links
     as-is — these are historical planning docs, not product branding, and
     renaming committed backlog doc files is out of scope and would break
     existing references for no user-facing benefit.

4. `AGENTS.md` (AC #3):
   - Update the opening description line ("Guidance for AI coding agents...") /
     "What this is" section if it names the project (currently it doesn't say
     "GraphQL Playground" by name, so check carefully — only change text that
     describes the *product's* name/identity, not generic "GraphQL" technical
     references which are accurate descriptions of the tech, not the brand).
   - Line 160 references the Zustand persistence key
     `"graphql-playground"` by value — update this line's wording only if the
     key itself changes (see item 6); if the key is left as-is, instead add a
     brief note here (or point to the comment in store.ts) explaining it's a
     legacy/internal key decoupled from the product name.

5. In-app branding (AC #4): searched `web/src/App.tsx` and `web/src/theme.css`
   — there is currently **no rendered app name/logo/header** in the UI (only
   per-panel section titles like "Subgraphs", "Output", which are generic and
   not branding). The only "title shown in the UI" is the browser tab title
   from `index.html`, already covered by item 1. Treat AC #4 as satisfied by
   item 1 and document this explicitly (no new header element should be
   invented — adding one would be a design change outside this ticket's scope
   and AGENTS.md's "don't reinvent the aesthetic" guidance). If review
   disagrees, a follow-up design ticket should own adding a visible app title.

6. localStorage persistence key decision (AC #5): **Leave the key
   `"graphql-playground"` unchanged.** Rationale to document:
   - Zustand's `persist` middleware ties migrations to the stored *value*
     shape via `version`, not to the storage *key* — renaming the key would
     require custom `storage` get/set logic to copy-then-delete the old key,
     adding meaningful complexity for a purely cosmetic internal identifier.
   - The key is never user-visible; only the in-app branding and metadata
     (covered by items 1-4) communicate the product name.
   - Action: add a short comment directly above `name: "graphql-playground"`
     in `web/src/store.ts` (around line 148) explaining it's a legacy
     internal storage key kept stable to avoid wiping existing users' saved
     workspaces during the gql-fiddle rebrand, and is intentionally
     decoupled from the product's display name. Cross-reference this comment
     from AGENTS.md's state-management section (item 4) so future renames
     find the rationale.

## Verification (AC #6)

From `web/` inside the Nix dev shell:
```sh
pnpm install      # regenerate lockfile after package.json name change
pnpm build
pnpm tsc --noEmit
pnpm lint
pnpm test run
```
All four must pass. No test currently asserts on the literal string
"graphql-playground" for the page title (only the localStorage key in
store.ts, which is unchanged) — but grep test files for "GraphQL Playground"
/ "graphql-playground" before finishing to catch any snapshot or e2e
assertions on `index.html`'s title and update them to "GQL Fiddle" if found.

## Out of scope (per ticket description)

- Cloudflare Pages project naming / custom domain / deploy config — handled
  by the separate deploy setup work.
- Renaming `backlog/docs/doc-1`/`doc-2` files.
- Adding a new visible in-app header/logo element (design decision beyond a
  rename; flag for a follow-up if desired).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per plan: (1) web/index.html title -> 'GQL Fiddle'; (2) web/package.json name -> 'gql-fiddle-web' (pnpm install confirmed lockfile already consistent, no changes needed); (3) README.md H1 -> '# GQL Fiddle' (kept backlog/docs/doc-1, doc-2 filenames as historical, unchanged); (4) AGENTS.md state-management section now cross-references the store.ts comment explaining the legacy persistence key; AGENTS.md 'What this is' section did not name the product so left as-is. (5) AC#4: confirmed via grep that web/src/App.tsx has no rendered app title/header (only generic panel labels like 'Subgraphs'/'Output'), so the browser tab title change (item 1) is the only user-visible branding text -- satisfied, no new header element added per AGENTS.md aesthetic guidance. (6) Decision: localStorage key 'graphql-playground' in web/src/store.ts left unchanged -- added a comment above 'name: "graphql-playground"' explaining it's a legacy internal key decoupled from the product's display name, kept stable to avoid wiping existing users' saved workspaces (Zustand persist migrations key off 'version', not the storage key name).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renamed the project's user-visible branding from 'GraphQL Playground' to 'GQL Fiddle' (browser tab title, README title, web/package.json name) and updated AGENTS.md's reference to the persistence key with a pointer to the rationale comment now in web/src/store.ts. Deliberately kept the Zustand localStorage key 'graphql-playground' unchanged (documented in a code comment) to avoid wiping existing users' saved workspaces. Verified pnpm install, pnpm build, pnpm tsc --noEmit, pnpm lint, and pnpm test run all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
