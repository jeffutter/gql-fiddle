import { expect, type Page } from "@playwright/test";

/** Reads a Monaco editor's current value via window.__monaco (see useMonacoGraphQL.ts). */
export async function getEditorValue(page: Page, testId: string): Promise<string> {
  return page.evaluate((tid) => {
    const monaco = (window as unknown as Record<string, unknown>).__monaco as {
      editor: {
        getEditors: () => Array<{
          getContainerDomNode: () => Element;
          getValue: () => string;
        }>;
      };
    };
    const container = document.querySelector(`[data-testid="${tid}"]`);
    const editor = monaco.editor
      .getEditors()
      .find((e) => container?.contains(e.getContainerDomNode()));
    return editor?.getValue() ?? "<no editor found>";
  }, testId);
}

/** Loads the app and waits for the subgraph editor to be ready. */
export async function openApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await page
    .locator('[data-testid="subgraph-editor"] .monaco-scrollable-element')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
}

/** Clicks "Collaborate", waits for the session to be created, returns its id. */
export async function startLiveSession(page: Page): Promise<string> {
  const [createResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/live-session") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Collaborate" }).click(),
  ]);
  const { sessionId } = await createResp.json();
  await page.locator(".sync-status--live").waitFor({ state: "attached", timeout: 10000 });
  return sessionId;
}

/** Opens a share link (?ls=<sessionId>) in a fresh browser context and waits until connected. */
export async function joinLiveSession(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/?ls=${sessionId}`);
  await page
    .locator('[data-testid="subgraph-editor"] .monaco-scrollable-element')
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".sync-status--live").waitFor({ state: "attached", timeout: 10000 });
}

/** Clicks into an editor pane, moves to the end, and types the given text via real keystrokes. */
export async function typeIntoEditor(page: Page, testId: string, text: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"] .monaco-scrollable-element`).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

/** Asserts two pages' editors converge to the same content within the timeout. */
export async function expectEditorsToConverge(
  pageA: Page,
  pageB: Page,
  testId: string,
  timeoutMs = 5000,
): Promise<void> {
  await expect
    .poll(async () => getEditorValue(pageB, testId), { timeout: timeoutMs })
    .toBe(await getEditorValue(pageA, testId));
}
