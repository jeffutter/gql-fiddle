---
id: TASK-56.3
title: 'feat(web): wire Entities tab into Output panel in App.tsx'
status: Done
assignee: []
created_date: '2026-06-16 19:22'
updated_date: '2026-06-16 19:27'
labels:
  - task
  - planned
dependencies:
  - TASK-56.1
  - TASK-56.2
references:
  - web/src/App.tsx
  - web/src/EntityOwnershipGraph.tsx
  - web/src/schemaToEntityGraph.ts
parent_task_id: TASK-56
priority: medium
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire the Entities tab into the Output panel in `App.tsx` and handle the composition-failure state. This is purely integration work — both `schemaToEntityGraph` and `EntityOwnershipGraph` are already built.

**Changes to App.tsx:**

1. Add `"entities"` to the `rightTab` union type:
   ```ts
   useState<"sdl" | "plan" | "sequence" | "timeline" | "entities" | "results">
   ```

2. Import `schemaToEntityGraph` and `EntityOwnershipGraph`.

3. Derive the entity graph from the compose result (memoize with `useMemo`):
   ```ts
   const entityGraph = useMemo(
     () => compose?.ok ? schemaToEntityGraph(compose.supergraph_sdl) : null,
     [compose]
   );
   ```

4. Add `entitiesContent` JSX:
   ```tsx
   const entitiesContent = (
     <div className="scroll">
       {entityGraph === null ? (
         <p className="empty-state">Compose a valid supergraph to see entity relationships.</p>
       ) : (
         <EntityOwnershipGraph graph={entityGraph} />
       )}
     </div>
   );
   ```

5. Add an "Entities" tab button to the Output panel `<nav className="tab-strip">` — in **both** the desktop section (line ~1011) and the mobile output section (line ~900). Place it between "Timeline" and "Supergraph SDL" for logical ordering.

6. Add `{rightTab === "entities" && entitiesContent}` to both the desktop and mobile render branches.

7. The `compositionErrorContent` path already shows an informational banner when composition fails — the entitiesContent `null` guard handles the disabled state. No extra disabled-button styling needed; just render `compositionErrorContent ?? (...)` as the other tabs do.

**No new state is needed beyond the `rightTab` extension.** The `useMemo` on `compose` is sufficient — `compose` is already updated by the debounced composition effect.
<!-- SECTION:DESCRIPTION:END -->
