import { test, expect } from "@playwright/test";
import {
  openApp,
  startLiveSession,
  joinLiveSession,
  getEditorValue,
  typeIntoEditor,
} from "./live-sync-helpers";

// Covers the core live-sync round trip end to end: a second client joining
// must receive the full pre-existing content (not start blank), and edits
// from either side must propagate to the other without corrupting content.
// Regression coverage for three bugs found in TASK-119 hardening:
//   - the initial sync handshake was one-directional, so a joiner never
//     received a session's existing content
//   - MonacoBinding was only ever bound from Monaco's onMount, which fires
//     once — the session creator's already-open editor never got bound
//   - Monaco's onChange wrote directly to the store in parallel with Yjs,
//     racing it and corrupting content on every edit once two clients synced
test("second client receives full existing content on join", async ({ page, browser }) => {
  await openApp(page);
  const original = await getEditorValue(page, "subgraph-editor");
  const sessionId = await startLiveSession(page);

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await joinLiveSession(page2, sessionId);

  await expect
    .poll(async () => getEditorValue(page2, "subgraph-editor"), { timeout: 5000 })
    .toBe(original);

  await context2.close();
});

test("edits propagate both ways between two connected clients without duplicating content", async ({
  page,
  browser,
}) => {
  await openApp(page);
  const original = await getEditorValue(page, "subgraph-editor");
  const sessionId = await startLiveSession(page);

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await joinLiveSession(page2, sessionId);
  await expect
    .poll(async () => getEditorValue(page2, "subgraph-editor"), { timeout: 5000 })
    .toBe(original);

  // Host (the one who already had this editor open before the session
  // started) types — this is the scenario that exposed the onMount-only
  // binding bug, since this editor pre-dates the session.
  await typeIntoEditor(page, "subgraph-editor", "X");
  await expect
    .poll(async () => (await getEditorValue(page, "subgraph-editor")).length, { timeout: 5000 })
    .toBe(original.length + 1);
  const afterHostEdit = await getEditorValue(page, "subgraph-editor");

  await expect
    .poll(async () => getEditorValue(page2, "subgraph-editor"), { timeout: 5000 })
    .toBe(afterHostEdit);

  // Joiner edits back — must reach the host too, not just the other direction.
  await typeIntoEditor(page2, "subgraph-editor", "Y");
  await expect
    .poll(async () => (await getEditorValue(page2, "subgraph-editor")).length, { timeout: 5000 })
    .toBe(afterHostEdit.length + 1);
  const afterJoinerEdit = await getEditorValue(page2, "subgraph-editor");

  await expect
    .poll(async () => getEditorValue(page, "subgraph-editor"), { timeout: 5000 })
    .toBe(afterJoinerEdit);

  await context2.close();
});
