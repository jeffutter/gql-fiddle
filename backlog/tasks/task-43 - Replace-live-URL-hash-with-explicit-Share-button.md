---
id: TASK-43
title: Replace live URL hash with explicit Share button
status: Done
assignee:
  - developer
created_date: '2026-06-12 20:29'
updated_date: '2026-06-13 16:25'
labels:
  - ux
  - sharing
  - url
dependencies: []
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently the workspace is continuously serialised into `location.hash` via a debounced effect (`App.tsx` ~line 134–150). This clutters the browser history, makes URLs unwieldy to copy, and encodes transient state the user never asked to share.

**Goal**
- Remove the debounced effect that keeps rewriting `location.hash` as the workspace changes.
- Keep the on-mount restore: a URL with a `#w=…` hash should still hydrate the workspace exactly as it does today.
- After restoring from a hash, strip the hash from the URL (use `history.replaceState`) so the address bar stays clean for the rest of the session.
- Add a **Share** button that, when clicked, serialises the workspace at that point in time, writes `window.location.href` (with the `#w=…` hash) to the clipboard, and shows a brief "Copied!" confirmation — same feedback pattern as the existing copy button.

The `encode`/`decode` helpers in `share.ts` remain unchanged; only the call-sites in `App.tsx` change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The URL hash is NOT updated automatically as the user edits subgraphs, queries, variables, or seed.
- [x] #2 Navigating to a URL containing a `#w=…` hash hydrates the workspace correctly (existing behaviour preserved).
- [x] #3 After hydrating from a hash, the hash is removed from the address bar without adding a browser history entry.
- [x] #4 A Share button is visible in the UI and generates a point-in-time shareable URL with the current workspace encoded as `#w=…`.
- [x] #5 Clicking Share copies the full URL (including hash) to the clipboard.
- [x] #6 Clicking Share shows a brief 'Copied!' confirmation, consistent with the existing copy-result button.
- [x] #7 All existing share round-trip and URL tests continue to pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Files to modify

| File | Changes |
|------|---------|
| `web/src/App.tsx` | Remove debounced hash-update effect; merge `history.replaceState` into mount restore effect; add Share button and `copyShareUrl()` handler |
| `web/src/App.test.tsx` | Delete 2 tests; add 3 new tests (negative hash test, replaceState spy, Share clipboard mock) |

## Step-by-step implementation order (TDD)

### Phase 1: Write new tests FIRST (before touching App.tsx)

**Test 1 — Negative: no auto hash update on edit**
- Render `<App />`, advance timers past initial debounce.
- Edit subgraph SDL via `setSubgraphSdl`.
- Assert `location.hash` does NOT change (stays at the initial hash).
- Validates AC#1.

**Test 2 — Hash stripped after restore via `history.replaceState`**
- ⚠️ **JSDOM gotcha**: `window.history.replaceState` is not configurable in JSDOM, so `vi.spyOn()` throws. Workaround: `(window.history as any).replaceState = vi.fn()` in `beforeEach`, restore in `afterEach`.
- Set `location.hash` to an encoded payload.
- Render `<App />`, assert workspace state restored.
- Assert `replaceState` was called (confirms AC#3).

**Test 3 — Share button copies URL and shows feedback**
- ⚠️ **JSDOM gotcha**: `navigator.clipboard` is undefined in JSDOM. Workaround: `Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })`.
- Render `<App />`, find Share button by text content ("Share").
- Click it. Assert `writeText` was called with a URL containing `#w=`.
- Assert button text changes to "Copied!" then reverts after 1500ms via fake timers.

### Phase 2: Modify `App.tsx`

**2a. Remove the debounced hash-update effect (lines 134-147)**
Delete the `useEffect` block watching `[subgraphs, queryTabs, activeQueryTab, seed]`. Also delete the `hashUpdateRef` declaration at line ~104.

**2b. Merge `history.replaceState` into the existing restore effect (lines 115-133)**
After the `useWorkspace.setState(...)` call inside the try block, add:
```js
window.history.replaceState(null, "", window.location.pathname + window.location.search);
```
This strips the hash synchronously after hydration in the same effect. No new effect needed.

**2c. Add `copyShareUrl()` function**
Place it next to `copyForLLM()`. Pattern:
```ts
function copyShareUrl() {
  const payload: WorkspacePayload = {
    subgraphs,
    queryTabs,
    activeQueryTab,
    seed,
  };
  const encodedHash = encode(payload);
  const shareUrl = window.location.origin + window.location.pathname + encodedHash;

  if (navigator.clipboard) {
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  } else {
    const ta = document.createElement("textarea");
    ta.value = shareUrl;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
}
```
Reuses the existing `copied` state variable — no new state needed.

**2d. Add Share button in the header bar**
Insert between the "Copy for LLM" button and the "Reset to defaults" button (inside the flex container around line 319). Mirror the exact same inline styles as the Copy for LLM button, using `copied ? "Copied!" : "Share"` for the label text.

**2e. Delete the two TASK-23 tests in `App.test.tsx`**
Delete:
- `it("TASK-23 AC#2: editing subgraph SDL updates location.hash after 300ms debounce", ...)`
- `it("TASK-23 AC#2: rapid workspace edits only produce one hash update (debounce coalescing)", ...)`

### Phase 3: Verify all tests pass
Run `pnpm test run` to confirm green. The TASK-23 AC#3 hydrate test must still pass.

## Acceptance criterion mapping

| AC | How met |
|----|---------|
| #1 No auto hash update | Debounced effect removed, `hashUpdateRef` deleted |
| #2 Hydrate from hash preserved | Restore effect untouched except adding `replaceState` inside same body |
| #3 Hash stripped after restore | `window.history.replaceState(null, "", window.location.pathname + window.location.search)` called synchronously after `setState` |
| #4 Share button visible | Button added to header bar next to "Copy for LLM"; mirrors existing styling |
| #5 Copies full URL with hash | Constructs `origin + pathname + encode(payload)` and writes via `navigator.clipboard.writeText` |
| #6 Copied! feedback | Reuses existing `copied` state; toggles green text/border, reverts after 1500ms. Same as `copyForLLM` |
| #7 Existing tests pass | Only removed tests verify deleted behavior; hydrate test kept |

## Exact API calls (from research brief)

- **`history.replaceState(state: any, title: string, url?: string): void`** — strip hash after restore.
  Call: `window.history.replaceState(null, "", window.location.pathname + window.location.search)`

- **`navigator.clipboard.writeText(text: string): Promise<void>`** — copy share URL with fallback to `document.execCommand("copy")` for non-secure contexts.

- **`encode(payload: WorkspacePayload): string`** — from existing `./share.ts`, reused unchanged. Produces `#w=H4sI...` hash fragment.

## Risks and prerequisites

1. **Shared `copied` state**: Both "Copy for LLM" and "Share" buttons toggle the same `copied` state. Rapid clicks on both will briefly suppress feedback. Acceptable — no new state needed.

2. **`history.replaceState` on no-hash URLs**: The call is inside the try block of the restore effect, so it only runs when a `#w=` hash was present. Harmless but gated correctly.

3. **Mocking in tests**: Need `vi.spyOn(window.history, "replaceState")` before render. Existing test setup already redefines `globalThis.location`, so adding the history spy is straightforward.

4. **No new dependencies**. All APIs are native browser. The `encode`/`decode` helpers in `share.ts` are unchanged.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the debounced live URL hash with an explicit Share button. Removed the auto-updating `location.hash` effect from `App.tsx`, merged `history.replaceState` into the mount restore effect to strip the hash after hydration, and added a Share button that serializes the current workspace into a clipboard URL with point-in-time encoding. All 7 acceptance criteria verified: no auto-hash updates on edits, hash hydration preserved, hash stripped after restore via replaceState, Share button visible, copies full shareable URL, shows "Copied!" feedback for 1500ms, and all 79 existing tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
## Research Brief

# Research Brief: Replace live URL hash with explicit Share button (TASK-43)

## Summary
Remove the debounced `location.hash` auto-update effect, keep on-mount hash restore (with post-hydrate strip via `history.replaceState`), and add a Share button that serializes workspace → writes full URL with `#w=…` hash to clipboard → shows "Copied!" feedback. No new libraries needed — all APIs are native browser/Web platform.

## Findings

### 1. Remove the debounced hash-update effect
The current effect at `App.tsx` ~lines 134–150 watches `[subgraphs, queryTabs, activeQueryTab, seed]` and every 300ms writes `location.hash = encode(payload)`. **Delete this entire `useEffect` block** (the one using `hashUpdateRef`). Also delete the `hashUpdateRef` declaration and any references to it. The `COMPOSE_DEBOUNCE_MS` constant (300) is still used by the composition effect, so keep it.

**Test impact:** The test `"TASK-23 AC#2: editing subgraph SDL updates location.hash after 300ms debounce"` in `App.test.tsx` must be deleted — it tests behavior that no longer exists. The rapid-debounce coalescing test (`"TASK-23 AC#2: rapid workspace edits only produce one hash update"`) also tests the removed behavior and must be deleted.

### 2. On-mount restore + `history.replaceState` to strip hash
The existing mount-effect (lines ~122–135) already restores from `#w=…`. After restoring, add a second `useEffect([], [])` (or same effect after the restore block) that calls:

```js
window.history.replaceState(null, "", window.location.pathname + window.location.search);
```

**API signature — `history.replaceState`:**
```ts
history.replaceState(state: any, title: string, url?: string | URL | null): void;
```
- `state` — ignored here (`null`)
- `title` — ignored by all browsers (`""`)
- `url` — the new URL **without** the hash portion

**Why `replaceState` not `pushState`:** `replaceState` replaces the current history entry, so the back-button behavior is unaffected. The user never intentionally navigated to the hashed URL — it was auto-set by the app. Using `replaceState` prevents a phantom history entry from appearing when they hit Back.

**Gotcha:** Setting `location.hash = ""` alone does NOT strip the hash in all browsers (some retain `#`). Explicitly reconstructing the URL via `pathname + search` is the reliable approach. Also, `replaceState` must be called synchronously after hydration — not deferred — so that if the user refreshes mid-session they don't see a stale hash.

**React note:** Since this effect has no dependencies (`[]`), it fires once after mount. It should run *after* the restore logic (same effect body, sequential). No dependency-array warnings from `eslint-plugin-react-hooks`.

### 3. Share button — clipboard write + "Copied!" feedback
The Share button follows the same pattern as the existing `copyForLLM()` function but with a different payload: serialize the current workspace state → encode it as `#w=…` → construct full URL → write to clipboard.

**API signature — `navigator.clipboard.writeText`:**
```ts
navigator.clipboard.writeText(text: string): Promise<void>;
```
- Returns a `Promise<void>` that resolves on success, rejects on failure (e.g., permission denied, non-HTTPS context)
- Requires a user gesture (the button click satisfies this)
- Available in all modern browsers since ~March 2020 (Chrome 66+, Firefox 63+, Safari 14+)

**Fallback pattern (already implemented in `copyForLLM`):** Check `navigator.clipboard` first; if absent or the promise rejects, fall back to the legacy `document.execCommand("copy")` approach with a hidden `<textarea>`. This same fallback should be reused for Share.

**Constructing the full URL:**
```js
const payload: WorkspacePayload = {
  subgraphs: state.subgraphs,
  queryTabs: state.queryTabs,
  activeQueryTab: state.activeQueryTab,
  seed: state.seed,
};
const encodedHash = encode(payload); // e.g. "#w=H4sI..."
const shareUrl = window.location.origin + window.location.pathname + encodedHash;
```

**UI pattern:** Use the same `copied` state variable and visual feedback as `copyForLLM`: button text changes to "Copied!" in green (`#16a34a`) with a light-green border, then reverts after 1500ms via `setTimeout(() => setCopied(false), 1500)`.

**Button placement:** The task says "visible in the UI." The natural home is next to the existing "Copy for LLM" button in the subgraph header bar (the `<div>` with `marginLeft: "auto"` containing the two buttons). Add a third button between them.

### 4. No new dependencies required
All functionality uses native browser APIs (`history.replaceState`, `navigator.clipboard.writeText`, `location.origin`). The existing `encode`/`decode` in `share.ts` are reused unchanged. No npm packages to add.

### 5. Test considerations
- **Delete:** Two tests under `// ---- TASK-23 AC#2:` that verify the debounced hash-update behavior.
- **Keep & adjust:** The hydrate-from-hash test (`"TASK-23 AC#3: valid hash in location.hash restores..."`) should still pass — it tests restore, not auto-update. However, consider adding a check that `history.replaceState` was called if the test mocks it.
- **Add:** A test verifying that `location.hash` is NOT updated after editing (negative test).
- **Add:** A test for the Share button: clicking it copies the correct URL to clipboard and shows "Copied!" feedback. Mock `navigator.clipboard.writeText` in tests.
- **Mocking `history.replaceState`:** In Vitest, `window.history.replaceState` can be spied on with `vi.spyOn(window.history, "replaceState")`. The existing test setup already redefines `globalThis.location`, so adding the spy is straightforward.

### 6. Edge cases & gotchas
- **HTTPS requirement for clipboard API:** `navigator.clipboard.writeText` only works in secure contexts (HTTPS or localhost). The fallback (`execCommand`) handles non-secure contexts. Document this — no action needed beyond what `copyForLLM` already does.
- **Race condition on mount:** If the user navigates to a URL with `#w=…`, the restore effect runs synchronously during render (it's inside `useEffect`). The `replaceState` call must follow immediately in the same effect, not in a separate one, to avoid a flash of the hashed URL.
- **Tab closing:** If the user closes a tab that was active when they shared the URL, the restored `activeQueryTab` index may point beyond the current tab count. The existing restore code sets `activeQueryTab: payload.activeQueryTab ?? 0`, which could be an out-of-bounds index. This is pre-existing behavior — not in scope for this task.
- **Store persistence:** The Zustand store uses `persist` middleware with `name: "graphql-playground"`. This persists to localStorage independently of the hash mechanism. Removing the hash auto-update does NOT affect localStorage persistence.

## Sources

### Kept:
- [MDN — History.replaceState()](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState) — Authoritative API signature and behavior details for stripping URLs without history entries.
- [MDN — Clipboard API: writeText()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) — Browser support matrix, return type, and permission model.
- [web.dev — Unblocking clipboard access](https://web.dev/articles/async-clipboard) — Security context requirements (HTTPS) and best practices for user-gesture-driven clipboard writes.
- [Stack Overflow — Remove # Hash from URL in React](https://stackoverflow.com/questions/71267720/remove-hash-from-url-in-react-with-react-router) — Confirms `replaceState` with pathname+search as the correct pattern for hash stripping in SPAs.

### Dropped:
- React Router-specific answers (useNavigate, useLocation) — Not applicable; this project has no router dependency, uses raw `location.hash`.
- Third-party clipboard libraries (`react-copy-to-clipboard`, `use-clipboard-copy`) — Unnecessary; the native API + fallback is already implemented in `copyForLLM` and sufficient.

## Gaps
- **Visual design for Share button:** The task says "visible in the UI" but doesn't specify exact styling or position beyond being next to existing buttons. The developer should mirror the style of "Copy for LLM" (12px font, bordered, transparent background) for consistency.
- **e2e / Playwright tests:** The project has a `__monaco` test harness exposed in dev mode. It's unclear if there are existing e2e tests for share functionality. If so, they'll need updating to mock clipboard and verify the Share button instead of hash auto-update.

## Research Brief

# Research Brief: Replace live URL hash with explicit Share button

## Summary
The task is straightforward — remove a debounced `location.hash` updater, add `history.replaceState` to strip the hash after on-mount hydration, and wire up a Share button using `navigator.clipboard.writeText`. All APIs are native browser; no new dependencies. The implementation plan's approach is sound with one important testing gotcha around mocking `window.history.replaceState` in Vitest/JSDOM (see Risks below).

## Findings

1. **`history.replaceState` for hash stripping — confirmed correct**
   Calling `window.history.replaceState(null, "", window.location.pathname + window.location.search)` replaces the current history entry with a URL that has no fragment. This is the standard pattern and does NOT add to browser history. The URL argument must be same-origin (it is — built from pathname + search of the current page), so no cross-origin restriction applies. [Source](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState)

2. **Clipboard API — secure context requirement**
   `navigator.clipboard.writeText(text)` only works in secure contexts (HTTPS or `localhost`). In non-secure contexts, `navigator.clipboard` is `undefined`. The existing `copyForLLM()` already implements the correct fallback: a hidden `<textarea>` + `document.execCommand("copy")`. The Share button should reuse this exact same dual-path pattern. [Source](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)

3. **Vitest/JSDOM: `window.history.replaceState` is NOT configurable**
   In JSDOM environments, `window.history.replaceState` is a non-configurable property — `vi.spyOn(window.history, "replaceState")` will throw `"cannot redefine property"`. The workaround is to assign directly in `beforeEach`:
   ```ts
   (window.history as any).replaceState = vi.fn();
   ```
   Then restore with:
   ```ts
   afterEach(() => { delete (window.history as any).replaceState; });
   ```
   This has been confirmed by the Vitest community. [Source](https://github.com/vitest-dev/vitest/discussions/2213)

4. **Vitest/JSDOM: `navigator.clipboard` is undefined**
   JSDOM does not implement `navigator.clipboard`. Tests must mock it via `Object.defineProperty`:
   ```ts
   Object.defineProperty(navigator, "clipboard", {
     value: { writeText: vi.fn().mockResolvedValue(undefined) },
     configurable: true,
   });
   ```
   This is the standard approach and works reliably in Vitest. [Source](https://stackoverflow.com/questions/62351935/how-to-mock-navigator.clipboard-writetext-in-jest)

5. **Existing `share.ts` uses pako (gzip) + URL-safe base64 — not LZ-String**
   The task description mentions LZ-String, but the actual implementation in `share.ts` uses `pako.gzip()` for compression and a custom `uint8ToBase64url()` encoder. This is functionally equivalent for the purpose of this task — the `encode()`/`decode()` helpers are unchanged, so no impact on implementation. [Source](https://github.com/pieroxy/lz-string) vs actual code in `/home/jeffutter/src/graphql-playground/web/src/share.ts`

6. **Shared `copied` state — confirmed acceptable**
   Both "Copy for LLM" and the new "Share" button toggle the same `copied` boolean state (line 91 of App.tsx). If a user clicks both buttons rapidly, only one will show "Copied!" at a time. This is fine because: (a) the 1500ms window is short, (b) these are two separate user intents that rarely fire simultaneously, and (c) adding a second state (`copiedShare`) would be unnecessary complexity.

7. **Test pattern for "no hash update on edit" — straightforward**
   The existing test suite already redefines `globalThis.location` in `beforeEach`. The negative test simply needs to: (a) set a fixed initial hash, (b) trigger an edit via `setSubgraphSdl`, (c) advance timers past debounce, (d) assert `location.hash` equals the initial value. This is the inverse of the existing TASK-23 test that's being deleted. [Source](/home/jeffutter/src/graphql-playground/web/src/App.test.tsx) lines 150-179

8. **Test pattern for Share button — fake timers needed**
   The "Copied!" feedback uses `setTimeout(() => setCopied(false), 1500)`. Tests must use `vi.useFakeTimers()` and `await vi.advanceTimersByTimeAsync(1500)` to verify the text reverts. This pattern is already used in many existing tests (e.g., the validation debounce tests).

## Sources
- **Kept:** MDN — `History.replaceState` (https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState) — authoritative API docs, confirms same-origin requirement and no-history-add behavior.
- **Kept:** MDN — `Clipboard.writeText` (https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) — secure context requirements, fallback pattern.
- **Kept:** Vitest discussion #2213 (https://github.com/vitest-dev/vitest/discussions/2213) — confirms `window.history` is not configurable in JSDOM; direct assignment workaround.
- **Kept:** Stack Overflow — mock clipboard writeText (https://stackoverflow.com/questions/62351935/how-to-mock-navigator.clipboard-writetext-in-jest) — `Object.defineProperty` pattern for JSDOM.
- **Kept:** Gist — Vitest/JSDOM window.location & history mocking (https://gist.github.com/tkrotoff/52f4a29e919445d6e97f9a9e44ada449) — comprehensive mock patterns, confirms `replaceState` behavior.
- **Kept:** pieroxy/lz-string (https://github.com/pieroxy/lz-string) — referenced for context but not used; actual codebase uses pako.gzip + base64url.

## Gaps
- **None identified.** The implementation plan is comprehensive and the research confirms all approaches are sound. The only non-obvious item is the Vitest/JSDOM mocking limitation for `window.history.replaceState`, which has a confirmed workaround.

<!-- SECTION:NOTES:END -->
