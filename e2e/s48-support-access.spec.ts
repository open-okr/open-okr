/**
 * S-48, the customer's half of support access (P8-T04b).
 *
 * **Written at P8-T03b-fix, because `route-coverage.test.ts` was red and no
 * honest reason could be written instead.** That test asks every route to be
 * opened by a spec or to carry a written sentence saying why not. The plan
 * screen beside this one has such a sentence and it is true: that screen
 * calls `notFound()` with the cloud flag off, so the suite's instance
 * genuinely cannot reach it. Support access carries no such guard, so it is
 * reachable on exactly the instance this suite builds, and the only truthful
 * answer was to open it.
 *
 * **No route is written here in backticks, and that is not a style choice.**
 * `route-coverage.test.ts` reads a backtick or a quote followed by a url as a
 * visit, so naming a neighbouring screen's path in this comment would report
 * that screen as covered by this file. It did, on the first run, and the
 * staleness half of that test caught it immediately.
 *
 * **What it proves is the empty state, and that is the state that matters
 * here.** The suite's instance is self-hosted and has no operators, so no
 * support session can ever exist on it. A customer opening this screen must
 * still be told plainly that nobody has asked and nobody has been, rather
 * than meeting two bare headings with nothing under them. An empty screen
 * that looks broken is the commonest way a security assurance stops
 * reassuring anybody.
 *
 * **What it deliberately does not prove**: granting, refusing, the banner, or
 * an expiry. Each needs an operator to have asked, and an operator cannot
 * exist here. Those belong to a cloud fixture rather than to this instance,
 * and P8-T04b's row is where that gap is recorded.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("the screen opens and says what it is for", async () => {
  await goTo(page, "/admin/support");

  await expect(
    page.getByRole("heading", { name: "Support access" }),
  ).toBeVisible({ timeout: 15_000 });
  // The sentence is the whole point of the screen: it states the rule before
  // it states the history, so a reader who never scrolls has still been told
  // that nobody gets in unless somebody here says so.
  await expect(
    page.getByText("unless somebody here lets them in"),
  ).toBeVisible();
});

test("both empty states say nothing has happened, rather than showing nothing", async () => {
  await goTo(page, "/admin/support");

  await expect(page.getByText("Nobody has asked to come in.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText("Nobody from OpenOKR has been in this workspace."),
  ).toBeVisible();
});

test("it is reachable from the admin navigation, not only by url", async () => {
  // `reachability.test.ts` proves a link names the route somewhere in source.
  // This proves the link a person actually clicks is on the screen and lands
  // here, which is the half reading source cannot answer.
  await goTo(page, "/admin/general");

  await page.getByRole("link", { name: "Support access" }).click();

  await expect(page).toHaveURL(/\/admin\/support$/, { timeout: 15_000 });
});
