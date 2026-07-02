---
id: TASK-116
title: Add multi-workspace export/import dialogs
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 17:05'
updated_date: '2026-07-02 15:55'
labels:
  - feature
  - frontend
  - ui
  - planned
dependencies: []
ordinal: 151000
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
- [x] #1 Export button in global header opens dialog listing all workspaces with checkboxes (all checked by default)
- [x] #2 Download button generates a .json.gz file containing selected workspaces (no id/version fields, gzip-compressed, base64url-encoded)
- [x] #3 Import button opens file picker, parses file, shows dialog listing workspaces with checkboxes (all checked by default)
- [x] #4 Importing adds selected workspaces with new UUIDs, renames on collision with '(imported)' suffix, switches to first imported workspace
- [x] #5 Export/Import dialogs use fullscreen-modal-backdrop pattern with Escape-to-close
- [x] #6 Export/Import dialogs styled with theme.css classes, no hardcoded colors
- [x] #7 Invalid/corrupt files show a friendly error message in the dialog
- [x] #8 tourDraft is preserved through export/import round-trip
- [x] #9 Export works in anonymous/offline mode
- [x] #10 File naming: gql-fiddle-export-YYYY-MM-DD.json.gz
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

Single cohesive feature (Export + Import dialogs share files, UX flow, and are
described together in the ticket) — no sub-tickets. Implement directly.

### 1. `web/src/share.ts` — add export/import codec (no changes to existing
   `encode`/`decode`/`encodeTour`/`decodeTour`)

Add types and two pure functions, next to the existing hash codec:

```ts
export interface ExportedWorkspace {
  name: string;
  subgraphs: { name: string; sdl: string }[];
  activeSubgraph: number;
  queryTabs: { name: string; query: string }[];
  activeQueryTab: number;
  seed: number;
  mockConfig: string;
  tourDraft: Tour | null;
}

export interface ExportFormat {
  exportVersion: 1;
  exportedAt: string; // ISO 8601
  workspaces: ExportedWorkspace[];
}

export interface DecodedExport {
  format: ExportFormat;
  /** Count of raw entries in the file's `workspaces` array that were dropped
   *  because they were missing required fields. Callers surface this as a
   *  warning; decodeExport itself never throws for a single bad entry. */
  skippedCount: number;
}

export function encodeExport(workspaces: WorkspaceEntry[]): Uint8Array;
export function decodeExport(bytes: Uint8Array): DecodedExport;
```

- `encodeExport`: strip `id`/`version`, map each `WorkspaceEntry` to
  `ExportedWorkspace` (include `tourDraft` as-is — null when absent), build
  `ExportFormat` with `exportVersion: 1` and `exportedAt: new
  Date().toISOString()`, `JSON.stringify`, then `pako.gzip(...)` and return
  the **raw gzip `Uint8Array`** (see deviation note below — do NOT
  base64url-encode for the file case).

- `decodeExport(bytes)`:
  - Detect format by magic bytes: `bytes[0] === 0x1f && bytes[1] === 0x8b`
    means gzip → `pako.inflate(bytes, { to: "string" })`; otherwise decode
    `bytes` as UTF-8 text via `TextDecoder` and treat as plain JSON (this is
    the "future plain-text format" backward-compat path called out in the
    ticket).
  - `JSON.parse` the resulting string; wrap in try/catch → throw
    `Error("Invalid export file: not valid JSON")` (also catches corrupt
    gzip, since `pako.inflate` throws before JSON.parse is reached — that
    exception should be caught and re-thrown with the same friendly message
    for consistency).
  - Validate `exportVersion === 1` → else throw `Error("Unsupported export
    file version")`.
  - Validate `Array.isArray(parsed.workspaces)` → else throw `Error("Invalid
    export file: missing workspaces")`.
  - For each raw entry, require `typeof name === "string"`,
    `Array.isArray(subgraphs)`, `Array.isArray(queryTabs)`; entries failing
    this are dropped (increment `skippedCount`), not thrown. Coerce optional
    fields with the same defaulting pattern `decode()` already uses:
    `activeSubgraph`/`activeQueryTab` default to `0` if not a number, `seed`
    defaults to `42`, `mockConfig` defaults to `""`, `tourDraft` defaults to
    `null`.
  - Return `{ format: { exportVersion: 1, exportedAt, workspaces }, skippedCount }`.

**Deviation from the ticket text (document this in the PR/commit):** the
ticket says the file is "gzip-compressed... and base64url-encoded" but also
says import "auto-detects... if it starts with the magic bytes for gzip".
Those two statements are inconsistent — base64url text never starts with the
raw `0x1f 0x8b` gzip magic bytes, so magic-byte sniffing only works if the
file holds *raw* gzip binary. Base64 was necessary for the `#w=` URL hash
codec (URLs can't carry binary), but a downloaded file can hold arbitrary
bytes directly via `Blob`, so base64 adds size and complexity for no benefit
here. Resolution: write raw gzip bytes to the `.json.gz` file (no base64
layer for the file format); keep the existing `encode`/`decode` URL-hash
functions unchanged (they still base64url for the URL case). This keeps the
"magic bytes" auto-detection in the ticket meaningful and the format
genuinely valid gzip (openable with `gunzip` for debugging).

### 2. `web/src/store.ts` — export `generateUUID`

Change `function generateUUID()` to `export function generateUUID()` so the
import dialog can mint new workspace IDs using the same
insecure-context-safe fallback as `makeDefaultWorkspace`/`cloneWorkspace`,
instead of duplicating that policy. No other store changes — import writes
directly via `useWorkspace.setState`, mirroring the existing pattern at
`App.tsx` around the `#w=` hash-restore effect (lines ~355-400).

### 3. `web/src/ExportImportDialog.tsx` — new file

Two exported components, `ExportDialog` and `ImportDialog`, both following
the `fullscreen-modal-backdrop` + `fullscreen-modal` + Escape-to-close
pattern from `AboutModal.tsx`/`ExportImageDialog.tsx`.

```ts
interface ExportDialogProps {
  workspaces: WorkspaceEntry[];
  onClose: () => void;
}
export function ExportDialog({ workspaces, onClose }: ExportDialogProps)

interface ImportDialogProps {
  onClose: () => void;
}
export function ImportDialog({ onClose }: ImportDialogProps)
```

**ExportDialog:**
- Local state: `Set<number>` (or `boolean[]`) of selected indices, all
  selected by default.
- Body: scrollable list (`import-export-dialog__list`), one
  `import-export-dialog__item` per workspace — checkbox + name.
- Footer: "Download" button, `disabled` when selection is empty (AC#1 says
  "disable the Download button" per the ticket's edge-case list).
- On Download: `encodeExport(selectedWorkspaces)` → wrap bytes in
  `new Blob([bytes], { type: "application/gzip" })` →
  `downloadBlob(blob, filename)` (reuse `imageExport.ts`'s `downloadBlob`,
  it's already generic over any Blob/filename) → `onClose()`.
- Filename: `` `gql-fiddle-export-${todayISODate()}.json.gz` `` — add a tiny
  local `todayISODate()` helper (`new Date().toISOString().slice(0, 10)`); no
  existing date-format utility to reuse.

**ImportDialog:** internal state machine via one `useState<"pick" | "select"
| "error">("pick")`, plus `parsed: DecodedExport | null` and `error: string |
null` and `selected: Set<number>`.

- `"pick"` step: `<input type="file" accept=".json,.json.gz,application/gzip,application/json" />`.
  On change, read `file.arrayBuffer()`:
  - If `file.size > 10 * 1024 * 1024` (10 MB), show the "large file" warning
    inline before parsing (ticket edge case) — still allow proceeding, this
    is advisory only (the ticket doesn't say block, just "show a warning").
  - Call `decodeExport(new Uint8Array(buf))` in try/catch. On success, seed
    `selected` with every index (all checked by default) and move to
    `"select"`. On throw, set `error` to `err.message` and move to
    `"error"`.
- `"select"` step: same checkbox-list UI pattern as ExportDialog, driven by
  `parsed.format.workspaces`. If `parsed.skippedCount > 0`, show a small
  warning line above the list ("N entries skipped: missing required
  fields"). Footer: "Import" button.
  - On Import with `selected.size === 0`: per ticket edge case, just
    `onClose()` — no toast, no error.
  - On Import with selections: build new `WorkspaceEntry[]` — for each
    selected `ExportedWorkspace`, `id: generateUUID()`, `version: 1`, name
    via a `uniqueName(existingNames, candidateName)` helper that appends
    ` (imported)`, then ` (imported 2)`, ` (imported 3)`, ... until unique
    (checked against `useWorkspace.getState().workspaces` names at import
    time, not the pre-import snapshot, in case of duplicates within the
    import batch itself). Read current workspaces via
    `useWorkspace.getState().workspaces` (not a prop) to avoid a stale
    closure, matching the `App.tsx` hash-restore effect's use of
    `useWorkspace.getState()` inside the handler rather than through props.
  - `useWorkspace.setState({ workspaces: [...current, ...newEntries],
    activeWorkspaceIndex: current.length, supergraphSdl: null,
    composeErrors: null, composeHints: 0 })` — switches to the *first*
    imported workspace (index = length of the old array, since new entries
    are appended in order), matching AC#4. Clearing the three session-only
    compose fields mirrors every other workspace-switching action in
    store.ts (`addWorkspace`, `cloneWorkspace`, the hash-restore effect).
  - `onClose()`.
- `"error"` step: show `error` message in the dialog body with a "Try
  again" button that resets to `"pick"`.

Both dialogs: `Escape` closes (same `useEffect` + `keydown` pattern as
`AboutModal`), backdrop click closes, inner click `stopPropagation`s.

### 4. `web/src/App.tsx`

- Import `{ ExportDialog, ImportDialog }` from `./ExportImportDialog`.
- New state (names chosen to avoid collision with the existing
  `exportDialogOpen`/`exportError`, which belong to the sequence-diagram
  image export):
  ```ts
  const [workspaceExportOpen, setWorkspaceExportOpen] = useState(false);
  const [workspaceImportOpen, setWorkspaceImportOpen] = useState(false);
  ```
- In `page-header__actions`, insert two buttons immediately after "Copy for
  LLM" and before the `tourDraft !== null ? ... : (Share/Create Tour)`
  conditional block (~line 1224), styled as plain `.btn` (not
  `btn--primary`):
  ```tsx
  <button
    onClick={() => setWorkspaceExportOpen(true)}
    className="btn"
    title="Export workspaces"
  >
    <svg ...download-chevron... aria-hidden="true" />
    Export
  </button>
  <button
    onClick={() => setWorkspaceImportOpen(true)}
    className="btn"
    title="Import workspaces"
  >
    <svg ...upload-chevron... aria-hidden="true" />
    Import
  </button>
  ```
  Use simple inline chevron-arrow SVGs (viewBox ~14x14, `stroke="currentColor"`)
  consistent with the existing icon-button style (see the clone-workspace
  button at `App.tsx` ~line 1137).
- At the bottom alongside `{aboutOpen && <AboutModal .../>}` /
  `{exportDialogOpen && <ExportImageDialog .../>}` (~line 1895):
  ```tsx
  {workspaceExportOpen && (
    <ExportDialog workspaces={workspaces} onClose={() => setWorkspaceExportOpen(false)} />
  )}
  {workspaceImportOpen && (
    <ImportDialog onClose={() => setWorkspaceImportOpen(false)} />
  )}
  ```
  `workspaces` is already destructured from `useWorkspace` at the top of
  `App`.

### 5. `web/src/theme.css`

Add near the `.about-modal`/`.export-image-dialog` block (~line 1700):

```css
.import-export-dialog {
  width: min(96vw, 480px);
  height: auto;
  max-height: min(92vh, 640px);
}
.import-export-dialog__body {
  padding: 20px 24px;
  overflow-y: auto;
}
.import-export-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px 0;
}
.import-export-dialog__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  font-size: 13px;
  color: var(--text-2);
}
.import-export-dialog__item input[type="checkbox"] {
  accent-color: var(--accent);
}
.import-export-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}
```
All values reference existing design tokens (`--accent`, `--text-2`, etc.) —
no hardcoded colors, matching AC#6.

### 6. Tests

- `web/src/share-export.test.ts` (new, mirrors `share.test.ts` style):
  - round-trip `decodeExport(encodeExport(workspaces)).format` equals the
    expected `ExportFormat` shape (id/version stripped, tourDraft preserved
    when non-null and when null).
  - `encodeExport` output starts with gzip magic bytes `0x1f, 0x8b`.
  - `decodeExport` accepts plain (non-gzip) UTF-8 JSON bytes too (backward
    compat path).
  - throws a friendly error on corrupt gzip and on invalid JSON.
  - throws on `exportVersion` missing/not `1`.
  - throws on missing/non-array `workspaces`.
  - drops malformed individual entries and reports `skippedCount` without
    throwing.
- `web/src/App.test.tsx` or a new `ExportImportDialog.test.tsx` (follow
  whichever pattern existing dialog tests use — check for an
  `AboutModal.test.tsx`/similar first; if none exists, colocate a focused
  RTL test file for the new component):
  - Export dialog: all workspaces checked by default; unchecking all
    disables Download; clicking Download triggers a blob download (spy on
    `URL.createObjectURL`, following `imageExport.test.ts`'s existing spy
    pattern).
  - Import dialog: file picker → valid file → shows workspace list, all
    checked by default → Import adds workspaces with new UUIDs, switches to
    first imported workspace, renames on name collision.
  - Import with corrupt file shows the friendly error step.
  - Import with zero selected workspaces just closes (no state change).
  - `tourDraft` round-trips through export → import.

### 7. Manual verification

`pnpm --dir web tsc --noEmit`, `pnpm --dir web lint`, `pnpm --dir web test
run`. Manually run `pnpm --dir web dev`, exercise: export with 0/1/10+
workspaces selected, download the `.json.gz`, verify it's real gzip
(`gunzip -t`), re-import it into a fresh workspace set, confirm names,
tourDraft, and switch-to-first-imported behavior.

### Files touched
- `web/src/share.ts` (modify — add `encodeExport`/`decodeExport`/types)
- `web/src/store.ts` (modify — export `generateUUID`)
- `web/src/ExportImportDialog.tsx` (create)
- `web/src/App.tsx` (modify — state, buttons, dialog rendering)
- `web/src/theme.css` (modify — `.import-export-dialog*` classes)
- `web/src/share-export.test.ts` (create)
- new dialog-behavior test file (create, exact name TBD by executor based on
  existing dialog-test conventions)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per the plan already on the ticket, with one intentional deviation
called out below.

- web/src/share.ts: added ExportedWorkspace/ExportFormat/DecodedExport types
  and encodeExport/decodeExport. encodeExport strips id/version, serializes
  to JSON, and gzips (raw bytes — see deviation note). decodeExport
  auto-detects gzip via magic bytes (0x1f 0x8b) vs. plain UTF-8 JSON,
  validates exportVersion===1 and a workspaces array, and drops individual
  malformed entries (reporting skippedCount) rather than throwing for the
  whole file.
- web/src/store.ts: exported generateUUID (previously module-private) so the
  import dialog can mint fresh workspace IDs via the same
  insecure-context-safe fallback used elsewhere.
- web/src/ExportImportDialog.tsx (new): ExportDialog and ImportDialog
  components, following the fullscreen-modal-backdrop + Escape-to-close
  pattern from AboutModal/ExportImageDialog. ExportDialog lists workspaces
  with checkboxes (all checked by default), disables Download when nothing
  is selected, and downloads a gql-fiddle-export-YYYY-MM-DD.json.gz blob.
  ImportDialog is a 3-step state machine (pick -> select -> error): file
  picker -> decodeExport -> checkbox list (all checked by default, shows a
  skipped-entries warning and a >10MB size warning) -> Import writes new
  WorkspaceEntry objects with fresh UUIDs into the store via
  useWorkspace.setState, renaming on name collision with
  "(imported)"/"(imported N)" suffixes, and switches to the first imported
  workspace. Importing with zero selections just closes.
- web/src/App.tsx: added Export/Import buttons (plain .btn, inline chevron
  SVGs) to page-header__actions before the Share/Create Tour block, plus
  state and dialog rendering at the bottom alongside AboutModal/
  ExportImageDialog.
- web/src/theme.css: added .import-export-dialog* classes, all referencing
  existing design tokens (--accent, --text-2, --warning) — no hardcoded
  colors.
- Tests: web/src/share-export.test.ts (round-trip, gzip magic bytes,
  plain-JSON backward compat, corrupt gzip/invalid JSON/bad version/missing
  workspaces error messages, malformed-entry skipping) and
  web/src/ExportImportDialog.test.tsx (RTL tests for both dialogs: default
  checkbox state, Download disabled when empty, actual blob download +
  filename, Escape-to-close, file-picker -> parse -> select flow, import
  with new UUIDs + active-workspace switch, name-collision renaming,
  corrupt-file error step, zero-selection no-op close, tourDraft round-trip).
- Deviation from the ticket's literal wording (documented inline in
  share.ts): the ticket says the file is "gzip-compressed... and
  base64url-encoded" but also says import "auto-detects... if it starts with
  the magic bytes for gzip" — those are inconsistent, since base64 text
  never starts with the raw 0x1f 0x8b gzip magic. Resolved by writing raw
  gzip bytes to the .json.gz file (Blob can hold arbitrary bytes, unlike a
  URL), keeping magic-byte sniffing meaningful and the file openable with
  `gunzip` for debugging. The existing #w=/#t= URL-hash codecs are
  unchanged and still base64url-encode (required there, since URLs can't
  carry binary).

Verification: `pnpm --dir web tsc --noEmit` (clean), `pnpm --dir web test
run` (429/429 passing, including 21 new tests), `pnpm --dir web build`
(succeeds), and targeted eslint runs on all touched/created files (0
errors/warnings introduced — the two pre-existing react-hooks/exhaustive-deps
warnings in App.tsx predate this change).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Export/Import dialogs to the global header enabling users to
export a chosen subset of workspaces to a gzip-compressed
.json.gz file and re-import them (with fresh UUIDs and
collision-safe renaming) into any browser, entirely client-side with
no network dependency.
<!-- SECTION:FINAL_SUMMARY:END -->
