---
id: TASK-11
title: Keep the last good supergraph when composition fails
status: Done
assignee:
  - developer
created_date: '2026-06-06 20:20'
updated_date: '2026-06-09 08:26'
labels: []
milestone: m-1
dependencies:
  - TASK-10
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When composition fails mid-edit, do not blank or disable everything. Keep showing the last successful supergraph marked as stale so the user is never locked out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After a previous success, a failing compose keeps the last good supergraph visible, grayed, with a stale badge, plus the error banner
- [x] #2 The next successful compose removes the stale badge/gray styling and updates the SDL
- [x] #3 With no prior success, a failing compose shows only the error banner (no crash)
- [x] #4 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. In `web/src/store.ts` verify that `setComposeResult` (line 72) preserves `supergraphSdl` on failure via `supergraphSdl: sdl ?? state.supergraphSdl`. No new store field is needed — the single `supergraphSdl` already serves double duty as both "current" and "last good": it updates with fresh SDL on success, keeps the old value on failure. If this line has been changed, restore it before proceeding.

2. In `web/src/App.tsx`, locate the Supergraph pane's failure branch (the `:else` block starting around line 198). Replace the existing `<pre>{supergraphSdl ?? "No valid composition yet"}</pre>` with two conditional branches:
   a) When `supergraphSdl !== null` (a prior success exists): render a small yellow/amber "stale" badge above the SDL, and show the SDL grayed out. Replace that `<pre>` element with exactly:
      {supergraphSdl !== null ? (
        <>
          <span style={{ backgroundColor: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, border: "1px solid #fcd34d", marginBottom: 4 }}>stale</span>
          <pre style={{ whiteSpace: "pre-wrap", opacity: 0.5, color: "#6b7280" }}>{supergraphSdl}</pre>
        </>
      ) : (
        <pre style={{ whiteSpace: "pre-wrap" }}>No valid composition yet</pre>
      )}
   b) When `supergraphSdl === null` (no prior success ever): render only `<pre>No valid composition yet</pre>`. The error banner above already renders for both cases and needs no change.

3. On the next successful compose, `setComposeResult` updates `supergraphSdl` with fresh SDL and sets `compose.ok = true`. The success branch (line 180) re-renders at normal opacity with no stale badge — this is automatic from step 2 because the success path has its own rendering block. Confirm no additional code changes are needed here beyond what step 2 provides.

4. Add or update three tests in `web/src/App.test.tsx` using the existing fake-timer pattern (`vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(350)`):
   a) "stale badge and gray styling appear when composition fails after prior success": pre-populate store with `supergraphSdl: "# previous supergraph"`, mock a compose failure, assert text "stale" is in the document AND that a `<pre>` element has opacity in its style attribute (confirming grayed-out rendering). This extends AC#1 beyond the existing test which only checks SDL text presence.
   b) "successful compose removes stale badge and styling": pre-populate store with `supergraphSdl`, mock a compose success, advance timers, assert no element containing text "stale" exists. Covers AC#2.
   c) "no stale badge on first-ever failure": start with `supergraphSdl: null` (already the default in beforeEach), mock a compose failure, assert "No valid composition yet" is shown and no "stale" badge text appears. Extends AC#3 beyond the existing test which only checks placeholder text.

5. Run `cd web && pnpm tsc --noEmit` to verify type correctness, then `cd web && pnpm lint` to verify linting passes. Covers AC#4.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Composition failure now preserves the last good supergraph SDL via `sdl ?? state.supergraphSdl` in store.ts, displays it with a yellow "stale" badge and 50% opacity in App.tsx's failure branch, and shows only an error banner when no prior success exists. Three targeted tests confirm stale badge appearance on failure-after-success, badge removal on subsequent success, and correct placeholder on first-ever failure. All quality gates (cargo test, fmt, clippy, vitest 38 tests, tsc, lint) pass cleanly with zero issues.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research: Keep the last good supergraph when composition fails

## Summary
No new external libraries are needed. The Zustand store already preserves `supergraphSdl` across failures (TASK-10 AC#4). This task is purely a UI rendering change in `App.tsx`: conditionally gray out the stale SDL and attach a "stale" badge when composition fails but a prior good SDL exists, then clear that styling on the next success.

## Findings

### 1. No new store field required — `supergraphSdl` already does the job
The existing `supergraphSdl: string | null` in `WorkspaceState` is preserved on failure by design (see `store.test.ts` → "preserves supergraphSdl when compose fails"). The store's `setComposeResult` intentionally keeps the old SDL when errors arrive. **No new field (`lastGoodSupergraphSdl`) is needed** — the existing field serves as both "current" and "last good."

### 2. UI state machine for the Supergraph pane
Three mutually exclusive rendering branches (currently only two exist):

| Condition | What to show | Styling |
|---|---|---|
| `compose.ok === true` | SDL text + hints status line | Normal (current) |
| `compose.ok === false && supergraphSdl !== null` | SDL text + "stale" badge | Grayed out (`opacity: 0.5`, `color: #6b7280`) + small badge label |
| `compose.ok === false && supergraphSdl === null` | Error banner only; `<pre>` shows "No valid composition yet" | Normal (no change from current) |

The third branch already works as-is. Only the second branch needs new code.

### 3. Recommended visual pattern for the stale badge
Based on patterns in VS Code, Unleash, and TanStack Query's stale-while-revalidate UI:

```tsx
{compose.ok === false && supergraphSdl !== null ? (
  <>
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <span
        style={{
          backgroundColor: "#fef3c7",
          color: "#92400e",
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 6px",
          borderRadius: 4,
          border: "1px solid #fcd34d",
        }}
      >
        stale
      </span>
    </div>
    <pre
      style={{
        whiteSpace: "pre-wrap",
        opacity: 0.5,
        color: "#6b7280",
        pointerEvents: "none",
      }}
    >
      {supergraphSdl}
    </pre>
  </>
) : null}
```

Key design decisions:
- **Yellow/amber badge** (`#fef3c7` bg, `#92400e` text) — signals "warning / not current" without alarming like red does. The error banner already handles the red context.
- **`opacity: 0.5` on the `<pre>`** — immediately communicates "this is out of date." Combined with muted text color for accessibility.
- **`pointerEvents: "none"`** — prevents user from accidentally selecting/copying stale content as if it were current. (Optional: could still allow selection.)

### 4. Where to insert the logic in App.tsx
In the Supergraph pane's failure branch (currently at ~line 120), **before** the existing `<pre>` that shows `supergraphSdl ?? "No valid composition yet"`, add the stale rendering:

```tsx
// In the :else (failure) branch, BEFORE the existing <pre>:
{supergraphSdl !== null ? (
  <>
    <span style={staleBadgeStyle}>stale</span>
    <pre style={{ whiteSpace: "pre-wrap", opacity: 0.5, color: "#6b7280" }}>
      {supergraphSdl}
    </pre>
  </>
) : null}
```

The existing `<pre>{supergraphSdl ?? "No valid composition yet"}</pre>` below it is now redundant for the stale case. Remove or guard it: only render when `supergraphSdl === null`.

### 5. Store update to `setComposeResult` — one line change
Current implementation (line ~72 of store.ts):
```ts
setComposeResult: (sdl, errors, hintCount) =>
    set((state) => ({
      supergraphSdl: sdl ?? state.supergraphSdl,  // preserves on null → stale behavior
      composeErrors: errors,
      composeHints: hintCount,
    })),
```

This is already correct. On success (`sdl` is non-null), it updates. On failure (`sdl` is null), it keeps the previous value. **No change needed to the store.**

### 6. Test strategy (no new test file needed)
Add three tests alongside the existing "failing compose" tests in `App.test.tsx`:

1. **"stale badge appears when prior composition succeeded"** — pre-populate `supergraphSdl`, mock a failure, assert the "stale" badge text and gray styling are present.
2. **"next successful compose removes stale styling"** — after the above, mock a success, advance timers, assert normal (non-gray) rendering and no badge.
3. **"no stale badge on first-ever failure"** — never set `supergraphSdl`, mock a failure, assert only error banner + "No valid composition yet" text.

Use the existing `vi.advanceTimersByTimeAsync(350)` pattern already established in the file.

### 7. Gotchas
- **React keys on stale badge**: The badge is a sibling to the `<pre>`, not inside it, so no key collision risk with error items.
- **`useWorkspace` selector stability**: The existing destructured `supergraphSdl` from `useWorkspace()` in App.tsx will automatically reflect the preserved value — no `useShallow` or special selector needed since we're just reading one field.
- **Monaco editor interaction**: The stale SDL is displayed in a `<pre>`, not an editable Monaco instance, so there's no risk of the user editing stale content.
- **Composition hints on failure**: When composition fails, hints are already set to `0` by `setComposeResult(null, result.errors, 0)`. The stale rendering branch should NOT show the "Composition: 0 errors" status line — only the success branch does.

## Sources
- **Existing store.ts** (local) — confirms `supergraphSdl` preservation on failure is already implemented
- **store.test.ts** ("preserves supergraphSdl when compose fails") — unit test proving stale SDL survives failure
- **App.test.tsx** ("failing compose shows stale supergraph SDL from the store") — integration test confirming stale SDL appears in UI
- **VS Code Stale Decorations Issue #205198** — precedent for `opacity` + badge pattern in code editors
- **TanStack Query stale-while-revalidate docs** — standard React pattern: show cached data with non-blocking indicator during background refresh

## Gaps
- No external library research needed; the feature is purely Zustand state + React conditional rendering.
- If the project adopts a design system (Tailwind, MUI, etc.) in a future milestone, the inline styles should be migrated to CSS classes/token values. Currently there's no design system in play — all styling is inline.
- The stale badge text "stale" could be localized or translated later; consider extracting to a constant if i18n becomes relevant.

<!-- SECTION:NOTES:END -->
