import { test, expect } from "@playwright/test";
import { openApp, startLiveSession, joinLiveSession, getEditorValue } from "./live-sync-helpers";

// Per-field sync (subgraph SDL, query text) only ever touches fields a
// client already knows about locally. A joiner's minimal "(collaboration)"
// template starts with exactly one subgraph and one query tab — without
// reconciling the *set* of tabs itself (not just each tab's content)
// against what the session actually has, a joiner would never discover a
// host's second subgraph at all, and it would never show up even after the
// initial sync completes. Regression coverage for that gap.
test("joiner sees every subgraph tab the host has, not just the first", async ({
  page,
  browser,
}) => {
  await openApp(page);
  const hostTabStrip = page.locator("nav.tab-strip").first();
  const hostTabCount = await hostTabStrip.locator("button, .tab").count();

  const sessionId = await startLiveSession(page);

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await joinLiveSession(page2, sessionId);

  const joinerTabStrip = page2.locator("nav.tab-strip").first();
  await expect
    .poll(async () => joinerTabStrip.locator("button, .tab").count(), { timeout: 5000 })
    .toBe(hostTabCount);

  // Switch both to the second tab and confirm they agree on its content,
  // then edit it on the joiner and confirm the edit reaches the host.
  await page.locator("nav.tab-strip .tab").nth(1).click();
  await page2.locator("nav.tab-strip .tab").nth(1).click();
  const hostSecondContent = await getEditorValue(page, "subgraph-editor");
  await expect
    .poll(async () => getEditorValue(page2, "subgraph-editor"), { timeout: 5000 })
    .toBe(hostSecondContent);

  await page2.locator('[data-testid="subgraph-editor"] .monaco-scrollable-element').first().click();
  await page2.keyboard.press("End");
  await page2.keyboard.type("Z", { delay: 20 });
  await expect
    .poll(async () => (await getEditorValue(page2, "subgraph-editor")).length, { timeout: 5000 })
    .toBe(hostSecondContent.length + 1);
  const joinerEdited = await getEditorValue(page2, "subgraph-editor");

  await expect
    .poll(async () => getEditorValue(page, "subgraph-editor"), { timeout: 5000 })
    .toBe(joinerEdited);

  await context2.close();
});

test("adding a subgraph mid-session propagates to the other client", async ({ page, browser }) => {
  await openApp(page);
  const sessionId = await startLiveSession(page);

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await joinLiveSession(page2, sessionId);

  const hostTabStrip = page.locator("nav.tab-strip").first();
  const beforeCount = await hostTabStrip.locator("button, .tab").count();

  await page.getByTestId("subgraph-add-btn").click();
  const afterCount = await hostTabStrip.locator("button, .tab").count();
  expect(afterCount).toBe(beforeCount + 1);

  const joinerTabStrip = page2.locator("nav.tab-strip").first();
  await expect
    .poll(async () => joinerTabStrip.locator("button, .tab").count(), { timeout: 5000 })
    .toBe(afterCount);

  await context2.close();
});
