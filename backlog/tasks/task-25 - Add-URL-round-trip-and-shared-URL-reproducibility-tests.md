---
id: TASK-25
title: Add URL round-trip and shared-URL reproducibility tests
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-06 20:20'
updated_date: '2026-06-12 17:57'
labels:
  - planned
milestone: m-4
dependencies:
  - TASK-23
  - TASK-39
documentation:
  - backlog/docs/doc-2 - GraphQL-Playground-Implementation-Plan.md
priority: low
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test that encoding then decoding a workspace returns the same data, and that the seed is passed through unchanged (the determinism guarantee end to end).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A round-trip test asserts decode(encode(w)) deep-equals w
- [x] #2 A corrupt-input test asserts the documented fallback behavior
- [x] #3 A wiring test confirms the restored seed is passed to executeMock
- [x] #4 nix develop -c bash -c "cd web && pnpm test run" passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

CURRENT STATE (as of 2026-06-12):
- AC#1 (round-trip): DONE — share.test.ts:18-22 has decode(encode(payload)) deep-equals original.
- AC#2 (corrupt-input fallback): DONE — share.test.ts:41-57 tests that decode throws on empty string, random base64, truncated gzip, and empty-after-prefix; App.test.tsx:1032-1045 "TASK-23 AC#4" verifies App falls back to defaults without crashing.
- AC#3 (wiring test): GAP — two halves exist separately ("TASK-23 AC#3" confirms seed restored to store from URL hash; "TASK-19 AC#2" confirms executeMock receives seed from store) but no single test chains URL hash → render → Run → executeMock receives the URL-restored seed.
- AC#4 (pnpm test run passes): 60/60 pass today.

ONLY REMAINING WORK: add one end-to-end wiring test to web/src/App.test.tsx.

1. Add a new test inside the existing `describe("App", ...)` block in web/src/App.test.tsx (after the last TASK-23 test, around line 1083):

   it("TASK-25 AC#3: seed restored from URL hash is passed to executeMock on Run", async () => {
     const { encode: encodeShare } = await import("./share");
     const urlSeed = 55;
     const payload = {
       subgraphs: [{ name: "products", sdl: "type Query { a: Int }" }],
       query: "query { a }",
       variables: "{}",
       seed: urlSeed,
     };
     Object.defineProperty(globalThis, "location", {
       value: { hash: encodeShare(payload) },
       writable: true,
       configurable: true,
     });
     // supergraphSdl must be non-null so the Run button is enabled.
     useWorkspace.setState({ supergraphSdl: "# supergraph" });
     mockExecuteMock.mockClear();
     mockExecuteMock.mockReturnValueOnce({ data: {}, errors: [] } as never);

     render(<App />);

     // App restores seed=55 from the URL hash on mount.
     expect(useWorkspace.getState().seed).toBe(urlSeed);

     // Click Run.
     const runButton = screen.getByRole("button", { name: /run/i });
     fireEvent.click(runButton);

     await vi.waitFor(() => expect(mockExecuteMock).toHaveBeenCalledTimes(1));

     // The fourth argument to executeMock must be the seed restored from the URL hash.
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
     const calledSeed = (mockExecuteMock.mock.calls[0] as any[])[3];
     expect(calledSeed).toBe(urlSeed);
   });

2. Run and confirm green:
   nix develop -c bash -c "cd web && pnpm test run"
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 and AC#2 were already satisfied by tests written during TASK-23/TASK-39: share.test.ts covers the round-trip and all corrupt-input throw cases; App.test.tsx "TASK-23 AC#4" covers the App-level fallback. AC#3 gap: added "TASK-25 AC#3" test to App.test.tsx (after line 1047) that encodes seed=55 into a URL hash, renders App (which restores seed=55 from hash on mount), clicks Run, and asserts executeMock's fourth argument equals 55. All 61 tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added one wiring test to web/src/App.test.tsx ("TASK-25 AC#3: seed restored from URL hash is passed to executeMock on Run"). AC#1 (round-trip) and AC#2 (corrupt-input fallback) were already covered by prior work in share.test.ts and App.test.tsx. The new test chains the two independently-proven halves — URL hash restore and executeMock seed forwarding — into a single end-to-end assertion. All 61 web tests pass.
<!-- SECTION:FINAL_SUMMARY:END -->
