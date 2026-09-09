/**
 * The screens nothing ever opened (GAP-AUDIT G-10, P6-G29).
 *
 * **Sixteen of forty-seven routes had no end-to-end path when the audit was
 * written**, and the four here are the ones left that a signed-in member can
 * reach directly. The rest are covered by the rows that built them, reached
 * through a link rather than a url, or genuinely unreachable from a browser
 * session; `apps/web/test/route-coverage.test.ts` names every one of those
 * with its reason and fails when a new route joins them.
 *
 * **These four are smoke, deliberately.** Each screen's behaviour belongs to
 * the row that built it; what was missing was any proof that they render at
 * all for a real session against a real database. A page that throws on a
 * missing read is exactly the class this catches, and it is the class that
 * reached continuous integration four times before P1-T08 built the suite.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
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

const SCREENS: ReadonlyArray<readonly [string, string]> = [
  ["/scorecard", "Scorecard"],
  ["/account/security", "Security"],
  ["/admin/ai", "AI"],
  ["/admin/branding", "Branding"],
];

for (const [route, heading] of SCREENS) {
  test(`${route} renders for a signed-in member`, async () => {
    await goTo(page, route);
    // The heading, not merely a 200: a page that threw would still answer,
    // with the segment's error boundary inside the shell (P6-G24b).
    await expect(
      page.getByRole("heading", { level: 1, name: heading }).first(),
    ).toBeVisible({ timeout: 15_000 });
    // And the shell is around it, which is what distinguishes a rendered
    // screen from a boundary that replaced one.
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    // Nothing on the page is announcing a failure.
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });
}
