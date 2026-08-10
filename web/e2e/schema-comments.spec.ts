// Browser-level E2E test: verifies that ArrowDown/ArrowUp step into a
// folded `#`-comment block instead of jumping over it. Comment blocks are
// rendered by collapsing their source lines to zero height (Monaco's
// `setHiddenAreas`, the same mechanism as code folding) and drawing a
// markdown view zone in their place — which means Monaco's own vertical
// cursor movement treats the block like a fold and skips it entirely
// unless we intercept ArrowDown/ArrowUp ourselves.
import { test, expect, type Page } from "@playwright/test";

async function setMonacoContent(page: Page, containerTestId: string, content: string) {
  await page.evaluate(
    ({ testId, value }) => {
      const monaco = (window as unknown as Record<string, unknown>).__monaco as {
        editor: {
          getEditors: () => Array<{
            getContainerDomNode: () => Element;
            setValue: (v: string) => void;
          }>;
        };
      };
      const container = document.querySelector(`[data-testid="${testId}"]`);
      const editor = monaco.editor
        .getEditors()
        .find((e) => container?.contains(e.getContainerDomNode()));
      editor?.setValue(value);
    },
    { testId: containerTestId, value: content },
  );
}

async function setCursorAndFocus(page: Page, containerTestId: string, lineNumber: number) {
  await page.evaluate(
    ({ testId, lineNumber }) => {
      const monaco = (window as unknown as Record<string, unknown>).__monaco as {
        editor: {
          getEditors: () => Array<{
            getContainerDomNode: () => Element;
            focus: () => void;
            setPosition: (pos: { lineNumber: number; column: number }) => void;
          }>;
        };
      };
      const container = document.querySelector(`[data-testid="${testId}"]`);
      const editor = monaco.editor
        .getEditors()
        .find((e) => container?.contains(e.getContainerDomNode()));
      editor?.focus();
      editor?.setPosition({ lineNumber, column: 1 });
    },
    { testId: containerTestId, lineNumber },
  );
}

async function getCursorLine(page: Page, containerTestId: string): Promise<number | null> {
  return page.evaluate((testId) => {
    const monaco = (window as unknown as Record<string, unknown>).__monaco as {
      editor: {
        getEditors: () => Array<{
          getContainerDomNode: () => Element;
          getPosition: () => { lineNumber: number } | null;
        }>;
      };
    };
    const container = document.querySelector(`[data-testid="${testId}"]`);
    const editor = monaco.editor
      .getEditors()
      .find((e) => container?.contains(e.getContainerDomNode()));
    return editor?.getPosition()?.lineNumber ?? null;
  }, containerTestId);
}

const SDL = [
  "type Query { me: String }",
  "# This is a comment",
  "# spanning two lines",
  "type Foo { bar: String }",
].join("\n");

test("ArrowDown/ArrowUp step into a folded comment block instead of skipping it", async ({
  page,
}) => {
  await page.goto("/");

  await page
    .locator('[data-testid="subgraph-editor"] .monaco-scrollable-element')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });

  await setMonacoContent(page, "subgraph-editor", SDL);

  // Wait for the comment block to render as a markdown widget (i.e. its
  // source lines are folded) before testing navigation into it.
  await expect(page.locator(".schema-comment-block")).toBeVisible();

  // Cursor on line 1, just above the folded block (lines 2-3) — ArrowDown
  // should land on line 2 (the block's first line), not skip to line 4.
  await setCursorAndFocus(page, "subgraph-editor", 1);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => getCursorLine(page, "subgraph-editor")).toBe(2);

  // Entering the block reveals its raw source for editing.
  await expect(page.locator(".schema-comment-block")).not.toBeVisible();

  // Move past the block (re-render collapses it again once the cursor
  // leaves), then approach from below: cursor on line 4, just under the
  // folded block — ArrowUp should land on line 3 (the block's last line).
  await setCursorAndFocus(page, "subgraph-editor", 4);
  await expect(page.locator(".schema-comment-block")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => getCursorLine(page, "subgraph-editor")).toBe(3);
});
