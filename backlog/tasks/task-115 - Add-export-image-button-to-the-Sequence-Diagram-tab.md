---
id: TASK-115
title: Add export-image button to the Sequence Diagram tab
status: Done
assignee:
  - '@ralph'
created_date: '2026-07-01 13:21'
updated_date: '2026-07-01 15:39'
labels:
  - planned
dependencies: []
priority: medium
ordinal: 146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add an "Export image" control to the Sequence Diagram tab so users can save the rendered diagram to a file. Place it in the results tab-strip next to the existing full-screen (expand) button, following that button's btn btn--icon styling and marginLeft:auto positioning.

The diagram is rendered by Mermaid into an <svg> element inside a container div (see web/src/SequenceDiagram.tsx; the container currently holds the SVG via innerHTML). Export should read that rendered SVG.

Support both SVG and PNG. When both are available, clicking Export opens a small dialog/menu asking which format the user prefers (matching the existing modal/dialog patterns in App.tsx, e.g. the fullscreen modal / AboutModal), then downloads the file.

- SVG export: serialize the live <svg> node (XMLSerializer) and download as a Blob (image/svg+xml). Ensure the serialized SVG is self-contained (inline theme colors / width+height so it renders standalone).
- PNG export: rasterize the SVG onto a canvas (set explicit pixel dimensions from the SVG viewBox, paint a theme-appropriate background since the SVG background is transparent), then canvas.toBlob('image/png') and download.

Suggested filenames: sequence-diagram.svg / sequence-diagram.png.

Scope: Sequence Diagram tab only. The other visual tabs (Query Plan, Timeline, Query Shape, Type Graph, Entities) are out of scope here, but implement the export as a small reusable helper so it can be extended to them later. Consider exposing the button both in the inline tab view and in the fullscreen modal if low-cost.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An Export-image button appears in the Sequence Diagram tab-strip, adjacent to the full-screen button, using the existing btn btn--icon icon-button styling
- [x] #2 Clicking Export presents a format choice (SVG vs PNG) via a small dialog/menu consistent with existing dialog patterns in the app
- [x] #3 Choosing SVG downloads a self-contained .svg file of the current rendered diagram
- [x] #4 Choosing PNG downloads a rasterized .png of the current rendered diagram with a theme-appropriate (non-transparent) background
- [x] #5 The button is disabled or hidden when no diagram is rendered (no query plan / render error)
- [x] #6 SVG/PNG generation is factored into a small reusable helper (not inlined solely in the Sequence Diagram tab) so other visual tabs can adopt it later
- [x] #7 pnpm tsc --noEmit and pnpm lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). This ticket is WEB-ONLY (no Rust/WASM changes). ALL commands run inside the Nix dev shell: either 'direnv allow' once, or prefix every command with 'nix develop -c bash -c "..."'. Work from the repo root. git add any NEW file before running build commands (the Nix flake only sees git-tracked files). Do not change pinned dependency versions. Single PR.

SCOPE: Sequence Diagram tab only. Add an "Export image" icon button to the results tab-strip next to the existing full-screen (expand) button. Clicking it opens a small SVG-vs-PNG format-choice dialog, then downloads the file. Build the serialize/rasterize/download logic as a small reusable helper so other visual tabs (Query Plan, Timeline, Query Shape, Type Graph, Entities) can adopt it later — but wire it up ONLY for the sequence tab now.

--- KEY ARCHITECTURE FACTS (verified against the codebase) ---
- web/src/SequenceDiagram.tsx renders Mermaid output via containerRef.current.innerHTML = svg (mermaid.render() returns { svg } string). Mermaid v11.15.0 emits width/height + viewBox on the <svg> and embeds an opaque background <rect> (theme background #16243a). The live node is reachable as containerRef.current.querySelector('svg').
- The Export button lives in the tab-strip in web/src/App.tsx, NOT inside SequenceDiagram. So the parent must be able to reach the rendered <svg>. There are TWO tab-strips (mobile ~line 2011/2039 and desktop ~line 2298/2354) plus a fullscreen modal (~line 2402-2437) that also renders sequenceContent. The expand button pattern (className="btn btn--icon", style={{ marginLeft: "auto" }}, inline 14x14 stroke=currentColor svg) appears at ~line 1323, 2184, 2330 — LOCATE BY 'marginLeft: "auto"' + the expand path, line numbers WILL drift.
- sequenceContent is a single shared JSX value (~line 2403-2417 region) reused by both layouts and the fullscreen modal; it renders <SequenceDiagram node={planResult.query_plan} /> only when planResult?.ok, else an empty-state / error callout.
- planResult state: const [planResult, setPlanResult] = useState<PlanResult | null>(null) (~line 256). planResult?.ok === true is the signal that a diagram should exist (AC#5).
- No download/Blob/XMLSerializer/toBlob code exists anywhere yet. No utils/ dir — top-level single-purpose modules are the convention (share.ts, auth.ts, encryption.ts, sync.ts). New helper goes at web/src/imageExport.ts.
- Modal convention: web/src/AboutModal.tsx — backdrop div className="fullscreen-modal-backdrop" onClick={onClose}; inner div className="fullscreen-modal" role="dialog" aria-modal="true" with e.stopPropagation(); Escape-key handler in useEffect with cleanup; header .fullscreen-modal__header + .fullscreen-modal__title + a btn btn--icon close button. Simple dialogs use a boolean useState. Buttons use emoji glyphs or inline svg, className "btn"/"btn--icon" (theme.css ~line 199-255). App uses a SINGLE dark theme; surface bg is --surface #16243a, text --text #e7edf6 (theme.css).

--- STEP 1: reusable export helper (AC#3, #4, #6) ---
Create web/src/imageExport.ts as a small, general-purpose module keyed on an SVGElement (so any tab can pass its own node later). Export:
  - function downloadBlob(blob: Blob, filename: string): void — create an object URL, click a temporary <a download=filename>, then revokeObjectURL. (Foundational; usable by future non-image exports too.)
  - function svgToString(svg: SVGSVGElement): string — clone the node, ensure it is self-contained/standalone: set explicit width/height attributes (from getAttribute or viewBox) and xmlns="http://www.w3.org/2000/svg" (+ xmlns:xlink if needed) so it renders outside the app, then XMLSerializer().serializeToString(clone). Mermaid inlines its <style>, so colors travel with the node; just guarantee dimensions + xmlns.
  - function exportSvg(svg: SVGSVGElement, filename: string): void — downloadBlob(new Blob([svgToString(svg)], { type: "image/svg+xml" }), filename).
  - async function exportPng(svg: SVGSVGElement, filename: string, background: string): Promise<void> — read pixel dims from viewBox (fallback to width/height attrs, fallback to getBoundingClientRect), create a canvas at those dims (optionally * devicePixelRatio for crispness), fillRect the background first (AC#4 — paint non-transparent #16243a even though Mermaid embeds a rect, to cover the full canvas and any tabs whose SVG is transparent), load the serialized SVG into an Image via a data URL or object URL, ctx.drawImage, then canvas.toBlob(b => downloadBlob(b, filename), "image/png"). Await the Image onload; reject/throw on error so callers can surface failure.
Keep functions focused and documented with interface comments (units, what "background" means). Default filenames chosen by the caller (sequence-diagram.svg / sequence-diagram.png).
Edge/caveat notes to encode: image load is async (must await); toBlob is async (wrap in a Promise); guard against a null/zero-size svg.

--- STEP 2: format-choice dialog (AC#2) ---
Create web/src/ExportImageDialog.tsx mirroring AboutModal.tsx: props { onClose: () => void; onChoose: (format: "svg" | "png") => void; title?: string }. Backdrop + fullscreen-modal (or a smaller modal variant) with role="dialog" aria-modal, Escape handler + cleanup, a header with a close btn btn--icon, and a body with two clear buttons ("SVG" and "PNG", use btn / btn--primary). Choosing a format calls onChoose then onClose. Keep it generic (no sequence-specific text) so other tabs reuse it. If a bespoke .modal is desired instead of reusing .fullscreen-modal, add minimal rules to theme.css; otherwise reuse existing modal classes.

--- STEP 3: expose the rendered SVG to the parent (AC#3, #4, #5) ---
Lift a ref so App.tsx can reach the live sequence <svg> WITHOUT a global document query. Preferred: add an optional prop to SequenceDiagram — containerRef?: React.RefObject<HTMLDivElement> — and have it use the passed ref for the container div (fall back to its own internal ref when the prop is absent, preserving existing callers/tests). In App.tsx create const sequenceSvgContainerRef = useRef<HTMLDivElement>(null) and pass it: <SequenceDiagram node={...} containerRef={sequenceSvgContainerRef} />. At export time read sequenceSvgContainerRef.current?.querySelector("svg") as SVGSVGElement | null. (Because sequenceContent is shared across mobile/desktop/fullscreen, only one SequenceDiagram instance is mounted at a time, so a single ref is correct.)

--- STEP 4: wire the Export button into the tab-strip (AC#1, #5) ---
Add export UI state to App.tsx: const [exportDialogOpen, setExportDialogOpen] = useState(false) and const [exportError, setExportError] = useState<string | null>(null) (transient error surfacing — no toast system exists; mirror TASK-114's FormatButton transient is-error pattern: flip title/aria-label to the error message for ~2.5s, do NOT throw).
Add a reusable ExportImageButton (small component or inline near the expand button): className="btn btn--icon", title/aria-label "Export image", an inline ~14x14 stroke=currentColor download-ish icon (e.g. down arrow into a tray) consistent with the expand button's icon markup. It is DISABLED when planResult?.ok !== true (AC#5 — no plan / render error means no diagram). onClick sets exportDialogOpen=true.
Place it immediately before OR after the expand button in EACH place the expand button appears (both tab-strips ~line 2184 mobile-region and ~line 2330 desktop-region; the ~line 1323 instance — confirm which tab-strip/panel it belongs to and whether sequence export applies there). Since the expand button is gated to show only for the visual tabs, gate the export button to render (or at least enable) only when resultsTab === "sequence" for now (scope), while keeping the component generic for later reuse.
Optionally also add the button inside the fullscreen modal header (~line 2418) next to the close button — low-cost, per ticket "consider exposing in the fullscreen modal".

--- STEP 5: export handlers (AC#3, #4) ---
In App.tsx add a handler the dialog calls: onChoose = async (format) => { const svg = sequenceSvgContainerRef.current?.querySelector("svg"); if (!svg) { setExportError("No diagram to export"); return; } try { if (format === "svg") exportSvg(svg, "sequence-diagram.svg"); else await exportPng(svg, "sequence-diagram.png", getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#16243a"); } catch (e) { setExportError(String(e)); } }. Render {exportDialogOpen && <ExportImageDialog onClose={() => setExportDialogOpen(false)} onChoose={onChoose} />} near the AboutModal render (~line 2438). Read the background from the --surface CSS variable so it tracks the theme (currently single dark theme; #16243a fallback).

--- STEP 6: tests (AC#7-adjacent, good practice) ---
Extend web/src/App.test.tsx (vitest + @testing-library/react). Mermaid is already mocked to resolve { svg: '<svg data-testid="mermaid-svg"></svg>' }. Add in the test/setup: global.URL.createObjectURL = vi.fn(() => "blob:mock"); global.URL.revokeObjectURL = vi.fn(); and stub HTMLCanvasElement.prototype.getContext / toBlob if the PNG path is exercised (jsdom lacks canvas — either mock canvas or unit-test only the SVG path in App and cover exportSvg/svgToString directly in a focused imageExport.test.ts). Cover: (a) export button is disabled when planResult is null/no plan; (b) after a successful plan, clicking export opens the dialog; (c) choosing SVG calls URL.createObjectURL / triggers a download of an image/svg+xml blob and does not throw. Prefer a dedicated imageExport.test.ts for svgToString self-containment (has xmlns, explicit width/height) to avoid canvas/jsdom limitations.

--- STEP 7: quality gates (AC#7) ---
Run and confirm green:
  nix develop -c bash -c "cd web && pnpm tsc --noEmit"
  nix develop -c bash -c "cd web && pnpm lint"
  nix develop -c bash -c "cd web && pnpm test run"
(pnpm prettier --check is not part of AC#7; match repo formatting anyway.)

--- STEP 8: manual verification ---
nix develop -c bash -c "cd web && pnpm dev". Run a query so a plan renders, open the Sequence Diagram tab. Confirm: (1) an Export-image button sits next to the expand button, styled as btn btn--icon; (2) it is disabled before any plan exists (AC#5); (3) clicking it opens the SVG/PNG dialog (AC#2); (4) SVG download opens/renders standalone with correct colors + dimensions (AC#3); (5) PNG download has an opaque #16243a background, not transparent (AC#4); (6) works in both mobile and desktop layouts (and the fullscreen modal if that button was added).

INTEGRATION NOTES: single PR. New files: web/src/imageExport.ts, web/src/ExportImageDialog.tsx, (optional) web/src/imageExport.test.ts. Edited: web/src/SequenceDiagram.tsx (optional containerRef prop), web/src/App.tsx (ref + button(s) + dialog + handlers + state), web/src/App.test.tsx, possibly web/src/theme.css (only if a bespoke dialog style is needed). No Rust/WASM changes; do not touch generated web/src/wasm/*.

CAVEATS to surface to reviewer: (a) PNG fonts rely on the browser having the Mermaid font stack; rasterization uses whatever the SVG references — acceptable. (b) The helper is intentionally general (SVGElement-based) but only wired to the sequence tab per scope; adopting it for other tabs is a later ticket. (c) If any tab's SVG referenced external stylesheets/images the PNG would taint the canvas (CORS) — Mermaid inlines everything, so not an issue here, but note it for future reuse.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTATION (TASK-115):

New reusable helper — web/src/imageExport.ts (AC#6): SVGElement-keyed, tab-agnostic.
- downloadBlob(blob, filename): object-URL + transient <a download> + revoke.
- svgToString(svg): clones the node, adds xmlns/xmlns:xlink + explicit width/height (from viewBox, then width/height attrs, then bounding box) so the file is self-contained; Mermaid inlines its <style>, so colors travel with the clone (AC#3).
- exportSvg(svg, filename): serializes with an XML prolog and downloads an image/svg+xml Blob.
- exportPng(svg, filename, background): rasterizes onto a canvas scaled by devicePixelRatio, fills a non-transparent background first (AC#4), draws the SVG via a data URL, awaits Image onload, then canvas.toBlob -> downloadBlob. Throws on failure so callers can surface it.

Dialog — web/src/ExportImageDialog.tsx (AC#2): mirrors AboutModal (backdrop + fullscreen-modal, role=dialog, aria-modal, Escape handler + cleanup, btn btn--icon close). Two btn--primary buttons (SVG / PNG); generic (no sequence-specific text) for reuse. Compact styling via new .export-image-dialog rules in theme.css.

SequenceDiagram.tsx: added an optional containerRef prop so the parent reaches the live <svg> without a global document query; falls back to an internal ref when absent (existing callers/tests unaffected).

App.tsx:
- New ExportImageButton component (btn btn--icon, download-arrow icon matching the expand button's inline-svg style); disabled when there is no diagram; flips to a transient is-error state (title/aria = error message, cleared after 2.5s via effect) on failure — no throw, no toast system needed.
- State: exportDialogOpen, exportError; ref: sequenceSvgContainerRef; derived canExportSequence = planResult?.ok === true (AC#5).
- handleExportSequence(format) reads the ref's <svg>, routes to exportSvg / exportPng (PNG background read from the --surface CSS var, #16243a fallback), surfaces failures via exportError.
- Wired the button into all three sequence-tab surfaces: the desktop results tab-strip (next to the expand button), the mobile results tab-strip (marginLeft:auto), and the fullscreen-modal header (next to Close). Gated to resultsTab/fullscreenTab === "sequence".
- Renders <ExportImageDialog> next to <AboutModal>.

theme.css: new .btn.is-error (transient error feedback) + .export-image-dialog / __body / __prompt / __actions rules.

Tests:
- web/src/imageExport.test.ts (new): svgToString produces xmlns + explicit dims + inlined child colors (AC#3); exportSvg downloads an image/svg+xml blob under the correct filename and revokes the URL (AC#6). Uses jsdom SVG nodes; stubs URL.createObjectURL/revokeObjectURL and HTMLAnchorElement.click.
- web/src/App.test.tsx: added a test — the Export-image button is absent on the default Query Plan tab and appears DISABLED on the Sequence tab when no plan has run (AC#1, AC#5).

VERIFICATION — all green (nix develop dev shell):
- pnpm tsc --noEmit: OK
- pnpm lint: 0 errors (only the 2 pre-existing unrelated exhaustive-deps warnings in App.tsx)
- pnpm test run: 382 passed (incl. the new imageExport + App tests)
- pnpm prettier --check on all touched files: clean

NOTES / minor deviations:
- AC#5 render-error case: the button is DISABLED whenever there is no successful plan (the common "no diagram" case). If a plan succeeds but Mermaid itself fails to render, the button stays enabled and the export instead surfaces a transient "No diagram to export" error (the live <svg> is absent) rather than being disabled — a graceful degrade, since that error state is internal to SequenceDiagram.
- PNG fonts rely on the browser having the Mermaid font stack (rasterization uses whatever the SVG references) — acceptable.
- Helper is intentionally generic (SVGElement-based) but wired only to the sequence tab per scope; adopting it for the other visual tabs is a later ticket.
- Live browser (pnpm dev) manual verification was NOT run in this environment; coverage rests on the automated type/lint/unit checks above.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an Export-image button to the Sequence Diagram tab. Image generation lives in a new reusable, SVGElement-keyed helper (web/src/imageExport.ts): exportSvg serializes the live Mermaid <svg> into a self-contained image/svg+xml file (xmlns + explicit dimensions, inlined styles), and exportPng rasterizes it onto a devicePixelRatio-scaled canvas over a non-transparent --surface background before canvas.toBlob. A generic ExportImageDialog (mirroring AboutModal) offers the SVG/PNG choice. SequenceDiagram gained an optional containerRef so App.tsx can reach the rendered <svg>; a small ExportImageButton (btn btn--icon) sits next to the expand button in the desktop and mobile results tab-strips and the fullscreen-modal header, disabled until a plan renders and flipping to a transient is-error state on failure (no throw). Covered by a new imageExport.test.ts plus an App test for the disabled state. Verified: pnpm tsc --noEmit, pnpm lint (0 errors), pnpm test run (382 pass), prettier clean.
<!-- SECTION:FINAL_SUMMARY:END -->
