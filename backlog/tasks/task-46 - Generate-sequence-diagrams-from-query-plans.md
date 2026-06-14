---
id: TASK-46
title: Generate sequence diagrams from query plans
status: Done
assignee:
  - '@ralph'
created_date: '2026-06-12 21:00'
updated_date: '2026-06-14 13:00'
labels:
  - ux
  - visualization
  - query-plan
  - planned
dependencies:
  - TASK-45
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Query Plan tab currently shows a tree view (`PlanTree.tsx`). A sequence diagram would better communicate the *ordering* and *data flow* between subgraphs — particularly which service is called first, which calls are parallel, and what key fields are passed between them for entity resolution.

**What the diagram should show**

- **Participants**: the client/router plus each subgraph `service` that appears in a `Fetch` node.
- **Arrows**: one arrow per `Fetch`, directed from the router to the target service, in the order dictated by `Sequence`/`Parallel` structure.
- **Parallel blocks**: `Parallel` nodes should be grouped visually (e.g. Mermaid `par` blocks) to show concurrent fetches.
- **Fetch labels**: include the top-level selection(s) from `operation` (not the full query — just enough to identify what's being fetched, e.g. `query { users { ... } }`).
- **Join annotations**: when a `Fetch` has a non-empty `requires` field, annotate the arrow or add a note showing the key fields being passed (e.g. `requires: { __typename, id }`). These are the `@key` fields used for entity joins.
- **Flatten context**: when a `Fetch` is wrapped in a `Flatten`, include the `path` (e.g. `@ users.@`) as a note to indicate which type the entity resolution is stitching into.

**Rendering approach — open question**

Two options to evaluate before/during implementation:

1. **Mermaid** — walk the `PlanNode` tree and emit a Mermaid `sequenceDiagram` string; render it in the browser via the `mermaid` npm package. Pros: no SVG math, built-in styling. Cons: limited control over layout; `par` blocks in Mermaid can look cluttered for deeply nested parallel plans; adds ~200 KB to the bundle.

2. **Direct SVG** — compute participant columns and arrow rows from the plan tree, then emit SVG elements. Pros: full control, no extra dependency. Cons: significantly more implementation work (layout arithmetic, text measurement).

The implementer should prototype both and choose based on how cleanly `Parallel` nesting renders. A note on the decision should be left in the task.

**Where to surface it**

Add a "Sequence" tab alongside the existing "Query Plan" tab in the right-hand pane (top row), or replace/extend the existing tab. The tree view should remain available.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A sequence diagram is rendered for the current query plan whenever a plan is available.
- [x] #2 Each subgraph service that appears in a Fetch node is shown as a named participant.
- [x] #3 Arrows reflect the execution order imposed by Sequence and Parallel nodes; parallel fetches are visually grouped.
- [x] #4 Fetch arrows are labelled with the top-level selection name(s) from the operation string.
- [x] #5 When a Fetch has a non-empty `requires` array, the key fields are shown on or near the arrow (e.g. `requires: __typename, id`).
- [x] #6 When a Fetch is inside a Flatten, the flatten path is shown as a note or annotation.
- [x] #7 The existing tree view remains accessible (either as a separate tab or toggle).
- [x] #8 The diagram updates whenever the query plan changes.
- [x] #9 All existing tests continue to pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
SETUP (read first): This is a Rust+WebAssembly core (crates/gql-core) with a TypeScript/React web app (web/). ALL commands must run inside the Nix dev shell: either run 'direnv allow' once, or prefix every command with 'nix develop -c'. Work from the repository root unless told otherwise. Do not change pinned dependency versions.

## Rendering approach decision

Use **Mermaid** with dynamic import (lazy load on first Sequence tab activation). Rationale: the 7-variant `PlanNode` type and nested `par`/`end` blocks would require significant SVG layout arithmetic; Mermaid handles this automatically. Dynamic import (`const mermaid = await import("mermaid")`) keeps the ~200 KB out of the initial bundle. Record this decision in a code comment in `SequenceDiagram.tsx`.

## Files to create / modify

| File | Action |
|---|---|
| `web/src/planToMermaid.ts` | Create — pure PlanNode → Mermaid string function |
| `web/src/planToMermaid.test.ts` | Create — unit tests for the above |
| `web/src/SequenceDiagram.tsx` | Create — React wrapper that calls mermaid.render |
| `web/src/App.tsx` | Modify — add "Sequence Diagram" tab + render block |
| `web/src/App.test.tsx` | Modify — add Sequence tab tests; mock mermaid |

## Step 1 — Install Mermaid

```bash
nix develop -c bash -c "cd web && pnpm add mermaid"
```

Mermaid 11.x ships as ESM; Vite handles it natively. No extra plugin needed.

## Step 2 — Create `web/src/planToMermaid.ts`

Pure function — no React imports, fully unit-testable.

```ts
import type { PlanNode, RequiresSelection } from "./core/types";

/** Walk the tree and return all unique service names in encounter order. */
function collectParticipants(node: PlanNode, seen = new Set<string>(), out: string[] = []): string[] {
  switch (node.kind) {
    case "Fetch":
      if (!seen.has(node.service)) { seen.add(node.service); out.push(node.service); }
      break;
    case "Sequence":
    case "Parallel":
      node.nodes.forEach(n => collectParticipants(n, seen, out));
      break;
    case "Flatten":
      collectParticipants(node.node, seen, out);
      break;
    case "Subscription":
      collectParticipants(node.primary, seen, out);
      if (node.rest) collectParticipants(node.rest, seen, out);
      break;
    case "Defer":
      if (node.primary) collectParticipants(node.primary, seen, out);
      node.deferred.forEach(d => { if (d.node) collectParticipants(d.node, seen, out); });
      break;
    case "Condition":
      if (node.ifBranch) collectParticipants(node.ifBranch, seen, out);
      if (node.elseBranch) collectParticipants(node.elseBranch, seen, out);
      break;
  }
  return out;
}

/** Extract the first top-level field name from a GraphQL operation string. */
function topLevelSelection(operation: string): string {
  const m = operation.match(/\{\s*([_A-Za-z][_0-9A-Za-z]*)/);
  return m ? m[1] : "…";
}

/** Flatten RequiresSelection to a comma-separated list of field names. */
function formatRequires(requires: RequiresSelection[]): string {
  function fields(sel: RequiresSelection): string[] {
    if (sel.kind === "Field") {
      return [sel.alias ?? sel.name, ...(sel.selections ?? []).flatMap(fields)];
    }
    return (sel.selections ?? []).flatMap(fields);
  }
  return requires.flatMap(fields).join(", ");
}

/** Recursively emit Mermaid sequence lines for a PlanNode subtree. */
function emitLines(node: PlanNode, flattenPath?: string[]): string[] {
  switch (node.kind) {
    case "Fetch": {
      const label = topLevelSelection(node.operation);
      const lines: string[] = [`  Router->>${node.service}: ${label}`];
      if (flattenPath && flattenPath.length > 0) {
        lines.push(`  Note over Router,${node.service}: flatten @ ${flattenPath.join(".")}`);
      }
      if (node.requires && node.requires.length > 0) {
        lines.push(`  Note right of ${node.service}: requires: ${formatRequires(node.requires)}`);
      }
      return lines;
    }
    case "Sequence":
      return node.nodes.flatMap(n => emitLines(n));
    case "Parallel": {
      if (node.nodes.length === 0) return [];
      const [first, ...rest] = node.nodes;
      const out: string[] = ["  par", ...emitLines(first).map(l => "  " + l.trimStart() ? l : l)];
      for (const n of rest) {
        out.push("  and");
        out.push(...emitLines(n));
      }
      out.push("  end");
      return out;
    }
    case "Flatten":
      return emitLines(node.node, node.path);
    case "Subscription":
      return [...emitLines(node.primary), ...(node.rest ? emitLines(node.rest) : [])];
    case "Defer":
      return [
        ...(node.primary ? emitLines(node.primary) : []),
        ...node.deferred.flatMap(d => d.node ? emitLines(d.node) : []),
      ];
    case "Condition":
      return [
        ...(node.ifBranch ? emitLines(node.ifBranch) : []),
        ...(node.elseBranch ? emitLines(node.elseBranch) : []),
      ];
  }
}

/** Convert a PlanNode tree to a Mermaid sequenceDiagram definition string. */
export function planToMermaid(root: PlanNode): string {
  const participants = collectParticipants(root);
  const header = [
    "sequenceDiagram",
    "  participant Router",
    ...participants.map(s => `  participant ${s}`),
  ];
  return [...header, ...emitLines(root)].join("\n");
}
```

Key design choices to note in comments:
- `par` blocks require at least 2 branches in Mermaid; single-child Parallel emits the child directly (no `par/end` wrapper needed — adjust if Mermaid rejects single-branch `par`).
- `Flatten` path is forwarded as a note on its inner `Fetch` rather than a separate actor.

## Step 3 — Create `web/src/planToMermaid.test.ts`

Cover all 5 practically relevant variants. Use `describe("planToMermaid", ...)` and `it(...)` blocks:

1. **Single Fetch** — output contains `participant Router`, `participant users`, `Router->>users: me`.
2. **Sequence of two Fetches** — both arrows appear in order.
3. **Parallel two Fetches** — output contains `par`, `and`, `end`; both arrows present.
4. **Flatten wrapping Fetch** — output contains flatten path note on same line / nearby.
5. **Fetch with requires** — output contains `Note right of` line with field names.
6. **Nested: Sequence containing Parallel** — all arrows appear, `par`/`end` nested inside sequence.
7. **Participants deduplication** — same service in two Fetch nodes → only one `participant` declaration.

```bash
nix develop -c bash -c "cd web && pnpm test run src/planToMermaid.test.ts"
```

## Step 4 — Create `web/src/SequenceDiagram.tsx`

```tsx
import { useEffect, useRef, useState } from "react";
import type { PlanNode } from "./core/types";
import { planToMermaid } from "./planToMermaid";

// Rendering approach: Mermaid is dynamically imported on first render so the
// ~200 KB library stays out of the initial bundle. mermaid.initialize() is
// called once with startOnLoad:false; subsequent renders use mermaid.render().
let mermaidInitialized = false;

export function SequenceDiagram({ node }: { node: PlanNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idCounter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, theme: "default" });
          mermaidInitialized = true;
        }
        const definition = planToMermaid(node);
        const id = `seq-diagram-${idCounter.current++}`;
        const { svg } = await mermaid.render(id, definition);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [node]);

  if (error) {
    return (
      <div style={{ color: "#dc2626", fontSize: 13, padding: 8 }}>
        Failed to render sequence diagram: {error}
      </div>
    );
  }
  return <div ref={containerRef} style={{ overflow: "auto", padding: 8 }} />;
}
```

## Step 5 — Update `web/src/App.tsx`

**a. Extend the type and add state:**
```ts
// BEFORE:
const [rightTab, setRightTab] = useState<"sdl" | "plan">("plan");
// AFTER:
const [rightTab, setRightTab] = useState<"sdl" | "plan" | "sequence">("plan");
```

**b. Import the new component:**
```ts
import { SequenceDiagram } from "./SequenceDiagram";
```

**c. Add third tab button** in the right-pane `<nav>` (after the "Query Plan" button):
```tsx
<button
  onClick={() => setRightTab("sequence")}
  aria-pressed={rightTab === "sequence"}
  style={{
    backgroundColor: rightTab === "sequence" ? "#e5e7eb" : "transparent",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 13,
  }}
>
  Sequence Diagram
</button>
```

**d. Add render block** after the `{rightTab === "plan" && ...}` block:
```tsx
{rightTab === "sequence" && (
  <div style={{ flex: 1, overflow: "auto" }}>
    {planResult === null ? (
      <p style={{ fontSize: 13, color: "#6b7280" }}>Run a query to see the sequence diagram.</p>
    ) : planResult.ok ? (
      <SequenceDiagram node={planResult.query_plan} />
    ) : (
      <div style={{ backgroundColor: "#fee2e2", borderLeft: "3px solid #dc2626", padding: 8, borderRadius: 4 }}>
        {planResult.errors.map((e, i) => (
          <ErrorMessage key={i} text={e.message} />
        ))}
      </div>
    )}
  </div>
)}
```

## Step 6 — Update `web/src/App.test.tsx`

**a. Add Mermaid mock** at the top of the file (alongside other `vi.mock` calls):
```ts
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"></svg>' }),
  },
}));
```

**b. Add two new tests** inside `describe("App", ...)`:
```ts
it("Sequence Diagram tab button is visible in the right pane", () => {
  render(<App />);
  const seqTab = screen.getByRole("button", { name: /Sequence Diagram/ });
  expect(seqTab).toBeInTheDocument();
  expect(seqTab).toHaveAttribute("aria-pressed", "false");
});

it("clicking Sequence Diagram tab shows placeholder when no plan is available", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Sequence Diagram/ }));
  expect(screen.getByText(/Run a query to see the sequence diagram/)).toBeInTheDocument();
});
```

## Step 7 — Quality gates

```bash
nix develop -c bash -c "cd web && pnpm test run"
nix develop -c bash -c "cd web && pnpm tsc --noEmit && pnpm lint"
```

## Known gotchas

- **Mermaid in JSDOM**: Mermaid calls `document.createElement` and sets `innerHTML` internally. The `vi.mock("mermaid", ...)` in tests avoids all of this. `SequenceDiagram.tsx` tests only need to verify that the component renders without crashing (the mock `render` returns a static SVG string).
- **Single-branch Parallel**: Mermaid rejects a `par` block with fewer than 2 branches. If `node.nodes.length === 1`, emit the single child directly without a `par/end` wrapper.
- **Mermaid `render` ID uniqueness**: Mermaid requires unique IDs per `render()` call within a page session. The `idCounter` ref ensures this.
- **`mermaidInitialized` module-level flag**: Resets on HMR in dev, which is harmless (re-initializing is a no-op). Do not store this in React state — it would cause an extra render.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rendering decision: Mermaid with dynamic import. Direct SVG was ruled out due to the complexity of laying out 7 PlanNode variants including nested par/end for Parallel nodes.

planToMermaid.ts: pure function with helpers collectParticipants, topLevelSelection, formatRequires, emitLines. Single-child Parallel emits the child directly (no par/end wrapper) because Mermaid rejects par blocks with < 2 branches. Flatten path is forwarded as a Note on the inner Fetch.

SequenceDiagram.tsx: dynamic mermaid import, module-level mermaidInitialized flag, per-render unique ID via useRef counter, cancellation via boolean flag on useEffect cleanup.

App.tsx: rightTab extended to "sdl" | "plan" | "sequence"; "Sequence Diagram" tab button added after "Query Plan"; matching render block with same null/ok/error branching as the plan tab.

Tests: vi.mock("mermaid", ...) at top of App.test.tsx avoids JSDOM issues with Mermaid's browser APIs. 9 planToMermaid unit tests + 2 App integration tests. 100 total tests pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added sequence diagram rendering for the Query Plan tab. Created planToMermaid.ts (pure PlanNode→Mermaid string converter covering all 7 node variants), SequenceDiagram.tsx (React component with lazy Mermaid import, unique render IDs, cancellation, error boundary), and wired a third "Sequence Diagram" tab into App.tsx alongside the existing "Query Plan" and "Supergraph SDL" tabs. Added a vi.mock("mermaid", ...) to App.test.tsx to prevent JSDOM issues. All 9 ACs satisfied; 100 tests pass; pnpm tsc --noEmit and pnpm lint pass.
<!-- SECTION:FINAL_SUMMARY:END -->
