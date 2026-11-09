/**
 * Admin, Agent connections (docs/design/agent-connections-admin.md, plan 0.7.0
 * A4): an administrator sees every agent connection and agent token in the
 * workspace, and ends one.
 *
 * The claimant is the administrator and also the token's owner here, which
 * is the one setup this file can make on its own. Ending another member's
 * connection, and their inbox notice, is proved in
 * packages/core/test/connections-admin.test.ts.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const NAME = `Agent connections e2e ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("lists an agent token a member made", async () => {
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill(NAME);
  await page.getByRole("radio", { name: /An AI agent/ }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByTestId("minted-token")).toBeVisible({
    timeout: 10_000,
  });

  await goTo(page, "/admin/connections");
  await expect(
    page.getByRole("heading", { name: "Agent connections" }),
  ).toBeVisible();
  const row = page.getByTestId("admin-connection").filter({ hasText: NAME });
  await expect(row).toBeVisible();
  await expect(row.getByText("Agent token")).toBeVisible();
});

test("ends it after asking first, and it moves to Ended", async () => {
  const row = page.getByTestId("admin-connection").filter({ hasText: NAME });
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "End" }).click();
  await expect(row).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("link", { name: "Ended" }).click();
  await expect(
    page.getByTestId("admin-connection").filter({ hasText: NAME }),
  ).toBeVisible();
});
