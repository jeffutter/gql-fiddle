---
id: TASK-33
title: 'Fix: auto-generated subgraph names are not unique (duplicate React keys)'
status: Done
assignee:
  - developer
created_date: '2026-06-08 18:39'
updated_date: '2026-06-09 00:44'
labels:
  - review-followup
milestone: m-1
dependencies:
  - TASK-29
priority: high
ordinal: 110
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while reviewing TASK-29 (web/src/App.tsx:154 and web/src/store.ts:51). The [+] handler creates names with `subgraph-${subgraphs.length + 1}`, which is NOT unique after a removal. Example: start [products] -> add -> subgraph-2 -> add -> subgraph-3 -> close subgraph-2 -> now length 2 -> add -> subgraph-3 AGAIN (collision). This violates TASK-29 AC#1 ('a unique auto-generated name') and produces duplicate React keys at App.tsx:126 (key={sg.name}), which causes React reconciliation bugs (tabs render incorrectly). Axis: Correct.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Adding subgraphs repeatedly with interleaved removals never produces two subgraphs with the same name
- [x] #2 A new test in web/src/store.test.ts (or App.test.tsx) reproduces the add/remove/add sequence and asserts all subgraph names are distinct
- [x] #3 nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run" passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

1. Replace the [+] handler's name computation in web/src/App.tsx. At App.tsx:154 you will find: `addSubgraph(`subgraph-${subgraphs.length + 1}`)`. Replace it with a helper that finds the lowest integer N >= 1 such that ``subgraph-${N}`` does not appear in `subgraphs.map(s => s.name)`, then calls `addSubgraph` with that name. For example:

```ts
// Inside App(), before the return statement or as an inline helper
function nextSubgraphName(subgraphs: { name: string }[]): string {
  let n = 1;
  while (subgraphs.some(s => s.name === `subgraph-${n}`)) n++;
  return `subgraph-${n}`;
}
```

Then change the onClick to: `onClick={() => addSubgraph(nextSubgraphName(subgraphs))}`. Keep the helper small and inline or a local function — do not extract it into a separate module. This is only used in one place.

2. Leave `key={sg.name}` at App.tsx:126 as-is — it is correct once names are guaranteed unique by step 1. No other code needs to change.

3. Update existing test expectations. At App.test.tsx:398-404, the test "clicking [+] creates a new subgraph with auto-generated name and selects it (AC#1)" asserts the generated name is "subgraph-2". With the new algorithm, starting from [{name: "products"}], the first auto-generated name will be "subgraph-1" (since "products" does not match any `subgraph-N` pattern). Change line 398 comment and line 399's `toHaveBeenCalledWith("subgraph-2")` to `toHaveBeenCalledWith("subgraph-1")`, and line 404's `.toBe("subgraph-2")` to `.toBe("subgraph-1")`.

4. Add a new test for the collision scenario (AC#2). In web/src/App.test.tsx, add a test that drives the [+] button through the exact sequence described in the task description and asserts no duplicate names:

```ts
it("adding subgraphs with interleaved removals never produces duplicate names", () => {
    // Start with [{name: "products"}]
    render(<App />);
    const nav = document.querySelector("nav")!;

    // Add two subgraphs: produces subgraph-1, subgraph-2
    fireEvent.click(nav.querySelector("button:last-child")!);
    fireEvent.click(nav.querySelector("button:last-child")!);

    // Remove the middle one (subgraph-1 at index 1)
    const spans = nav.querySelectorAll("span");
    fireEvent.click(spans[1]);

    // Add again: should produce subgraph-1 (the gap), not subgraph-3
    fireEvent.click(nav.querySelector("button:last-child")!);

    const names = useWorkspace.getState().subgraphs.map(s => s.name);
    expect(new Set(names).size).toBe(names.length); // all unique
});
```

5. Run: `nix develop -c bash -c 'cd web && pnpm tsc --noEmit && pnpm lint && pnpm test run'`.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed duplicate React keys caused by non-unique auto-generated subgraph names. Replaced the naive `subgraph-${length + 1}` naming with a gap-finding algorithm that always picks the lowest unused integer N, reusing gaps from removed subgraphs. Updated existing test expectations and added a collision scenario test (add/remove/add sequence asserting all names distinct). All quality gates pass: Rust tests 15/15, clippy clean, fmt clean, web tests 34/34, tsc clean, eslint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
