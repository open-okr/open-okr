/**
 * A rule named by its key explains itself where it is named (UIUX-PLAN §4,
 * method hint).
 *
 * The goal page's coach strip shows each verdict as its key, "OBJ-1", which
 * says nothing to somebody who has not opened the rule. Resting on it now
 * previews the rule from the catalogue, a click still opens the rule's page,
 * and that page links to the METHOD.md section the rule comes from.
 *
 * **The objective is written here and deleted at the end**, because a spec
 * may rely on the claim and nothing else.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

/** It starts with an output verb, so OBJ-1 warns on it. */
const OBJECTIVE = "Launch the guide that gets new teams started";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";

const authed = () => ({ authorization: `Bearer ${token}` });

async function goalId(): Promise<string> {
  const listed = await api.get("/api/v1/goals/list", { headers: authed() });
  const found = (
    (await listed.json()).data.goals as { id: string; title: string }[]
  ).find((row) => row.title === OBJECTIVE);
  return found?.id ?? "";
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    const id = await goalId();
    if (id) {
      const deleted = await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id },
      });
      expect(deleted.status()).toBe(200);
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with a token for putting things back", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Rule previews e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();
});

test("an objective the coach has something to say about", async () => {
  // Retry-safe: a second attempt finds the first one's objective.
  if (await goalId()) {
    return;
  }
  await goTo(page, "/goals");
  await page
    .locator("#main-content")
    .getByRole("button", { name: "Add objective" })
    .last()
    .click();
  await page.keyboard.type(OBJECTIVE);
  await page.keyboard.press("Enter");
  await expect.poll(goalId, { timeout: 15_000 }).not.toBe("");
});

test("a verdict's key previews its rule on hover, and a click still opens it", async () => {
  await goTo(page, `/goals/${await goalId()}`);
  const chip = page.getByRole("link", { name: "OBJ-1", exact: true }).first();
  await chip.hover();
  const preview = page.getByTestId("rule-preview");
  await expect(preview).toContainText("OBJ-1 Outcome, not output", {
    timeout: 15_000,
  });
  await expect(preview).toContainText("Objective check");
  await expect(preview).toContainText("Starts with an output verb");
  await expect(preview.getByRole("link")).toHaveAttribute(
    "href",
    /METHOD\.md#41-objective-checks$/,
  );

  await chip.click();
  await expect(page).toHaveURL(/\/method\/OBJ-1$/, { timeout: 15_000 });
});

test("a rule's own page links to where the method sets it out", async () => {
  await goTo(page, "/method/KR-3");
  await expect(page.getByTestId("rule-method-link")).toHaveAttribute(
    "href",
    /\/blob\/v[^/]+\/docs\/specification\/METHOD\.md#42-key-result-checks$/,
    { timeout: 15_000 },
  );
});
