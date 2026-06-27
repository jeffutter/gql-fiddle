/**
 * SchemaTree.tsx — Collapsible schema containment hierarchy tree.
 *
 * Renders the GraphQL schema as a nesting tree rooted at Query, Mutation, and
 * Subscription. Unlike the Type Graph tab (which shows type connectivity), this
 * view emphasizes depth and traversal paths — how fields nest inside each other.
 *
 * The tree data is pre-computed by the Rust compose() call and passed as the
 * `tree` prop. Expand/collapse state is managed per-node with useState inside
 * the recursive FieldNode component.
 */

import { useState } from "react";
import type { SchemaTreeField, SchemaTreeNode, SchemaTree } from "./core/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SchemaTreeProps {
  /** Pre-computed schema tree from the Rust compose() result. */
  tree: SchemaTree;
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

export interface FieldNodeProps {
  field: SchemaTreeField;
  /** Whether this node starts expanded (root-level fields default open). */
  defaultExpanded?: boolean;
}

export function FieldNode({ field, defaultExpanded = false }: FieldNodeProps) {
  const isExpandable = !field.isLeaf && !field.isCycleRef && field.children.length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Build the type annotation string, e.g. "[User]!" or "String?"
  function typeLabel(): string {
    const nullable = !field.isNonNull;
    const inner = field.isList ? `[${field.typeName}]` : field.typeName;
    return nullable ? `${inner}?` : `${inner}!`;
  }

  const isUnionMember = field.fieldName.startsWith("… on ");

  return (
    <li className="schema-tree__item">
      <div
        className={`schema-tree__row${isExpandable ? " schema-tree__row--expandable" : ""}`}
        onClick={isExpandable ? () => setExpanded((v) => !v) : undefined}
        role={isExpandable ? "button" : undefined}
        tabIndex={isExpandable ? 0 : undefined}
        onKeyDown={
          isExpandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
      >
        {isExpandable && (
          <span className="schema-tree__toggle" aria-hidden="true">
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {!isExpandable && <span className="schema-tree__toggle-placeholder" aria-hidden="true" />}

        <span
          className={[
            "schema-tree__field-name",
            isUnionMember ? "schema-tree__field-name--union-member" : "",
            field.isCycleRef ? "schema-tree__field-name--cycle" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {field.fieldName}
        </span>

        {!isUnionMember && (
          <>
            <span className="schema-tree__colon" aria-hidden="true">
              {": "}
            </span>
            <span
              className={[
                "schema-tree__type-name",
                field.isLeaf ? "schema-tree__type-name--leaf" : "",
                field.isCycleRef ? "schema-tree__type-name--cycle" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {field.isCycleRef ? `↑ ${field.typeName} (cycle)` : typeLabel()}
            </span>
          </>
        )}
      </div>

      {isExpandable && expanded && (
        <ul className="schema-tree__children">
          {field.children.map((child, idx) => (
            <FieldNode key={`${child.fieldName}-${idx}`} field={child} defaultExpanded={false} />
          ))}
        </ul>
      )}
    </li>
  );
}

interface RootNodeProps {
  node: SchemaTreeNode;
}

function RootNode({ node }: RootNodeProps) {
  return (
    <section className="schema-tree__root">
      <h3 className="schema-tree__root-header">{node.rootTypeName}</h3>
      <ul className="schema-tree__children">
        {node.fields.map((field, idx) => (
          <FieldNode key={`${field.fieldName}-${idx}`} field={field} defaultExpanded={true} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SchemaTree — public component
// ---------------------------------------------------------------------------

export function SchemaTree({ tree }: SchemaTreeProps) {
  if (tree.roots.length === 0) {
    return <p className="empty-state">Compose a valid supergraph to see the schema tree.</p>;
  }

  return (
    <div className="schema-tree">
      {tree.roots.map((root) => (
        <RootNode key={root.rootTypeName} node={root} />
      ))}
    </div>
  );
}
