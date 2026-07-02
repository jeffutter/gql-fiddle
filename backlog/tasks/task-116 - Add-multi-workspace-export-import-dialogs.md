---
id: TASK-116
title: Add multi-workspace export/import dialogs
status: To Do
assignee: []
created_date: '2026-07-01 17:05'
labels:
  - feature
  - frontend
  - ui
dependencies: []
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

The app supports multiple workspaces per user, stored in Zustand's `persist` middleware (localStorage key `"graphql-playground"`, v5). Each `WorkspaceEntry` has an `id`, `version`, `name`, `subgraphs`, `queryTabs`, `activeQueryTab`, `seed`, `mockConfig`, and `tourDraft`. Currently, "Share" only encodes a *single* workspace into a URL hash fragment (`#w=`). There is no way to export or import *multiple* workspaces at once.

## What to build

Two new dialogs (Export / Import) in the global header that download/upload a single JSON file containing the user's selected workspaces. On export, the user picks which workspaces to include. On import, the user selects which workspaces from the file to add to their current set.

### Export flow

1. User clicks **Export** button in the global header (next to the existing Share/Create Tour buttons).
2. A dialog opens listing all current workspaces with checkboxes and their names. All are checked by default.
3. User selects which workspaces to include, then clicks **Download**.
4. A `.json` file is generated and downloaded. The format:
   ```json
   {
     "exportVersion": 1,
     "exportedAt": "2026-07-01T12:00:00.000Z",
     "workspaces": [
       {
         "name": "Workspace 1",
         "subgraphs": [{ "name": "users", "sdl": "..." }, { "name": "products", "sdl": "..." }],
         "activeSubgraph": 0,
         "queryTabs": [{ "name": "Query 1", "query": "..." }],
         "activeQueryTab": 0,
         "seed": 42,
         "mockConfig": "",
         "tourDraft": null
       }
     ]
   }
   ```
   - `id` and `version` are **not** included — imported workspaces get fresh IDs and start at version 1.
   - `tourDraft` is included if non-null (tours are URL-shareable, not cloud-synced).
   - The file is gzip-compressed (using `pako.gzip`) and base64url-encoded, then offered as a `.json.gz` download. This keeps the file small and avoids bloating the download for large schemas. On import, we auto-detect the format: if it starts with the magic bytes for gzip, decompress; otherwise parse as plain JSON (backward compat with a future plain-text format).
5. File name: `gql-fiddle-export-YYYY-MM-DD.json.gz` (or `.json` if uncompressed).

### Import flow

1. User clicks **Import** button in the global header.
2. A file picker dialog opens (accepts `.json.gz` and `.json`).
3. After the user selects a file, we parse and validate it:
   - If `exportVersion` is missing or not `1`, show an error.
   - If `workspaces` is missing or not an array, show an error.
   - If a workspace entry is missing required fields, skip it with a warning.
4. A second dialog shows the parsed workspaces with checkboxes — user picks which ones to import. All are checked by default.
5. On confirm, each selected workspace is deep-cloned into the current store with a **new UUID** (so it doesn't clash with existing workspaces), named `"<original-name> (imported)"` if a workspace with that name already exists, and the user switches to the first imported workspace.
6. If any workspace has a `tourDraft`, it is imported as-is.

### UI placement

In the global header's `page-header__actions` div, add two buttons **before** the existing "Share" / "Create Tour" buttons:

```
[Export] [Import] [Share] [Create Tour] ...
```

Styled as regular `.btn` (not `btn--primary`) — they're secondary actions.

### Icons

- **Export**: download arrow (downward chevron)
- **Import**: upload arrow (upward chevron)

Use inline SVGs, same style as the clone/add buttons.

### Dialog structure

Both dialogs follow the existing `fullscreen-modal-backdrop` + `fullscreen-modal` pattern (see `ExportImageDialog.tsx` and `AboutModal.tsx`). They are controlled components rendered at the bottom of `App.tsx` alongside `AboutModal` and `ExportImageDialog`.

- Export dialog: wider (`width: min(96vw, 480px)`), scrollable body if many workspaces.
- Import dialog: same width, file picker area + workspace list with checkboxes.

### Styling

Add CSS classes to `theme.css`:
- `.import-export-dialog` — base dialog class (shared width)
- `.import-export-dialog__body` — padding
- `.import-export-dialog__list` — workspace list container
- `.import-export-dialog__item` — each workspace row (flex, name + checkbox)
- `.import-export-dialog__item input[type="checkbox"]` — styled checkbox
- `.import-export-dialog__actions` — button row at bottom

Use existing design tokens exclusively — no hardcoded colors.

### Edge cases

- **No workspaces selected for export**: disable the Download button (or show a toast).
- **Import with no workspaces selected**: close the dialog without action.
- **Name collision on import**: append `(imported)`, `(imported 2)`, etc.
- **Large file**: pako handles compression; if the file is > 10 MB, show a warning before parsing.
- **Invalid JSON / corrupt gzip**: show a friendly error in the dialog body.
- **tourDraft**: import the tourDraft as-is. It will appear in the workspace's `tourDraft` field and the Tour Authoring Panel will pick it up.
- **Offline / anonymous**: export/import works exactly the same — it's purely local file I/O, no network calls.

### Files to create/modify

| File | Action |
|------|--------|
| `web/src/ExportImportDialog.tsx` | **Create** — both Export and Import dialogs in one component |
| `web/src/share.ts` | **Modify** — add `encodeExport` / `decodeExport` functions, `ExportFormat` type |
| `web/src/store.ts` | **No changes needed** — import uses existing store actions (`addWorkspace`, `setActiveWorkspace`) |
| `web/src/App.tsx` | **Modify** — add state, handlers, buttons, and dialog rendering |
| `web/src/theme.css` | **Modify** — add dialog CSS classes |

### Testing

- Unit tests for `encodeExport` / `decodeExport` round-trip in `web/src/share.test.ts` (or new `share-export.test.ts`).
- Manual e2e test: export → import → verify workspaces restored.
- Test with 0, 1, 10+ workspaces.
- Test corrupt file handling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Export button in global header opens dialog listing all workspaces with checkboxes (all checked by default)
- [ ] #2 Download button generates a .json.gz file containing selected workspaces (no id/version fields, gzip-compressed, base64url-encoded)
- [ ] #3 Import button opens file picker, parses file, shows dialog listing workspaces with checkboxes (all checked by default)
- [ ] #4 Importing adds selected workspaces with new UUIDs, renames on collision with '(imported)' suffix, switches to first imported workspace
- [ ] #5 Export/Import dialogs use fullscreen-modal-backdrop pattern with Escape-to-close
- [ ] #6 Export/Import dialogs styled with theme.css classes, no hardcoded colors
- [ ] #7 Invalid/corrupt files show a friendly error message in the dialog
- [ ] #8 tourDraft is preserved through export/import round-trip
- [ ] #9 Export works in anonymous/offline mode
- [ ] #10 File naming: gql-fiddle-export-YYYY-MM-DD.json.gz
<!-- AC:END -->
