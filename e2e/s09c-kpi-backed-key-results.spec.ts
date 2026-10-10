/**
 * KPI-backed key results, end to end (completeness review M-07, TECHNICAL-PLAN
 * §6.2, screens S-09, S-14 and S-20).
 *
 * "A KPI-backed key result reads the KPI's latest achievement." Two things
 * stopped that being true in a browser: no screen could name a KPI for a key
 * result, and a value typed into the KPI grid moved the KPI and nothing that
 * read it. The rows are proved in
 * `packages/core/test/kpi-linked-key-results.test.ts`; what only a browser
 * settles is that the three screens agree: the grid's number reaches the
 * drafting step's progress bar without anybody touching the goal, and the
 * goal page can link a key result that was drafted by hand.
 *
 * **The file name carries the run order.** Specs run alphabetically against
 * one instance, and `registration-to-dashboard.spec.ts` claims it and
 * completes phases 1 to 3, which is what opens drafting. `s09` is screen S-09,
 * and `c` sorts it after the two drafting specs already there.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const KPI = "Teams active every week";
const OBJECTIVE = "Teams come back to the product every week";
const READ_FROM_KPI = "Grow teams active every week from 40 to 200";
const BY_HAND = "Cut the days to a team's second visit from 9 to 3";

let context: BrowserContext;
let page: Page;
let goalId = "";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

/** Types a value into the KPI's editable cell and waits for the grid to say so. */
async function recordOnTheGrid(value: string, achievement: string) {
  await goTo(page, "/kpis");
  const cell = page.getByRole("textbox", {
    name: new RegExp(`^${KPI}, period beginning`),
  });
  await expect(cell).toBeVisible({ timeout: 15_000 });
  await cell.fill(value);
  await cell.press("Enter");
  // The row's own figure is the proof the write finished. Navigating while
  // the transition is in flight cancels it, which is the race the recovery
  // spec in `registration-to-dashboard` learned about.
  await expect(page.getByRole("row").filter({ hasText: KPI })).toContainText(
    achievement,
  );
}

const progressOfTheObjective = () =>
  page.getByRole("progressbar", { name: `Progress of ${OBJECTIVE}` });

test("a KPI with a standing target and a first reading", async () => {
  await signIn(page);
  await goTo(page, "/kpis");
  await page.getByLabel("What is being measured").fill(KPI);
  await page.getByLabel("Standing target").fill("200");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add", exact: true })
    .first()
    .click();

  // 50 of 200.
  await recordOnTheGrid("50", "25%");
});

test("drafting names the KPI, and the key result starts where it stands", async () => {
  await goTo(page, "/cycle?phase=4");
  await page.getByLabel("The objective").first().fill(OBJECTIVE);
  await page.getByRole("button", { name: "Add objective" }).first().click();
  await expect(
    page.getByRole("heading", { level: 2, name: OBJECTIVE }),
  ).toBeVisible({ timeout: 15_000 });

  // One "add a key result" form per objective, each named after its own.
  const form = page.getByRole("form", {
    name: `Add a key result to ${OBJECTIVE}`,
  });
  goalId = await form.locator('input[name="goalId"]').inputValue();

  // By hand unless somebody chooses otherwise.
  await expect(form.getByLabel("Measured by")).toHaveValue("");
  await form.getByRole("textbox", { name: "The key result" }).fill(READ_FROM_KPI);
  await form
    .getByLabel("Measured by")
    .selectOption({ label: `Read from ${KPI}` });
  await form.getByRole("textbox", { name: "Baseline" }).fill("40");
  await form.getByRole("textbox", { name: "Target" }).fill("200");
  await form.getByRole("button", { name: "Add key result" }).click();

  await expect(page.getByText(READ_FROM_KPI, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // Progress is the KPI's achievement, not a second formula over the key
  // result's own baseline and target, which would read 6%.
  await expect(progressOfTheObjective()).toHaveAttribute("aria-valuenow", "25");
});

test("a second key result, measured by hand", async () => {
  await goTo(page, "/cycle?phase=4");
  const form = page.getByRole("form", {
    name: `Add a key result to ${OBJECTIVE}`,
  });
  await form.getByRole("textbox", { name: "The key result" }).fill(BY_HAND);
  await form.getByLabel("Direction").selectOption("reduce");
  await form.getByRole("textbox", { name: "Baseline" }).fill("9");
  await form.getByRole("textbox", { name: "Target" }).fill("3");
  await form.getByRole("button", { name: "Add key result" }).click();
  await expect(page.getByText(BY_HAND, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test("a new reading on the grid moves the objective without touching it", async () => {
  // 100 of 200. Nothing is done to the goal: the grid is the only write.
  await recordOnTheGrid("100", "50%");

  await goTo(page, "/cycle?phase=4");
  // One key result at 50, one measured by hand still at 0.
  await expect(progressOfTheObjective()).toHaveAttribute("aria-valuenow", "25", {
    timeout: 15_000,
  });
});

test("the goal page links the key result drafted by hand", async () => {
  expect(goalId, "the drafting form named no goal").not.toBe("");
  await goTo(page, `/goals/${goalId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: OBJECTIVE }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("from a KPI", { exact: true })).toHaveCount(1);

  // The only key result left to link is the one measured by hand.
  await expect(page.getByLabel("Key result to link")).toHaveValue(/.+/);
  await page.getByLabel("KPI it reads from").selectOption({ label: KPI });
  await page.getByTestId("link-kpi").click();

  await expect(page.getByText("from a KPI", { exact: true })).toHaveCount(2, {
    timeout: 15_000,
  });
  // Nothing measured by hand is left, so there is nothing left to offer.
  await expect(page.getByLabel("Key result to link")).toHaveCount(0);

  // Both key results now read 50, so the objective does.
  await goTo(page, "/cycle?phase=4");
  await expect(progressOfTheObjective()).toHaveAttribute("aria-valuenow", "50", {
    timeout: 15_000,
  });
});
