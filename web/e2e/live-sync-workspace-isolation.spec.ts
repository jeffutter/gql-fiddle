import { test, expect } from "@playwright/test";
import { openApp, startLiveSession, joinLiveSession, getEditorValue } from "./live-sync-helpers";

// A live session is pinned to whichever workspace was active when it
// started — Y.Text field names are index-based ("sg-0"), not
// workspace-scoped, so nothing else stops an unrelated workspace's content
// from bleeding into the shared one. Regression coverage for that bug:
// creating (or switching to) another workspace on the host must not affect
// what the joined peer sees, and switching back must resume live sync
// cleanly rather than leaving it permanently unbound.
test("creating a new workspace on the host does not bleed into the shared session", async ({
  page,
  browser,
}) => {
  await openApp(page);
  const shared = await getEditorValue(page, "subgraph-editor");
  const sessionId = await startLiveSession(page);

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await joinLiveSession(page2, sessionId);
  await expect
    .poll(async () => getEditorValue(page2, "subgraph-editor"), { timeout: 5000 })
    .toBe(shared);

  // Host creates a brand-new, unrelated workspace.
  await page.getByTestId("workspace-add-btn").click();
  await page
    .locator('[data-testid="subgraph-editor"] .monaco-scrollable-element')
    .first()
    .waitFor({ state: "visible" });

  // The joiner's view of the shared workspace must be completely unaffected.
  await page2.waitForTimeout(1000);
  expect(await getEditorValue(page2, "subgraph-editor")).toBe(shared);

  // Switching the host back to the shared workspace must resume live sync
  // (not leave the editor permanently unbound from Yjs).
  await page.locator('[data-testid="workspace-tab-strip"] button').first().click();
  await expect
    .poll(async () => getEditorValue(page, "subgraph-editor"), { timeout: 5000 })
    .toBe(shared);

  await page.locator('[data-testid="subgraph-editor"] .monaco-scrollable-element').first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  await expect
    .poll(async () => (await getEditorValue(page, "subgraph-editor")).length, { timeout: 5000 })
    .toBe(shared.length + 1);
  const afterResumedEdit = await getEditorValue(page, "subgraph-editor");

  await expect
    .poll(async () => getEditorValue(page2, "subgraph-editor"), { timeout: 5000 })
    .toBe(afterResumedEdit);

  await context2.close();
});
