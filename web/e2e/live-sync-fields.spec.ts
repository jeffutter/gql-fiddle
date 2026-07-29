import { test, expect } from "@playwright/test";
import { openApp, startLiveSession, joinLiveSession, getEditorValue } from "./live-sync-helpers";

// The subgraph editor isn't the only field that syncs — query tabs and mock
// config are wired through the same bindEditor/Yjs-field-name machinery but
// are separate code paths (separate onMount/onChange call sites in App.tsx).
// A mistake scoped to just one of them (e.g. a field-name typo, a missed
// onChange gate) wouldn't be caught by a subgraph-only test.
test("query tab edits propagate between clients", async ({ page, browser }) => {
  await openApp(page);
  const original = await getEditorValue(page, "query-editor");
  const sessionId = await startLiveSession(page);

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await joinLiveSession(page2, sessionId);
  await expect
    .poll(async () => getEditorValue(page2, "query-editor"), { timeout: 5000 })
    .toBe(original);

  await page.locator('[data-testid="query-editor"] .monaco-scrollable-element').first().click();
  await page.keyboard.press("End");
  // Space characters get dropped under Playwright's default zero-delay
  // typing simulation (a keyboard-simulation artifact, not a sync issue —
  // verified separately: the surrounding text always lands at the exact
  // right position). A small per-character delay avoids it.
  await page.keyboard.type("#hostedit", { delay: 20 });

  await expect
    .poll(async () => (await getEditorValue(page, "query-editor")).length, { timeout: 5000 })
    .toBe(original.length + "#hostedit".length);
  const afterEdit = await getEditorValue(page, "query-editor");

  await expect
    .poll(async () => getEditorValue(page2, "query-editor"), { timeout: 5000 })
    .toBe(afterEdit);

  await context2.close();
});

test("mock config edits propagate between clients", async ({ page, browser }) => {
  await openApp(page);
  const sessionId = await startLiveSession(page);

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await joinLiveSession(page2, sessionId);

  // Mock config starts empty with only a placeholder shown via defaultValue
  // (not a real editor value) — switch both clients to it and confirm they
  // agree on the (empty) starting point before editing.
  await page.getByRole("button", { name: "Mock Config" }).click();
  await page2.getByRole("button", { name: "Mock Config" }).click();
  await page
    .locator('[data-testid="mock-config-editor"] .monaco-scrollable-element')
    .first()
    .waitFor({ state: "visible" });
  await page2
    .locator('[data-testid="mock-config-editor"] .monaco-scrollable-element')
    .first()
    .waitFor({ state: "visible" });

  const original = await getEditorValue(page, "mock-config-editor");
  await expect
    .poll(async () => getEditorValue(page2, "mock-config-editor"), { timeout: 5000 })
    .toBe(original);

  await page
    .locator('[data-testid="mock-config-editor"] .monaco-scrollable-element')
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.type("User.name:\n  value: Ada");

  await expect
    .poll(async () => getEditorValue(page, "mock-config-editor"), { timeout: 5000 })
    .toContain("Ada");
  const afterEdit = await getEditorValue(page, "mock-config-editor");

  await expect
    .poll(async () => getEditorValue(page2, "mock-config-editor"), { timeout: 5000 })
    .toBe(afterEdit);

  await context2.close();
});
