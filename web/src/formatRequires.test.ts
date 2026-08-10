import { describe, expect, it } from "vitest";
import { formatRequiresSelections } from "./formatRequires";
import type { RequiresSelection } from "./core/types";

describe("formatRequiresSelections", () => {
  it("flat fields — space-separated", () => {
    const sels: RequiresSelection[] = [
      { kind: "Field", name: "__typename" },
      { kind: "Field", name: "id" },
    ];
    expect(formatRequiresSelections(sels)).toBe("__typename id");
  });

  it("nested field — renders child selection set in braces", () => {
    const sels: RequiresSelection[] = [
      {
        kind: "Field",
        name: "reviews",
        selections: [{ kind: "Field", name: "id" }],
      },
    ];
    expect(formatRequiresSelections(sels)).toBe("reviews { id }");
  });

  it("aliased field — renders as alias: name", () => {
    const sels: RequiresSelection[] = [{ kind: "Field", name: "id", alias: "productId" }];
    expect(formatRequiresSelections(sels)).toBe("productId: id");
  });

  it("inline fragment with type condition", () => {
    const sels: RequiresSelection[] = [
      {
        kind: "InlineFragment",
        typeCondition: "Product",
        selections: [{ kind: "Field", name: "upc" }],
      },
    ];
    expect(formatRequiresSelections(sels)).toBe("... on Product { upc }");
  });

  it("inline fragment without type condition — renders bare ...", () => {
    const sels: RequiresSelection[] = [
      { kind: "InlineFragment", selections: [{ kind: "Field", name: "upc" }] },
    ];
    expect(formatRequiresSelections(sels)).toBe("... { upc }");
  });
});
