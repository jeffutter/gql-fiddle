---
id: TASK-53
title: Rename project to "gql-fiddle"
status: To Do
assignee: []
created_date: '2026-06-15 15:30'
updated_date: '2026-06-15 15:30'
labels:
  - rebranding
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
- [ ] #1 index.html page title reflects "gql-fiddle" / "GQL Fiddle" branding
- [ ] #2 web/package.json "name" field updated to reflect the new project name
- [ ] #3 README.md and AGENTS.md references to the old project name updated where they describe the product's name/identity
- [ ] #4 Any in-app branding text (e.g. header/title shown in the UI) reflects the new name
- [ ] #5 Decision on the localStorage persistence key ("graphql-playground") is made and documented — either left as-is with a comment explaining why, or migrated with a version bump / migration step that preserves existing users' saved workspaces
- [ ] #6 pnpm build, pnpm tsc --noEmit, pnpm lint, and pnpm test run all pass after the rename
<!-- AC:END -->
