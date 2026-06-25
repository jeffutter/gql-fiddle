---
id: TASK-85
title: Add vim keybindings toggle setting for Monaco editors
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-25 14:18'
updated_date: '2026-06-25 14:36'
labels:
  - settings
  - editor
  - dx
  - planned
dependencies: []
references:
  - 'https://github.com/brijeshb42/monaco-vim'
modified_files:
  - web/package.json
  - web/pnpm-lock.yaml
  - web/src/store.ts
  - web/src/App.tsx
  - web/src/theme.css
  - web/src/setupTests.tsx
priority: low
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Monaco supports vim emulation via the `monaco-vim` npm package. Add a toggle in the app settings (e.g., a Settings panel or toolbar) that enables/disables vim keybindings across all Monaco editor instances (query editor, variables editor, schema editor, etc.).

When enabled, each editor should initialize `monaco-vim` with a status bar element showing the current vim mode (normal/insert/visual). When disabled, editors should use the default Monaco keybindings. The preference should be persisted in localStorage so it survives page reloads.

`monaco-vim` is not yet installed — it will need to be added as a dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Enabling the toggle activates vim emulation on all Monaco editor instances on the page
- [x] #2 Disabling the toggle restores default Monaco keybindings on all editors
- [x] #3 A vim mode status bar (normal/insert/visual) is displayed when vim mode is active
- [x] #4 The vim keybindings preference is persisted in localStorage and restored on page load
- [x] #5 Toggling the setting does not require a page reload
- [x] #6 The `monaco-vim` package is added to web/package.json dependencies
- [x] #7 The vim keybindings toggle is placed in the page footer (alongside the Run button and Seed input), visible at all times across all layouts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Add a vim keybindings toggle to gql-fiddle. When enabled, every Monaco editor instance on the page uses `monaco-vim` for vim emulation and shows a status bar element displaying the current vim mode (normal/insert/visual). The preference is persisted in `localStorage` via the Zustand store so it survives page reloads. The toggle lives in the page `<footer>` alongside the Run button and Seed input.

---

## Step 1 — Install `monaco-vim`

In `web/`:
```bash
pnpm add monaco-vim
```

`monaco-vim` ships its own TypeScript declarations; no `@types/` package is needed. Confirm the package appears in `web/package.json` dependencies after the install.

---

## Step 2 — Add `vimMode` to the Zustand store (`web/src/store.ts`)

### 2a. Extend the state interface

Add to `WorkspaceState`:
```ts
/** Whether vim keybindings are enabled on all Monaco editors. */
vimMode: boolean;
setVimMode: (enabled: boolean) => void;
```

### 2b. Set a default and wire the setter

Inside `create()(persist(...))`:
```ts
vimMode: false,
setVimMode: (enabled) => set({ vimMode: enabled }),
```

### 2c. Include in `partialize` so it is persisted

```ts
partialize: (state) => ({
  // ...existing fields...
  vimMode: state.vimMode,
}),
```

### 2d. Bump the store version and add a migration

The current version is `2`. Bump to `3` and add a migration case:
```ts
version: 3,
migrate: (persistedState, version) => {
  // ...existing version 0 and 1 cases...
  if (version === 2) {
    // v2 → v3: add vimMode with false default.
    return {
      ...(persistedState as Record<string, unknown>),
      vimMode: false,
    } as unknown as WorkspaceState;
  }
  return persistedState as WorkspaceState;
},
```

---

## Step 3 — Add a vim status bar DOM element in `App.tsx`

The `monaco-vim` `initVimMode(editor, statusBarNode)` API requires a real DOM node for the status bar. Add a persistent `<div>` to the footer in the desktop layout and a matching one in the mobile query panel (since that is where the Run/Seed controls appear on mobile).

In `App.tsx`:
- Add a `vimStatusBarRef = useRef<HTMLDivElement>(null)` (one ref is enough — `monaco-vim` owns the text inside it; if multiple editors share one status bar DOM node the last active editor wins, which is acceptable for this tool).
- Render `<div ref={vimStatusBarRef} className="vim-statusbar" />` inside `<footer className="page-footer">` (desktop) and inside the mobile `seedAndRun` row.

---

## Step 4 — Wire vim mode to all editors via a `useEffect` in `App.tsx`

Import `initVimMode` from `monaco-vim`. The `initVimMode` call returns a disposable VimMode object; hold disposers in a `useRef<(() => void)[]>` so they can be cleaned up when `vimMode` is toggled off.

```ts
import { initVimMode } from "monaco-vim";

const vimDisposersRef = useRef<(() => void)[]>([]);

useEffect(() => {
  // Always clean up existing vim instances first.
  vimDisposersRef.current.forEach((d) => d());
  vimDisposersRef.current = [];

  if (!vimMode || !vimStatusBarRef.current) return;

  const statusEl = vimStatusBarRef.current;

  // Activate vim on every mounted editor.
  const editors: (_monaco.editor.IStandaloneCodeEditor | null)[] = [
    editor,           // schema/subgraph editor
    queryEditorRef.current,  // query editor
    // mock-config editor — needs its own ref (see step 4b)
    mockConfigEditorRef.current,
  ];

  for (const ed of editors) {
    if (!ed) continue;
    const vimInst = initVimMode(ed, statusEl);
    vimDisposersRef.current.push(() => vimInst.dispose());
  }

  return () => {
    vimDisposersRef.current.forEach((d) => d());
    vimDisposersRef.current = [];
  };
}, [vimMode, editor, /* queryEditorRef and mockConfigEditorRef are stable refs, no need to list */]);
```

**Note on deps:** `editor` and `monacoInstance` are already tracked as `useState` pairs. `queryEditorRef` is a `useRef` (stable object). The effect only re-runs when `vimMode` changes or the schema editor instance changes. That covers the full lifecycle.

### 4b — Add a ref for the mock-config editor

`App.tsx` currently has no `onMount` handler wiring a ref for the mock-config `<Editor>`. Add:
```ts
const mockConfigEditorRef = useRef<_monaco.editor.IStandaloneCodeEditor | null>(null);
```
And on both mock-config `<Editor>` instances (desktop and mobile):
```diff
+ onMount={(ed) => { mockConfigEditorRef.current = ed; }}
```

---

## Step 5 — Add the toggle to the page footer

The `vimMode` state and `setVimMode` action need to be read from `useWorkspace` in `App.tsx`. Add them to the destructured workspace state:
```ts
const { ..., vimMode, setVimMode } = useWorkspace();
```

In the desktop `<footer className="page-footer">` (around line 1960), after the spinner and before/after the seed label, add:
```tsx
<button
  onClick={() => setVimMode(!vimMode)}
  aria-pressed={vimMode}
  className={vimMode ? "btn is-active" : "btn"}
  title="Toggle vim keybindings"
>
  Vim
</button>
```

Add the same button to the mobile `seedAndRun` fragment (the `const seedAndRun = (...)` JSX block, around line 1307).

Add the vim status bar `<div>` immediately after the button in both locations:
```tsx
<div ref={vimStatusBarRef} className="vim-statusbar" />
```

---

## Step 6 — Style the vim status bar (`web/src/theme.css`)

Add a `.vim-statusbar` rule in the footer section:

```css
/* Vim mode status bar — shown when vim keybindings are active */
.vim-statusbar {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  min-width: 80px;
}
.vim-statusbar:empty {
  display: none;
}
```

Also add an `.btn.is-active` modifier to match the active state convention used by `is-success`:
```css
.btn.is-active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}
```

---

## Step 7 — Cleanup on editor unmount

The vim effect's cleanup function (the `return () => { ... }` block) already disposes all vim instances when `vimMode` toggles off. Additionally ensure the effect depends on `editor` so that if the schema editor remounts (e.g. after a subgraph switch causes a full remount) vim is reattached.

---

## Integration & Verification

After implementing:

1. `pnpm tsc --noEmit` — no type errors.
2. `pnpm lint` — no lint errors.
3. `pnpm test run` — existing tests still pass (no vim-specific unit tests needed — behavior is DOM/Monaco lifecycle).
4. Manual smoke test in the browser:
   - Click "Vim" button → all editors respond to `j/k/i/Esc` vim keys.
   - Status bar shows "NORMAL", "INSERT", "VISUAL" as appropriate.
   - Click "Vim" again → editors return to normal Monaco keybindings.
   - Reload the page → preference is restored from localStorage.
   - No page reload required when toggling.

---

## Files Changed

- `web/package.json` — add `monaco-vim` dependency
- `web/src/store.ts` — `vimMode` state, setter, persist, migration v3
- `web/src/App.tsx` — `vimStatusBarRef`, `mockConfigEditorRef`, vim useEffect, toggle button + status bar in footer and mobile seedAndRun
- `web/src/theme.css` — `.vim-statusbar` and `.btn.is-active` styles
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Package
- Added `monaco-vim@0.4.4` to `web/package.json` dependencies via `pnpm add monaco-vim`

### Store changes (`web/src/store.ts`)
- Added `vimMode: boolean` and `setVimMode` to `WorkspaceState` interface
- Default value is `false`
- Included in `partialize` so it persists in localStorage
- Bumped store version from 2 to 3 with a migration that sets `vimMode: false` for existing users

### App.tsx changes
- Added `import { initVimMode } from 'monaco-vim'`
- Destructured `vimMode` and `setVimMode` from `useWorkspace()`
- Added `mockConfigEditorRef`, `vimStatusBarRef`, and `vimDisposersRef` refs
- Added `onMount` handlers to both mock-config `<Editor>` instances (desktop + mobile) to capture the editor instance
- Added a `useEffect` that disposes any existing vim instances and re-initializes vim on all three editor instances (schema, query, mock-config) whenever `vimMode` or the `editor` state changes
- Added Vim toggle button and `<div ref={vimStatusBarRef} className="vim-statusbar" />` to both the `seedAndRun` JSX block (mobile) and the desktop `<footer className="page-footer">`

### CSS changes (`web/src/theme.css`)
- Added `.btn.is-active` modifier with accent color styling for the toggled-on state
- Added `.vim-statusbar` rule with monospace font and `:empty { display: none }` to hide the bar when vim is off

### Test setup (`web/src/setupTests.tsx`)
- Added `vi.mock('monaco-vim', ...)` to prevent the browser-only module from loading in jsdom tests
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented vim keybindings toggle for all Monaco editor instances. Added `monaco-vim@0.4.4` as a dependency. Extended the Zustand store (version 2→3) with a persisted `vimMode` boolean and `setVimMode` action. Added a `useEffect` in `App.tsx` that attaches `initVimMode` to the schema editor, query editor, and mock-config editor whenever `vimMode` is true, and disposes all vim instances on toggle-off. Added `onMount` capture for mock-config editors (both desktop and mobile instances). Added a Vim toggle button (with `.btn.is-active` styling) and a `<div className="vim-statusbar">` to both the desktop `<footer>` and the mobile `seedAndRun` block. Added `.btn.is-active` and `.vim-statusbar` CSS rules to `theme.css`. Mocked `monaco-vim` in `setupTests.tsx` so jsdom tests continue to pass (all 334 tests green).
<!-- SECTION:FINAL_SUMMARY:END -->
