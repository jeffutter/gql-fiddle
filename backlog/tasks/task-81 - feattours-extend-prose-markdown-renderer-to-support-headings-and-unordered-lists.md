---
id: TASK-81
title: >-
  feat(tours): extend prose markdown renderer to support headings and unordered
  lists
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-23 19:03'
updated_date: '2026-06-23 19:56'
labels:
  - feat
  - tours
  - web
  - planned
dependencies: []
modified_files:
  - web/src/TourPlayback.tsx
  - web/src/theme.css
  - web/src/TourPlayback.test.tsx
priority: low
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `renderMarkdown` function in `TourPlayback.tsx` handles paragraphs, bold, italic, inline code, links, and soft line breaks — but `#`/`##`/`###` headings and `- ` bullet lists are not recognised and render as literal text inside `<p>` tags.

## Implementation

All changes are in the `renderMarkdown` function in `web/src/TourPlayback.tsx` (around line 51).

The function currently splits on `\n\n+` and wraps every chunk in `<p>`. Add two checks per chunk **before** the inline-transforms / `<p>` fallback:

### Headings

A chunk whose first (and only significant) line starts with `#` is a heading:

```ts
const headingMatch = para.match(/^(#{1,3})\s+(.+)/s);
if (headingMatch) {
  const level = headingMatch[1].length;        // 1, 2, or 3
  const text = applyInline(headingMatch[2]);   // bold/italic/code still work inside headings
  return `<h${level}>${text}</h${level}>`;
}
```

Extract the existing inline transforms into a small helper `applyInline(text)` so they can be reused for heading content without duplicating code.

### Unordered lists

A chunk where every non-empty line starts with `- ` or `* ` is a list:

```ts
const lines = para.split(/\n/);
if (lines.every(l => /^[-*]\s/.test(l) || l.trim() === "")) {
  const items = lines
    .filter(l => /^[-*]\s/.test(l))
    .map(l => `<li>${applyInline(l.replace(/^[-*]\s/, ""))}</li>`)
    .join("");
  return `<ul>${items}</ul>`;
}
```

### CSS

Add minimal styles for `h1`/`h2`/`h3` and `ul`/`li` inside `.tour-playback__prose-content` so headings use readable sizes and lists have proper indent. Keep it simple — no resets beyond what the prose panel already applies.

## Out of scope

Ordered lists, blockquotes, fenced code blocks, and nested lists are not part of this ticket. The custom renderer exists to avoid a markdown dependency; if the set of needed features grows significantly, a follow-up ticket should evaluate adopting a small library (e.g. `marked`) instead of extending the hand-rolled renderer further.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 # Heading, ## Heading, and ### Heading render as h1/h2/h3 in the playback prose panel
- [x] #2 Bold, italic, and inline code still work inside heading text
- [x] #3 A paragraph where every line starts with '- ' or '* ' renders as a <ul> with <li> items
- [x] #4 Inline formatting (bold, italic, code) works inside list items
- [x] #5 Existing paragraph, bold, italic, link, and inline-code rendering is unchanged
- [x] #6 The authoring panel prose textarea is unaffected (plain text input stays as-is)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Overview

Extend the `renderMarkdown` function in `web/src/TourPlayback.tsx` to support `#`/`##`/`###` headings and `- `/`* ` unordered lists. All changes are self-contained in that one file plus a small CSS addition in `web/src/theme.css`. No sub-tickets are needed — this is a focused, single-session change.

## Implementation Steps

### 1. Extract `applyInline` helper (TourPlayback.tsx ~line 51)

Before the existing `renderMarkdown` function, extract the inline-transform chain into a named helper so headings and list items can reuse it without duplication:

```ts
function applyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
```

Note: the `\n → <br>` replacement is NOT moved into `applyInline` — it only applies to paragraph text, not to headings or list items.

### 2. Update `renderMarkdown` to use `applyInline` and add block handlers

Replace the existing `.map((para) => { … })` body with three sequential checks:

```ts
function renderMarkdown(prose: string): string {
  if (!prose) return "";
  return prose
    .split(/\n\n+/)
    .map((para) => {
      // — Headings: first line starts with #, ##, or ###
      const headingMatch = para.match(/^(#{1,3})\s+(.+)/s);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = applyInline(headingMatch[2].trim());
        return `<h${level}>${text}</h${level}>`;
      }

      // — Unordered lists: every non-empty line starts with "- " or "* "
      const lines = para.split(/\n/);
      if (lines.every(l => /^[-*]\s/.test(l) || l.trim() === "")) {
        const items = lines
          .filter(l => /^[-*]\s/.test(l))
          .map(l => `<li>${applyInline(l.replace(/^[-*]\s/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      // — Paragraph fallback (unchanged behaviour)
      const inner = applyInline(para).replace(/\n/g, "<br>");
      return `<p>${inner}</p>`;
    })
    .join("");
}
```

### 3. Add CSS for headings and lists (theme.css ~line 1347)

After the existing `.tour-playback__prose-content code { … }` block, add:

```css
.tour-playback__prose-content h1,
.tour-playback__prose-content h2,
.tour-playback__prose-content h3 {
  margin: 0 0 0.5em;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
}
.tour-playback__prose-content h1 { font-size: 1.3em; }
.tour-playback__prose-content h2 { font-size: 1.15em; }
.tour-playback__prose-content h3 { font-size: 1em; }

.tour-playback__prose-content ul {
  margin: 0 0 0.75em;
  padding-left: 1.4em;
  list-style: disc;
}
.tour-playback__prose-content ul:last-child {
  margin-bottom: 0;
}
.tour-playback__prose-content li {
  margin-bottom: 0.25em;
}
```

### 4. Add/extend tests (TourPlayback.test.tsx)

Add a `describe("renderMarkdown extensions (TASK-81)")` block inside the top-level `describe("TourPlayback")`. Use a tour fixture with prose containing headings and bullet lists. Test via `container.querySelector` on the rendered `.tour-playback__prose-content`:

- AC#1: `# Heading` renders an `<h1>` containing the heading text
- AC#1: `## Heading` renders `<h2>`, `### Heading` renders `<h3>`
- AC#2: Bold inside a heading (`# **Bold** title`) renders `<h1>` containing `<strong>`
- AC#3: A paragraph of `- item` lines renders a `<ul>` with `<li>` children
- AC#4: Inline code inside a list item (`- Use \`foo\``) renders `<li>` containing `<code>`
- AC#5: An existing paragraph with bold still renders as `<p>` containing `<strong>` (regression guard)

### 5. Verify

Run `pnpm test` in `/home/jeffutter/src/gql-fiddle/web` — all existing tests must pass, new tests must pass. No changes are needed outside `TourPlayback.tsx` and `theme.css`.

## Files to Modify

- `web/src/TourPlayback.tsx` — extract `applyInline`, update `renderMarkdown`
- `web/src/theme.css` — add heading and list styles inside `.tour-playback__prose-content`
- `web/src/TourPlayback.test.tsx` — add TASK-81 test block

## Out of Scope

Ordered lists, blockquotes, fenced code blocks, nested lists. If the hand-rolled renderer needs more features after this, evaluate adopting `marked` instead.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete. Extracted inline transform chain into `applyInline()` helper function before `renderMarkdown`. Added heading support (h1/h2/h3) and unordered list support (- and * bullets) to renderMarkdown. Added CSS styles for headings and lists inside .tour-playback__prose-content. Added 8 new tests in TourPlayback.test.tsx under describe('renderMarkdown extensions (TASK-81)'). All 318 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended the `renderMarkdown` function in `web/src/TourPlayback.tsx` to support headings (h1/h2/h3 via `#`/`##`/`###`) and unordered lists (`-`/`*` bullet lines). Extracted the inline transform chain into a shared `applyInline()` helper so headings and list items reuse bold/italic/code/link rendering without duplication. Added CSS rules for headings and lists inside `.tour-playback__prose-content` in `theme.css`. Added 8 new tests covering all 6 acceptance criteria in a `describe("renderMarkdown extensions (TASK-81)")` block. All 318 tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
