---
id: TASK-86
title: 'feat(ui): add "API SDL" tab next to "Supergraph SDL" in the output panel'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-25 21:06'
updated_date: '2026-06-25 21:17'
labels:
  - ui
  - feature
  - planned
dependencies: []
modified_files:
  - web/src/App.tsx
priority: medium
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

The output panel has a "Supergraph SDL" tab (`outputTab === "sdl"`) that shows the full composed supergraph SDL. The compose result already includes `api_schema_sdl` — the client-facing schema with federation internals stripped — but it is never surfaced to the user. It is currently only used internally for Monaco autocomplete and query validation.

Adding an "API SDL" tab would let users quickly see exactly what clients will see, without needing to copy the supergraph SDL and mentally filter out `@key`, `@external`, `_Entity`, etc.

## Location

`web/src/App.tsx` — two tab bars exist (desktop and mobile layouts, around lines 1627 and 1821). Both need to be updated.

Key state: `const [outputTab, setOutputTab] = useState<"type-graph" | "entities" | "sdl">(...)`

The `sdlContent` block (around line 1208) renders `compose.supergraph_sdl` inside a `<pre className="code-block">`.

`compose.api_schema_sdl` is already available wherever `compose` is in scope.

## Work

1. Extend the `outputTab` union type to include `"api-sdl"`.
2. Build an `apiSdlContent` block analogous to `sdlContent` that renders `compose.api_schema_sdl` (or an appropriate empty/error state when compose hasn't succeeded).
3. Add an "API SDL" tab button immediately after the "Supergraph SDL" button in **both** tab bars.
4. Wire `{outputTab === "api-sdl" && apiSdlContent}` in both render sections.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An 'API SDL' tab appears next to 'Supergraph SDL' in the output panel tab bar.
- [x] #2 Clicking 'API SDL' displays the api_schema_sdl from the compose result, formatted the same way as the Supergraph SDL tab.
- [x] #3 When compose has not succeeded (no result or error), the tab content shows an appropriate empty/error state rather than crashing.
- [x] #4 Both the desktop and mobile tab bar layouts include the new tab.
- [x] #5 The outputTab state type is updated to include 'api-sdl' and TypeScript compiles without errors.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

All work is in `web/src/App.tsx`. The four changes are tightly coupled and must ship in one commit — adding the type without the render block breaks TypeScript, and adding the render block without the tab button leaves unreachable state.

`compose.api_schema_sdl` is already available in scope wherever `compose` is used; it is typed in `web/src/core/types.ts` (line 58) and used for Monaco autocomplete and query validation. No data-fetching or type changes are needed outside `App.tsx`.

## Change 1 — Extend the `outputTab` union type (line 235)

```ts
// Before
const [outputTab, setOutputTab] = useState<"type-graph" | "entities" | "sdl">("type-graph");

// After
const [outputTab, setOutputTab] = useState<"type-graph" | "entities" | "sdl" | "api-sdl">("type-graph");
```

## Change 2 — Add `apiSdlContent` block (after line 1222, immediately after `sdlContent`)

Mirror `sdlContent` exactly but render `compose.api_schema_sdl` and omit the hints paragraph (the API schema has no hints, only the supergraph composition result does):

```tsx
const apiSdlContent = (
  <div className="scroll">
    {compose === null ? (
      <pre className="code-block">Loading core…</pre>
    ) : compose.ok ? (
      <pre className="code-block">{compose.api_schema_sdl}</pre>
    ) : null}
  </div>
);
```

The `compose.ok` guard matches the pattern used throughout the file; when composition has failed, `compositionErrorContent` is rendered by the tab container instead, so rendering `null` here is safe.

## Change 3 — Add tab button in the mobile tab bar (around line 1646)

After the "Supergraph SDL" `<button>` (line 1640-1646), insert:

```tsx
<button
  onClick={() => setOutputTab("api-sdl")}
  aria-pressed={outputTab === "api-sdl"}
  className={outputTab === "api-sdl" ? "tab is-active" : "tab"}
>
  API SDL
</button>
```

Then add the render conditional after line 1652:

```tsx
{outputTab === "api-sdl" && apiSdlContent}
```

## Change 4 — Add tab button in the desktop tab bar (around line 1837)

After the "Supergraph SDL" `<button>` (line 1834-1840), insert the same button snippet. Then add the render conditional after line 1872:

```tsx
{outputTab === "api-sdl" && apiSdlContent}
```

The full-screen button guard at line 1841 checks `outputTab === "type-graph" || outputTab === "entities"` and does not need to change — SDL tabs have no fullscreen mode.

## Verification

1. `cd web && npx tsc --noEmit` — no TypeScript errors.
2. In the running app, compose a valid multi-subgraph setup and confirm:
   - "API SDL" tab appears after "Supergraph SDL" in both mobile and desktop layouts.
   - Tab content shows the client-facing schema (`api_schema_sdl`) without federation directives.
   - When no composition result exists (initial load), tab shows "Loading core…".
   - When composition fails, `compositionErrorContent` is shown instead of the tab content (existing behavior is preserved).
3. Run `npm test` in `web/` — no regressions in `App.test.tsx`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented all four changes in web/src/App.tsx:
1. Extended outputTab union type to include 'api-sdl' (line 235)
2. Added apiSdlContent block after sdlContent, rendering compose.api_schema_sdl with the same pattern (Loading/ok/null guards)
3. Added 'API SDL' tab button after 'Supergraph SDL' in the mobile tab bar and wired {outputTab === 'api-sdl' && apiSdlContent}
4. Added 'API SDL' tab button after 'Supergraph SDL' in the desktop tab bar and wired {outputTab === 'api-sdl' && apiSdlContent}
TypeScript: no errors. All 334 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an "API SDL" tab to the output panel in both desktop and mobile layouts. The tab renders `compose.api_schema_sdl` (the client-facing schema without federation internals) using the same pattern as the existing Supergraph SDL tab. The `outputTab` union type was extended to include `"api-sdl"`, and appropriate empty/loading states are handled. TypeScript compiles cleanly and all 334 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
