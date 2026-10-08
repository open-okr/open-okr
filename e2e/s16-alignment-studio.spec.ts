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
 *
 * P9-T16a: the score is a share, METHOD.md §5.2.
 *   Given the health panel with a score, when it is read, then the share is
 *   the counted goals over the measured ones as a percentage, and the band
 *   sentence is the one §5.2 gives that share. The header carries the same
 *   figure with "%".
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

test("acceptance: the share, its counts and its band agree, in the panel and the header", async () => {
  await goTo(page, "/goals?display=diagram");
  await expect(panel()).toBeVisible({ timeout: 15_000 });
  const share = panel().getByTestId("alignment-share");
  if ((await share.count()) === 0) {
    // Nothing below company level in this cycle: the panel says so.
    await expect(panel()).toContainText("No score");
    console.log("S-16: no score, nothing below company level");
    return;
  }
  const figure = (await share.innerText()).trim();
  expect(figure).toMatch(/^\d{1,3}%$/);
  const score = Number(figure.slice(0, -1));

  const counted = (
    await panel().getByText(/ goals below company level align/).innerText()
  ).match(/^(\d+) of (\d+) /);
  expect(counted).not.toBeNull();
  const [, of, measured] = counted as RegExpMatchArray;
  expect(score).toBe(Math.floor((100 * Number(of)) / Number(measured)));
  // Which branch ran, in the run's own output, since either passes.
  console.log(`S-16: ${score}%, ${of} of ${measured} counted`);

  // The canon thresholds: nothing in this suite changes them.
  const band = panel().getByTestId("alignment-band");
  const sentence = await band.innerText();
  if (!/No company-level objective/.test(sentence)) {
    expect(sentence).toBe(
      score >= 90
        ? "At or above 90%, which METHOD.md §5.2 calls healthy."
        : score >= 80
          ? "From 80% to below 90% is watch. Each unaligned goal below opens it."
          : "Below 80% is a gap. Each unaligned goal below opens it.",
    );
  }

  const header = main().locator('a[href="/cycle?phase=5"]');
  await expect(header).toContainText(String(score));
  await expect(header).toContainText("%");
  await expect(header).not.toContainText("/ 100");
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
