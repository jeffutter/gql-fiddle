import type { RequiresSelection } from "./core/types";

/**
 * Render a `@requires` selection set as compact GraphQL selection-set syntax
 * (e.g. `id reviews { id } ... on Product { upc }`), preserving nesting and
 * type conditions instead of flattening everything to a field-name list.
 */
export function formatRequiresSelections(selections: RequiresSelection[]): string {
  return selections.map(formatSelection).join(" ");
}

function formatSelection(sel: RequiresSelection): string {
  const name =
    sel.kind === "Field"
      ? sel.alias
        ? `${sel.alias}: ${sel.name}`
        : sel.name
      : sel.typeCondition
        ? `... on ${sel.typeCondition}`
        : "...";
  if (!sel.selections || sel.selections.length === 0) return name;
  return `${name} { ${sel.selections.map(formatSelection).join(" ")} }`;
}
