---
id: TASK-96.4
title: 'Extract shared UI from App.tsx: TabStrip, EditableTab, clipboard helper'
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 00:29'
updated_date: '2026-07-01 23:12'
labels:
  - review
  - planned
dependencies: []
parent_task_id: TASK-96
priority: low
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/src/App.tsx duplicates the tab strip + content switch 3-4x (desktop output ~2152, desktop results ~2288, mobile ~1950, fullscreen ~2402); the rename-on-double-click + close editable-tab pattern 3x (subgraph/query/workspace, 6 state var pairs); and the clipboard fallback block 4x (copyError, copyForLLM, copyShareUrl, copyTourShareUrl — all sharing one 'copied' state). Extract a <TabStrip>, an <EditableTab>, and a copyText()/useCopyToClipboard() helper (~400 lines of mechanical dedup).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 one TabStrip, one EditableTab, and one clipboard helper replace the duplicates
- [x] #2 independent copy buttons show their 'Copied\!' state independently
- [x] #3 behavior is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implementation plan

Scope: web/src/App.tsx only (plus 3 new files). No sub-tickets — this is a single
mechanical dedup pass with three independent, well-understood extractions that
naturally ship together as one PR-sized change. Current file: 2371 lines.

Three duplicated patterns to extract, matching the ticket description exactly:

1) Clipboard fallback (4x) -> `web/src/useCopyToClipboard.ts`
   - New hook, same directory-level convention as `useTourAuthoringDecorations.ts`:
       export function useCopyToClipboard(revertDelayMs = 1500) {
         const [copied, setCopied] = useState(false);
         function copy(text: string) {
           const markCopied = () => {
             setCopied(true);
             setTimeout(() => setCopied(false), revertDelayMs);
           };
           if (navigator.clipboard) {
             void navigator.clipboard.writeText(text).then(markCopied);
           } else {
             const ta = document.createElement("textarea");
             ta.value = text;
             ta.style.cssText = "position:fixed;opacity:0";
             document.body.appendChild(ta);
             ta.select();
             document.execCommand("copy");
             document.body.removeChild(ta);
             markCopied();
           }
         }
         return [copied, copy] as const;
       }
   - Preserve exact timing: clipboard-API path marks copied inside `.then()`
     (microtask, matches existing App.test.tsx TASK-43 AC#6 test which awaits
     two microtasks); execCommand fallback path marks copied synchronously.
     Do not "simplify" this into a single async function — that would push the
     execCommand branch's setCopied onto a microtask too and is an unnecessary
     behavior change.
   - Replace 4 call sites in App.tsx:
     - `ErrorMessage` (line ~94): already has its own independent `copied`
       state — just swap its inline block for the hook. No behavior change.
     - `copyForLLM` (~880), `copyShareUrl` (~929), `copyTourShareUrl` (~978):
       these three currently all read/write the SAME `const [copied, setCopied]
       = useState(false)` declared once at App's top level (~line 315). This is
       an existing bug: clicking "Copy for LLM" also flips the adjacent
       "Share"/"Share Tour" button to "Copied!" because they share state.
       Fix: call `useCopyToClipboard()` three separate times (one per button)
       so each button's `[copied, copy]` pair is independent, and update the
       three onClick handlers to build their text/url and call their own
       `copy(text)` instead of duplicating the clipboard block inline. Delete
       the shared `[copied, setCopied]` state declaration.
   - This directly satisfies AC#2 ("independent copy buttons show their
     'Copied!' state independently") — today it is false for
     copyForLLM/copyShareUrl/copyTourShareUrl.
   - Existing test to keep green: App.test.tsx "TASK-43 AC#6: clicking Share
     shows 'Copied!' then reverts after 1500ms" (~line 1292) — only asserts
     the Share button's own text, so it should pass unchanged. Add one new
     regression test in App.test.tsx asserting that clicking "Copy for LLM"
     does NOT flip the "Share" button's text to "Copied!" (covers AC#2 and
     locks in the bug fix — this is user-visible behavior the ticket calls
     out explicitly, so it deserves a test even though the ticket doesn't
     mandate one).

2) EditableTab (rename-on-double-click + close, 3x) -> `web/src/EditableTab.tsx`
   - New component, self-contained rename state (removes the 6 App-level
     state vars: renamingIndex/renameValue, renamingQueryTab/renameQueryValue,
     renamingWorkspaceIndex/renameWorkspaceValue):
       interface EditableTabProps {
         name: string;
         active: boolean;
         onSelect: () => void;
         onRename: (newName: string) => void;
         onRemove: () => void;
         canRename?: boolean;       // default true
         testId?: string;
         removeAriaLabel?: string;
         removeTestId?: string;
       }
     Internal state: `const [renaming, setRenaming] = useState(false)` and
     `const [value, setValue] = useState(name)`. Rendered markup must be
     byte-for-byte identical to today's three call sites:
       <button onClick={onSelect} aria-pressed={active}
         className={active ? "tab is-active" : "tab"} data-testid={testId}>
         {renaming ? <input ... className="tab__rename" /> : (
           <span onDoubleClick={...} title={canRename ? "Double-click to rename" : undefined}>
             {name}
           </span>
         )}
         <span onClick={...} className="tab__close" aria-label={removeAriaLabel}
           data-testid={removeTestId}>×</span>
       </button>
     Commit-on-blur/Enter, cancel-on-Escape, `e.stopPropagation()` in the same
     places as today, `size={Math.max(value.length, 3)}` on the input, and
     `setValue(name)` when entering rename mode (mirrors today's
     `setRenameValue(sg.name)` etc.) — all copied verbatim from the existing
     three blocks (App.tsx ~1053-1097 subgraph, ~1145-1190 query,
     ~1443-1491 workspace).
   - `canRename` reproduces the one real difference between the three: the
     workspace tab strip only allows rename when the tab is already active
     (`if (i !== activeWorkspaceIndex) return;` guard, ~line 1470) while
     subgraph/query tabs allow rename unconditionally. Pass
     `canRename={i === activeWorkspaceIndex}` only from the workspace call
     site; omit (default true) for subgraph/query.
   - `testId`/`removeAriaLabel`/`removeTestId` are only populated by the
     workspace call site (`workspace-tab-${i}`, `Remove ${ws.name}`,
     `workspace-remove-${i}`) — leave them undefined for subgraph/query so no
     extra attributes render there (React omits undefined props), matching
     current DOM exactly.
   - Do NOT extract the surrounding `<nav className="tab-strip">...</nav>` /
     `<nav className="workspace-tab-strip">...</nav>` wrappers — each has a
     different trailing button (subgraph: `+`; query: `+` and a
     "Mock Config" toggle tab; workspace: clone + `+`). Only the per-item
     `<button>` becomes `<EditableTab />`; the wrapping nav and trailing
     buttons stay inline in App.tsx exactly as today.
   - Verify against App.test.tsx tests that read `nav.tab-strip`, `.tab__close`
     spans by textContent "×", `button:last-child`, and `aria-pressed` (e.g.
     ~lines 510-649) — these assert on rendered DOM structure/order, not
     component boundaries, so they must keep passing unmodified.

3) TabStrip (tab strip + content switch, 4x) -> `web/src/TabStrip.tsx`
   - Scope: only the "switch which content pane is shown" tab bars — output
     tab strip (mobile ~1850, desktop ~2060) and results tab strip (mobile
     ~1901, desktop ~2196). These are plain label buttons over `outputTab` /
     `resultsTab` state, distinct from the EditableTab pattern above (no
     rename/close).
       export interface TabStripTab {
         key: string;
         label: ReactNode;
         active: boolean;
         onClick: () => void;
       }
       export function TabStrip({ tabs, trailing }: { tabs: TabStripTab[]; trailing?: ReactNode }) {
         return (
           <nav className="tab-strip">
             {tabs.map((tab) => (
               <button key={tab.key} onClick={tab.onClick} aria-pressed={tab.active}
                 className={tab.active ? "tab is-active" : "tab"}>
                 {tab.label}
               </button>
             ))}
             {trailing}
           </nav>
         );
       }
   - In App.tsx, build the two tab arrays once each render (mirrors current
     inline-JSX-per-render style, no memoization needed):
       outputTabs = [type-graph, entities, sdl, api-sdl] over outputTab
       resultsTabs = [plan, sequence, timeline, schema-tree, output] over resultsTab
   - `trailing` differs per call site — pass as JSX, do not generalize further:
     - mobile output (~1850): no trailing.
     - desktop output (~2060): trailing = the "expand to full screen" icon
       button, shown only when outputTab is type-graph/entities.
     - mobile results (~1901): trailing = `<ExportImageButton ... style={{marginLeft:"auto"}} />`
       when resultsTab === "sequence" (no expand button precedes it here, so
       the button itself needs the auto margin).
     - desktop results (~2196, and the one at ~2060's sibling around line
       2196–2267): trailing = expand button (marginLeft: auto) when resultsTab
       is plan/sequence/timeline/schema-tree, followed by
       `<ExportImageButton>` (no margin) when resultsTab === "sequence".
   - Fullscreen modal (~2317-2361) is NOT a TabStrip instance — it renders a
     single title + close button, not a tab bar. Do not touch it beyond
     leaving it as-is; the ticket description's "fullscreen" reference is
     about content reuse, not a duplicated tab strip.
   - Content below each TabStrip (compositionErrorContent ?? outputTab-switch,
     resultsTab-switch) stays inline in App.tsx unchanged — only the `<nav>`
     of buttons is replaced.

Integration / verification steps:
   - After all three extractions, App.tsx should be meaningfully shorter (rough
     estimate: ~300-400 lines removed per the ticket's own estimate), with the
     6 rename-related state vars and the 1 shared `copied` state var deleted.
   - Run `cd web && pnpm tsc --noEmit` (typecheck), `pnpm lint`, and
     `pnpm test run App.test.tsx` (or full `pnpm test run`) — all three
     extractions are pure refactors, so the full existing App.test.tsx suite
     must pass unmodified except for the one new regression test added in
     step 1.
   - Manually confirm via `pnpm test run` that the DOM-structure-sensitive
     tests (button:last-child, close-span counts/order, aria-pressed) still
     pass — these are the tests most likely to break from a careless
     extraction.
   - `pnpm prettier --check .` per repo convention (pre-commit enforces
     prettier/eslint/tsc on staged files).

Out of scope / explicitly not doing:
   - No sub-tickets: the three extractions are independent enough to review
     separately in the diff but small enough (mechanical, well-understood,
     one file's worth of call-site changes) to implement and land together in
     one focused session.
   - Not touching TASK-96.1/96.2/96.3 concerns (Monaco hook, pipeline hook,
     tour decorations hook) — those are separate tickets/files.
   - Not changing the "Mock Config" tab button or the clone/add buttons on the
     workspace/query/subgraph strips — only the per-tab EditableTab items and
     the pure content-switch TabStrip bars are touched.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented all three extractions as planned:

1. useCopyToClipboard.ts (new hook) — replaces the 4 inline clipboard-fallback
   blocks. ErrorMessage now calls it directly. copyForLLM/copyShareUrl/
   copyTourShareUrl now each call `useCopyToClipboard()` independently
   (copiedLLM/copyLLM, copiedShare/copyShare, copiedTourShare/copyTourShare)
   instead of sharing one `copied` state — this fixes the pre-existing bug
   where clicking one of these buttons flipped the others to "Copied!" too.
   Added a regression test (App.test.tsx, TASK-96.4 AC#2) asserting clicking
   "Copy for LLM" does not flip "Share" to "Copied!".

2. EditableTab.tsx (new component) — replaces the 3 rename-on-double-click +
   close blocks (subgraph/query/workspace tab strips) and removes the 6
   App-level rename state vars. `canRename` reproduces the workspace-only
   "must be active to rename" guard; `testId`/`removeAriaLabel`/`removeTestId`
   are only passed from the workspace call site, matching prior DOM exactly.

3. TabStrip.tsx (new component) — replaces the 4 output/results content-switch
   tab bars (mobile output/results, desktop output/results). Built
   `outputTabs`/`resultsTabs` arrays once per render; `trailing` JSX
   (expand-to-fullscreen / ExportImageButton) stays inline per call site as
   planned, not generalized further.

Verification: `pnpm tsc --noEmit` clean, `pnpm lint` clean (only 2
pre-existing unrelated exhaustive-deps warnings, confirmed present before
this change via git stash), `pnpm prettier --check` clean, full `pnpm test
run` — 394/394 passing across 18 files (App.test.tsx: 70/70, including the
new regression test).

App.tsx: 2371 -> 2127 lines (244 lines removed) plus 3 new focused files
(useCopyToClipboard.ts, EditableTab.tsx, TabStrip.tsx).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted three mechanically-duplicated UI patterns out of App.tsx into web/src/useCopyToClipboard.ts, web/src/EditableTab.tsx, and web/src/TabStrip.tsx, shrinking App.tsx by ~244 lines while fixing a pre-existing bug where the LLM/Share/Share-Tour copy buttons all shared one 'Copied!' state.
<!-- SECTION:FINAL_SUMMARY:END -->
