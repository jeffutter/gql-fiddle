---
id: TASK-81
title: >-
  feat(tours): extend prose markdown renderer to support headings and unordered
  lists
status: To Do
assignee: []
created_date: '2026-06-23 19:03'
labels:
  - feat
  - tours
  - web
dependencies: []
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
- [ ] #1 # Heading, ## Heading, and ### Heading render as h1/h2/h3 in the playback prose panel
- [ ] #2 Bold, italic, and inline code still work inside heading text
- [ ] #3 A paragraph where every line starts with '- ' or '* ' renders as a <ul> with <li> items
- [ ] #4 Inline formatting (bold, italic, code) works inside list items
- [ ] #5 Existing paragraph, bold, italic, link, and inline-code rendering is unchanged
- [ ] #6 The authoring panel prose textarea is unaffected (plain text input stays as-is)
<!-- AC:END -->
