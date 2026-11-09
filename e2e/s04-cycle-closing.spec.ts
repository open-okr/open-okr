/**
 * Closing a cycle (UIUX-PLAN S-04, docs/design/okr-core-domain.md §10, plan
 * 0.7.0 O2): the status chip in the header, and on phase 7 starting closing
 * early and taking it back while the end has not passed.
 *
 * **A cycle of its own, years ahead.** The workspace's current quarter is read
 * by other specs, and moving its phase pointer would move what they see. This
 * one is made through the API, so the spec needs nothing but the claim.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test("a facilitator starts closing a cycle on phase 7, sees it in the header, and takes it back", async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Cycle closing e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  const token = ((await shown.textContent()) ?? "").trim();
  const api: APIRequestContext = await playwright.request.newContext({
    baseURL,
  });
  // A quarter far enough ahead that no other spec will ever plan in it.
  const year = new Date().getUTCFullYear() + 7;
  const created = await api.post("/api/v1/cycles/create", {
    headers: { authorization: `Bearer ${token}` },
    data: { on: `${year}-05-15`, cadence: "quarterly" },
  });
  expect(created.status(), await created.text()).toBe(200);
  const cycleId = ((await created.json()).data as { id: string }).id;
  await api.dispose();

  await goTo(page, `/cycle?cycle=${cycleId}&phase=7`);
  const header = page.locator("main");
  await expect(header.getByText("Planning", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Start closing" }).click();
  await expect(header.getByText("Closing", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText(/Closing has started\. Nothing is frozen/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Not yet: back to running" }).click();
  await expect(header.getByText("Planning", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Start closing" })).toBeVisible();
});
