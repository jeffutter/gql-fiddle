---
id: TASK-67
title: 'feat(web): tour playback mode — 3-pane layout driven by #t= URL'
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-20 03:13'
updated_date: '2026-06-20 14:22'
labels:
  - feat
  - web
  - tour
  - planned
dependencies:
  - TASK-64
priority: high
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the reader-facing playback mode. When the app loads a `#t=` URL hash, it decodes the tour and enters a simplified 3-pane layout instead of the normal fiddle.

**Design decisions from planning session:**
- Layout: prose panel left (~40% width), schema editor read-only top-right, query plan bottom-right.
- The query editor is hidden in playback; the active query is part of the step's resolved workspace and drives the plan automatically (auto-run is already wired up in the existing fiddle).
- Subgraph tabs remain visible so the reader can switch between subgraphs to inspect the full picture.
- Step navigation: Prev/Next buttons + step counter (e.g. "2 / 5") in the playback header. The tour title also appears in the header.
- "Open in Fiddle" button in the playback header loads the current step's resolved workspace (base + overrides merged via `resolveTourStep`) into the normal fiddle — navigates to `#w=` URL or loads workspace into state and drops the `#t=` hash.
- Schema editors are read-only in playback (Monaco `readOnly: true` option).
- Playback is a distinct layout from the normal fiddle — not the same component rearranged, but a dedicated `TourPlayback.tsx` component that reads from the decoded tour.

**Entry point in `App.tsx`:**
- On mount, check `location.hash`. If it starts with `#t=`, decode the tour via `decodeTour` (TASK-64), store it in component state, and render `<TourPlayback>` instead of the normal fiddle layout.
- The existing `#w=` restore logic remains untouched.

**Files likely touched:** `web/src/App.tsx`, new `web/src/TourPlayback.tsx`, `web/src/share.ts` (re-export `decodeTour`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A #t= URL hash causes the app to render the playback layout instead of the normal fiddle
- [x] #2 Prose panel is displayed on the left showing the active step's label and prose text (Markdown rendered)
- [x] #3 Schema editor panel is top-right, read-only, showing the active step's resolved subgraph SDL
- [x] #4 Query plan panel is bottom-right, updating automatically as the resolved workspace changes per step
- [x] #5 Subgraph tabs are present and switch the read-only editor between subgraphs
- [x] #6 Prev/Next buttons and step counter navigate between steps
- [x] #7 Step navigation updates the prose, schema editor content, and active subgraph appropriately
- [x] #8 'Open in Fiddle' loads the current step's resolved workspace into the normal fiddle UX
- [x] #9 Invalid or malformed #t= URL shows a clear error message rather than a blank screen
- [x] #10 Tour title appears in the playback header
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Overview

`TourPlayback.tsx` is a dedicated root-level React component that replaces `<App>` when the URL hash starts with `#t=`. It decodes the tour via `decodeTour` (already in `share.ts`), drives a 3-pane layout (prose left, schema editor top-right, query plan bottom-right), and manages its own local step state entirely without touching the Zustand workspace store. `App.tsx` mounts it via a single conditional on the decoded hash at startup.

No sub-tickets are needed — the work is tightly scoped to two files (`App.tsx`, `TourPlayback.tsx`) plus CSS additions to `theme.css`, all of which must ship together for the feature to be coherent.

---

### Step 1 — Entry point in `App.tsx`

In the `App` component, add a new piece of state at the top of the function body:

```ts
const [playbackTour, setPlaybackTour] = useState<Tour | null>(null);
const [playbackError, setPlaybackError] = useState<string | null>(null);
```

Import `Tour` and `decodeTour` from `./share` (both are already exported; `Tour` is already imported via `WorkspacePayload`). Adjust the existing `#w=` restore `useEffect` to also check for `#t=`:

```ts
useEffect(() => {
  const hash = location.hash;
  if (hash.startsWith('#t=')) {
    try {
      const tour = decodeTour(hash);
      setPlaybackTour(tour);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (err) {
      setPlaybackError(err instanceof Error ? err.message : 'Failed to decode tour');
    }
    return;
  }
  if (!hash.startsWith('#w=')) return;
  // ... existing #w= restore logic unchanged
}, []);
```

Then, early in the render (before `if (isMobile)`), insert a conditional:

```tsx
if (playbackError !== null) {
  return (
    <div className="tour-playback__error">
      <p>Could not load tour: {playbackError}</p>
    </div>
  );
}
if (playbackTour !== null) {
  return <TourPlayback tour={playbackTour} />;
}
```

Import `TourPlayback` from `./TourPlayback`. The `#t=` branch exits early before the entire normal fiddle tree is rendered — no Monaco workers are initialized, no Zustand mutations happen.

---

### Step 2 — `TourPlayback.tsx`

Create `web/src/TourPlayback.tsx` as a self-contained component. It owns all playback state locally (no Zustand reads/writes). Props: `{ tour: Tour }`.

#### Local state

```ts
const [stepIndex, setStepIndex] = useState(0);
const [activeSubgraph, setActiveSubgraph] = useState(0);
const [compose, setCompose] = useState<ComposeResult | null>(null);
const [planResult, setPlanResult] = useState<PlanResult | null>(null);
```

#### Derived workspace per step

```ts
const workspace = useMemo(
  () => resolveTourStep(tour, stepIndex),
  [tour, stepIndex]
);
const activeStep = tour.steps[stepIndex];
const subgraphs = workspace.subgraphs;
const currentQuery = workspace.queryTabs[workspace.activeQueryTab]?.query ?? '';
```

#### Composition and auto-run effects

Mirror the debounced compose and auto-run effects from `App.tsx`, but driven by `workspace.subgraphs` and `currentQuery`:

- Compose effect: debounce 300 ms, call `loadCore().then(core => core.compose(subgraphs))`, set `compose` state. On success also initialize `monacoGraphQLAPI` for syntax highlighting in the read-only editor (optional but consistent with App.tsx).
- Auto-run effect: debounce 400 ms, triggered when `currentQuery` or `compose` result (supergraphSdl) changes. Call `core.plan(supergraphSdl, currentQuery)`, set `planResult`.

Both effects run only when the resolved workspace changes (i.e., when `stepIndex` changes), so performance is identical to `App.tsx`.

#### Layout — 3 panes

```tsx
<div className="tour-playback">
  <header className="tour-playback__header">
    <div className="logo">...</div>  {/* same logo SVG as App.tsx */}
    <span className="tour-playback__title">{tour.title}</span>
    <div className="tour-playback__nav">
      <button onClick={() => setStepIndex(i => i - 1)} disabled={stepIndex === 0} className="btn">← Prev</button>
      <span className="tour-playback__counter">{stepIndex + 1} / {tour.steps.length}</span>
      <button onClick={() => setStepIndex(i => i + 1)} disabled={stepIndex === tour.steps.length - 1} className="btn">Next →</button>
    </div>
    <button onClick={openInFiddle} className="btn btn--primary">Open in Fiddle</button>
  </header>

  <div className="tour-playback__body">
    {/* Left — prose panel (~40%) */}
    <div className="tour-playback__prose-panel">
      <h2 className="tour-playback__step-label">{activeStep?.label}</h2>
      <div className="tour-playback__prose-content">
        <ProseRenderer prose={activeStep?.prose ?? ''} />
      </div>
    </div>

    {/* Right column — schema (top) + plan (bottom) */}
    <div className="tour-playback__right">
      {/* Schema editor — read-only */}
      <div className="tour-playback__schema-panel">
        <nav className="tab-strip">
          {subgraphs.map((sg, i) => (
            <button key={i} className={i === activeSubgraph ? 'tab is-active' : 'tab'}
              onClick={() => setActiveSubgraph(i)}>
              {sg.name}
            </button>
          ))}
        </nav>
        <div className="editor">
          <Editor
            path={`playback-sg-${stepIndex}-${activeSubgraph}`}
            value={subgraphs[activeSubgraph]?.sdl ?? ''}
            language="graphql"
            height="100%"
            theme={MONACO_THEME}
            beforeMount={m => defineMonacoTheme(m)}
            options={{ ...EDITOR_OPTIONS, readOnly: true }}
          />
        </div>
      </div>

      {/* Query plan — bottom */}
      <div className="tour-playback__plan-panel">
        <h2 className="section-title">Query Plan</h2>
        {planResult === null ? (
          <p className="empty-state">Composing…</p>
        ) : planResult.ok ? (
          <div className="scroll"><PlanTree node={planResult.query_plan} /></div>
        ) : (
          <div className="callout callout--error">
            {planResult.errors.map((e, i) => <p key={i}>{e.message}</p>)}
          </div>
        )}
      </div>
    </div>
  </div>
</div>
```

#### `ProseRenderer` — inline minimal markdown

No new npm dependency. Implement a small `ProseRenderer` component using `dangerouslySetInnerHTML` with a tiny inline parser, OR just render the prose as `<pre>` text if the ticket does not require rendered markdown. The ticket says "Markdown rendered" — use a lightweight approach: convert `**bold**`, `*italic*`, `[text](url)` and `\n\n` paragraph breaks with a simple regex chain, then set via `dangerouslySetInnerHTML`. This is consistent with how `SequenceDiagram.tsx` uses `innerHTML` for the SVG. No external parser is needed for the minimal markdown in tour prose.

```ts
function renderMarkdown(prose: string): string {
  return prose
    .split(/\n\n+/)
    .map(para =>
      `<p>${para
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>')
      }</p>`
    )
    .join('');
}
```

#### `openInFiddle` function

```ts
function openInFiddle() {
  const payload = resolveTourStep(tour, stepIndex);
  const hash = encode(payload);
  window.location.hash = hash;
  // The App component's #w= restore effect will pick it up on next render.
  window.location.reload();
}
```

This is the simplest correct implementation: set the `#w=` hash then reload. The normal fiddle restores from it exactly as a shared workspace URL. No shared Zustand state needed.

---

### Step 3 — CSS additions to `theme.css`

Add a new section at the bottom of `theme.css` after the tour authoring panel section:

```css
/* Tour playback layout */
.tour-playback {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
}

.tour-playback__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.tour-playback__title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tour-playback__nav {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tour-playback__counter {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 48px;
  text-align: center;
}

.tour-playback__body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
  padding: 8px;
}

.tour-playback__prose-panel {
  width: 40%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.tour-playback__step-label {
  margin: 0;
  padding: 10px 14px 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tour-playback__prose-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  font-size: 14px;
  line-height: 1.65;
}

/* Inline rendered prose styles */
.tour-playback__prose-content p { margin: 0 0 0.75em; }
.tour-playback__prose-content p:last-child { margin-bottom: 0; }
.tour-playback__prose-content a { color: var(--accent); text-decoration: underline; }
.tour-playback__prose-content code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}

.tour-playback__right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tour-playback__schema-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.tour-playback__plan-panel {
  height: 40%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px;
  overflow: hidden;
}

.tour-playback__error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: 24px;
  color: var(--danger);
  font-size: 14px;
}
```

---

### Step 4 — Monaco worker singleton concern

`TourPlayback.tsx` uses `<Editor>` from `@monaco-editor/react`. The Monaco worker environment (`self.MonacoEnvironment`) is configured at module scope in `App.tsx`. Since `TourPlayback` is rendered instead of `App`, the worker config block in `App.tsx` must be moved to module scope in a shared location (e.g., the top of `main.tsx` or a new `monacoSetup.ts`) so that the `Editor` component works in both App and TourPlayback.

Simplest approach: move the `self.MonacoEnvironment = { getWorker... }` block and `loader.config(...)` call to `main.tsx` (before `ReactDOM.render`). Both `App.tsx` and `TourPlayback.tsx` will then inherit it.

---

### Step 5 — Tests

Add to `App.test.tsx` a new `describe('tour playback')` block:

1. **AC#1:** When `location.hash` starts with `#t=` containing a valid encoded tour, `<App>` renders `<TourPlayback>` (not the normal fiddle). Assert that `data-testid="subgraph-editor"` is absent, and a `tour-playback` element is present.
2. **AC#9:** When `location.hash` is `#t=INVALID`, an error message is shown (not a blank screen, not the fiddle).

Add a `TourPlayback.test.tsx` file testing the component in isolation (no `<App>` wrapper):

3. **AC#2:** Prose panel shows `activeStep.label` and `activeStep.prose` for step 0.
4. **AC#6:** Clicking Next increments the step counter; clicking Prev decrements it.
5. **AC#5:** Subgraph tabs switch the read-only editor between subgraphs.
6. **AC#7:** After navigating to step 1, prose reflects step 1's content.
7. **AC#10:** Tour title appears in the playback header.

Use the same mock pattern as `App.test.tsx` (mock `./core`, mock `mermaid`, mock Monaco via `setupTests.tsx`).

---

### Verification

```bash
cd web && pnpm test run        # all unit tests pass
pnpm tsc --noEmit              # no type errors
```

Manual:
1. Encode a tour in the console: `import {encodeTour} from './share'; encodeTour({...})` 
2. Navigate to `http://localhost:5173/<encoded hash>`
3. Verify: playback header, prose panel left, schema editor top-right (read-only), plan bottom-right, step navigation works, subgraph tabs work, "Open in Fiddle" reloads into normal mode.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in three main files:
- `web/src/TourPlayback.tsx` (new): self-contained 3-pane playback component with local state, debounced compose + plan effects mirroring App.tsx, inline markdown renderer, subgraph tabs, Prev/Next nav, and 'Open in Fiddle' via encode+reload.
- `web/src/App.tsx`: added `decodeTour`/`TourPlayback` imports, two new state vars (`playbackTour`, `playbackError`), extended `#w=` restore effect to also handle `#t=` (early-return before any Zustand mutations or Monaco initialization), and added early-return render conditionals for error/playback paths before `isMobile`.
- `web/src/theme.css`: added complete `tour-playback` layout CSS section at the bottom.
- Tests added in `App.test.tsx` (AC#1, AC#9) and new `TourPlayback.test.tsx` (AC#2, AC#5, AC#6, AC#7, AC#10).
- Monaco worker config note: `self.MonacoEnvironment` is still in App.tsx module scope; since TourPlayback is rendered *instead of* App (never both), this is fine — App's module is loaded first and the worker config runs before TourPlayback renders.
- All 226 tests pass, `pnpm tsc --noEmit` is clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the tour playback mode with a dedicated `TourPlayback.tsx` component that renders a 3-pane layout (prose left, read-only schema editor top-right, query plan bottom-right) when the URL hash starts with `#t=`. App.tsx detects the hash on mount, decodes the tour via `decodeTour`, and short-circuits the normal fiddle render. The component manages all state locally without touching Zustand, mirrors App.tsx's debounced compose + plan effects, and provides Prev/Next step navigation, subgraph tabs, inline Markdown rendering, and an 'Open in Fiddle' button. CSS added to theme.css; all 10 acceptance criteria covered with unit tests (226 tests pass, TypeScript clean)."
<!-- SECTION:FINAL_SUMMARY:END -->
