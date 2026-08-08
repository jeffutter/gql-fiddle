---
id: TASK-130
title: 'Remove Tours feature (authoring, playback, sync, click-to-anchor)'
status: Done
assignee: []
created_date: '2026-08-08 05:35'
updated_date: '2026-08-08 05:35'
labels:
  - chore
  - cleanup
  - frontend
  - rust
dependencies: []
priority: medium
type: chore
ordinal: 168000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove the Tours feature (slide-deck-style guided walkthroughs of a workspace, authored in-app and shared via `#t=` URLs) in its entirety: authoring UI, playback UI, the highlight system, the `tourDraft` field and its store actions, `#t=` URL encode/decode, export/import support, the WASM `node_at_position` export that existed solely to support tour authoring's click-to-anchor interaction, and all associated tests and documentation.

Originally built across TASK-64 through TASK-84 (and touched by several later refactors, e.g. TASK-96.3, TASK-87.5). Requested removal — full feature retirement, not a partial deprecation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No source, test, or documentation file references Tours, tourDraft, TourStep, encodeTour/decodeTour, resolveTourStep, or the node_at_position WASM export
- [x] #2 The Share header menu and mobile/desktop layouts no longer have any Tour-related UI branch — remaining UI (Share/Collaborate, Saved Workspaces) is unaffected and reads as a coherent, non-fragmented set of options
- [x] #3 Full verification suite passes: web tsc/lint/prettier/vitest, and cargo test/clippy/fmt for gql-core
- [x] #4 The WASM package rebuilds cleanly with node_at_position absent from the generated bindings
- [x] #5 All changes land in a single commit
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Frontend: deleted TourAuthoringPanel.tsx, TourPlayback.tsx (+.test.tsx), tourHighlight.ts (+.test.ts), useTourAuthoringDecorations.ts wholesale. Removed Tour/TourStep/PaneId/PaneVisibility types, encodeTour/decodeTour, resolveTourStep, and the tourDraft field (share.ts); all tour store state/actions and computeOverrides — which existed solely to support tour step snapshotting — (store.ts); all App.tsx integration points (imports, state, the #t= URL-hash branch, the Share-menu Tour branch simplified back to a plain two-way Share/Collaborate toggle, mobile "tour" tab, desktop authoring side-panel); ExportImportDialog.tsx/share.ts export-format's tourDraft field; sync.ts's stale tourDraft comments. Removed the associated CSS block and @keyframes tour-pulse from theme.css.

Backend/Rust: deleted node_at_pos.rs (its only caller was tour click-to-anchor); removed its wasm_bindgen export and doc references from lib.rs; removed its smoke tests from tests/wasm.rs; removed the nodeAtPosition wrapper from web/src/core/index.ts and its type from core/types.ts.

Docs: AGENTS.md (file tree, exports table, Data flow, State management, URL sharing, UI layout, and the entire "Tour system" section) and README.md (feature bullets, layout description) updated to remove all Tour mentions.

Verified: web tsc/lint/prettier all clean; vitest 379/379 passing (down from 492 — two whole test files removed plus scattered tour-only tests); cargo test/clippy/fmt all clean for gql-core; wasm-pack build regenerates bindings with node_at_position absent; production pnpm build succeeds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed the entire Tours feature: guided in-app authoring, full-screen playback, the Monaco highlight system, tourDraft workspace state, #t= URL sharing, export/import support, and the WASM click-to-anchor export it depended on. Simplified the Share header menu back to a plain Share/Collaborate toggle. All docs (AGENTS.md, README.md) updated to match. Full verification suite (tsc, eslint, prettier, vitest, cargo test/clippy/fmt, wasm-pack build, production build) passes clean.
<!-- SECTION:FINAL_SUMMARY:END -->
