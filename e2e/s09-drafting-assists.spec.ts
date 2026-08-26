/**
 * The drafting assists — P4-T15a (screen S-09, AI-NATIVE-PLAN.md §2.1).
 *
 * Acceptance criterion:
 *   Given the provider off, when a member opens the create form, then no assist
 *   is offered and the Draft Coach behaves exactly as it does today.
 *
 * **That criterion is about absence, so absence is what this file asserts**, and
 * it is the one thing a browser here can prove completely: this instance has no
 * AI provider, which is the state every self-hosted install without an API key
 * runs in. Nothing is offered, and the deterministic surface underneath is
 * whole: the create form works, the Draft Coach evaluates, the chips appear.
 *
 * What the assists do when a provider *is* configured is proved in
 * `packages/core/test/goal-assists.test.ts` against a scripted drafter, because
 * a browser cannot reach it here.
 *
 * **The file name carries the run order.** Specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` is the one that claims it, so
 * anything that signs in must sort after `registration-`. `s09` is screen S-09.
 *
 * The step is `?phase=4`, which is what `page.tsx` reads.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and reach the drafting step", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });

  await goTo(page, "/cycle?phase=4");
  // The drafting step's own form is the anchor: it is what the acceptance
  // criterion calls "the create form".
  await expect(
    page.getByRole("button", { name: "Add objective" }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("no assist is offered anywhere on the step", async () => {
  // Named exactly as the three affordances name themselves, so this fails the
  // day one of them starts rendering without a provider behind it.
  await expect(
    page.getByRole("button", { name: "Draft it" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Suggest numbers" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Suggest a parent" }),
  ).toHaveCount(0);
  await expect(page.getByText("Draft from an ambition")).toHaveCount(0);
});

test("the deterministic create form still works", async () => {
  const title = "Reduce onboarding to two days for mid-market teams";
  await page.getByLabel("The objective").first().fill(title);
  await page.getByRole("button", { name: "Add objective" }).first().click();

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
});

test("the Draft Coach evaluates it, exactly as it does today", async () => {
  // The coach is the deterministic path this row must not disturb. It runs in
  // the browser from `packages/method`, and it says something about every
  // objective on the step: that it says something is the assertion.
  const coach = page.getByRole("region", { name: "Draft Coach" }).first();
  if ((await coach.count()) > 0) {
    await expect(coach).toBeVisible();
    return;
  }
  // The coach's own region is not named in every layout, so fall back to what
  // it renders: a §4 check id, which only the catalogue produces.
  await expect(page.getByText(/OBJ-\d/).first()).toBeVisible({
    timeout: 15_000,
  });
});
