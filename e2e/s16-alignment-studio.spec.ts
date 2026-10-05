/**
 * The alignment studio, now the OKRs screen's diagram (S-16, P9-T09b).
 *
 * Acceptance:
 *   Given a link to `/goals/studio` for a cycle, when it is opened, then the
 *   diagram of that cycle opens with the health panel and its findings.
 *   Given two objectives on the diagram, when they are linked in link mode,
 *   then the drawer lists the dependency, and removing it there takes it
 *   apart (completeness review M-35, which the studio's details panel used to
 *   answer).
 *
 * It uses the first two objectives the diagram draws, which earlier specs in
 * this suite have created, and leaves no dependency behind.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const main = () => page.locator("#main-content");
const panel = () => page.getByTestId("alignment-panel");
const drawer = () => page.getByTestId("okr-drawer");

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("the studio's old address opens the same cycle's diagram, with the health panel", async () => {
  // A real cycle, read from the picker, so the redirect has one to keep.
  await goTo(page, "/goals");
  await main().locator('button[aria-haspopup="listbox"]').click();
  const href =
    (await main()
      .locator('ul a[href*="cycle="]')
      .first()
      .getAttribute("href")) ?? "";
  const cycleId = new URL(href, "http://x").searchParams.get("cycle") ?? "";
  expect(cycleId).not.toBe("");

  await goTo(page, `/goals/studio?cycle=${cycleId}`);
  await expect(page).toHaveURL(
    new RegExp(`/goals\\?display=diagram&cycle=${cycleId}`),
  );
  await expect(page.getByTestId("okr-diagram")).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel().getByRole("tab", { name: "Health" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel()).toContainText(
    /Alignment health|No score|no structural gaps/i,
  );
});

test("two objectives are linked on the diagram and unlinked from the drawer", async () => {
  await goTo(page, "/goals?display=diagram");
  const cards = page.getByRole("group", { name: / objective, / });
  await expect(cards.nth(1)).toBeVisible({ timeout: 15_000 });
  const first = cards.nth(0);
  const second = cards.nth(1);
  const secondTitle = (
    await second.locator("span.line-clamp-2").innerText()
  ).trim();

  const link = page.getByRole("button", { name: "Link two objectives" });
  await link.click();
  await expect(link).toHaveAttribute("aria-pressed", "true");
  await first.locator("span.line-clamp-2").click();
  await second.locator("span.line-clamp-2").click();
  // Saved: link mode ends and the dependencies are drawn.
  await expect(link).toHaveAttribute("aria-pressed", "false", {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "Dependencies" }),
  ).toHaveAttribute("aria-pressed", "true");

  // The drawer's alignment tab lists it by the other objective's title.
  await first.locator("span.line-clamp-2").click();
  await drawer().getByRole("tab", { name: "Alignment" }).click();
  const remove = drawer().getByRole("button", {
    name: `Remove the dependency on ${secondTitle}`,
  });
  await expect(remove).toBeVisible({ timeout: 15_000 });
  await remove.click();
  await expect(remove).toHaveCount(0, { timeout: 15_000 });
});
