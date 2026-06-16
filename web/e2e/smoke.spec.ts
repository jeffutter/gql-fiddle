import { test, expect, type Page } from "@playwright/test";

// SDL verified against the WASM compose() function (apollo-federation 2.15.0).
// Uses federation v2.3 with @join/v0.3 — the same pair used in wasm.rs tests.
const SUBGRAPH_USERS = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION) { query: Query } type Query { me: User } type User @key(fields: "id") { id: ID! name: String }`;

const SUBGRAPH_REVIEWS = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@external"]) @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION) { query: Query } type Query { mostRecentReview: Review } type Review { id: ID! body: String } extend type User @key(fields: "id") { id: ID! @external reviews: [Review] }`;

// Sets a Monaco editor's content via Monaco's own API (exposed on window.__monaco
// in dev mode). Falls back to scrollable-element click + Ctrl+A + type if needed.
async function setMonacoContent(page: Page, containerTestId: string, content: string) {
  const set = await page.evaluate(
    ({ testId, value }) => {
      const monaco = (window as unknown as Record<string, unknown>).__monaco as
        | {
            editor: {
              getEditors: () => Array<{
                getContainerDomNode: () => Element;
                setValue: (v: string) => void;
              }>;
            };
          }
        | undefined;
      if (!monaco) return false;
      const container = document.querySelector(`[data-testid="${testId}"]`);
      const editor = monaco.editor
        .getEditors()
        .find((e) => container?.contains(e.getContainerDomNode()));
      if (!editor) return false;
      editor.setValue(value);
      return true;
    },
    { testId: containerTestId, value: content },
  );
  if (!set) {
    // Fallback: click editor surface and type
    await page
      .locator(`[data-testid="${containerTestId}"] .monaco-scrollable-element`)
      .first()
      .click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(content);
  }
}

test("compose → query → results smoke test", async ({ page }) => {
  await page.goto("/");

  // Wait for Monaco editor to mount
  await page
    .locator('[data-testid="subgraph-editor"] .monaco-scrollable-element')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });

  // Set subgraph 1 SDL (users)
  await setMonacoContent(page, "subgraph-editor", SUBGRAPH_USERS);

  // Add a second subgraph (use the testid to avoid ambiguity with the query-tab "+" button)
  await page.getByTestId("subgraph-add-btn").click();

  // Set subgraph 2 SDL (reviews — extends User entity from subgraph 1)
  await setMonacoContent(page, "subgraph-editor", SUBGRAPH_REVIEWS);

  // Open the Supergraph SDL tab and wait for successful composition
  await page.getByRole("button", { name: "Supergraph SDL" }).click();
  await expect(page.locator("pre.code-block").filter({ hasText: "type Query" })).toBeVisible({
    timeout: 20000,
  });

  // Set a query that works with the composed schema
  await setMonacoContent(page, "query-editor", "{ me { id name } }");

  // Run the query
  await page.getByRole("button", { name: "Run" }).click();

  // Verify the Results panel shows JSON output
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.locator("pre").last()).toContainText("{", {
    timeout: 10000,
  });
});
