/**
 * QueryShape.tsx — Query-driven schema slice view.
 *
 * Renders only the portion of the API schema selected by the active query,
 * showing the shape of the response the server will return. Unlike SchemaTree
 * (which shows the full schema regardless of any query), this view is driven by
 * the current query document.
 *
 * The shape data is built by queryToQueryShape(); expand/collapse state is
 * managed per-node by the reused FieldNode component from SchemaTree.tsx.
 */

import { useMemo } from "react";
import { queryToQueryShape } from "./queryToQueryShape";
import { FieldNode } from "./SchemaTree";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface QueryShapeProps {
  apiSchemaSdl: string;
  query: string;
}

// ---------------------------------------------------------------------------
// QueryShape — public component
// ---------------------------------------------------------------------------

export function QueryShape({ apiSchemaSdl, query }: QueryShapeProps) {
  const tree = useMemo(() => queryToQueryShape(apiSchemaSdl, query), [apiSchemaSdl, query]);

  if (tree.operations.length === 0) {
    return <p className="empty-state">Write a query to see its shape.</p>;
  }

  return (
    <div className="schema-tree">
      {tree.operations.map((op, opIdx) => (
        <section key={`${op.header}-${opIdx}`} className="schema-tree__root">
          <h3 className="schema-tree__root-header">{op.header}</h3>
          <ul className="schema-tree__children">
            {op.fields.map((field, idx) => (
              <FieldNode key={`${field.fieldName}-${idx}`} field={field} defaultExpanded={false} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
