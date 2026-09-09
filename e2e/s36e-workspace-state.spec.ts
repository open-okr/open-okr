/**
 * The workspace state and its explanation (TECHNICAL-PLAN §4.1, P6-G25).
 *
 * The acceptance criterion, end to end: given a frozen workspace, when a member
 * tries to write, then the overlay explains why and the administrator can lift
 * it.
 *
 * **Driven through the browser because the criterion spans three surfaces.**
 * The switch is on one screen, the explanation is on every screen, and the
 * refusal comes from the pipeline. `workspace.setState` shipped at P2-T09 and
 * `isRecoveryAction` has kept it usable during a freeze since then; what never
 * existed was a way to press it, which is what P6-T07's rehearsal runbook
 * assumed.
 *
 * **It freezes the shared instance and lifts it again in the same file.** Every
 * later spec would fail against a frozen workspace, so the last case here is
 * the one that puts it back, and it is deliberately the acceptance case's own
 * second half rather than a cleanup hook: an administrator lifting it *is* what
 * the criterion asks to see.
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

test("the general card carries the state, and says what it is", async () => {
  await goTo(page, "/admin/general");
  await expect(page.getByTestId("workspace-state-current")).toContainText(
    "Active",
    { timeout: 15_000 },
  );
  // The current state is not offered as a button: there is nothing to press.
  await expect(page.getByTestId("set-state-active")).toHaveCount(0);
  await expect(page.getByTestId("set-state-frozen")).toBeVisible();
});

test("no banner while the workspace is active", async () => {
  await goTo(page, "/");
  await expect(page.getByTestId("workspace-state-banner")).toHaveCount(0);
});

test("freezing it explains itself on a screen that is not the admin one", async () => {
  await goTo(page, "/admin/general");
  await page.getByTestId("set-state-frozen").click();
  await expect(page.getByTestId("workspace-state-current")).toContainText(
    "Frozen",
    { timeout: 15_000 },
  );

  // Every screen, which is what the shell rendering it means. The Work Map is
  // the furthest thing from the switch that a member reaches first.
  await goTo(page, "/");
  const banner = page.getByTestId("workspace-state-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("This workspace is frozen");
  // Reads are unaffected by design, so the page behind it still rendered.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("a write is refused while it is frozen", async () => {
  // The pipeline's own refusal, seen from a screen. `people.` is on the
  // recovery list and goals are not, so a goal edit is the honest thing to try.
  await goTo(page, "/goals");
  const goalHref = await page
    .locator("a[href^='/goals/']")
    .evaluateAll((links) => {
      const match = links
        .map((link) => link.getAttribute("href") ?? "")
        .find((href) => /^\/goals\/[0-9a-f-]{36}$/.test(href));
      return match ?? "";
    });
  expect(goalHref, "no goal link on /goals").not.toBe("");
  await goTo(page, goalHref);

  // The banner followed us here, which is the point of putting it in the shell.
  await expect(page.getByTestId("workspace-state-banner")).toBeVisible();

  const title = page.getByLabel("The objective");
  await title.fill("A title a frozen workspace must not keep");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();

  // Refused, and the old title is still what the page holds after a reload.
  await goTo(page, goalHref);
  await expect(page.getByLabel("The objective")).not.toHaveValue(
    "A title a frozen workspace must not keep",
  );
});

test("acceptance: the administrator lifts it from inside the freeze", async () => {
  // The recovery list is what makes this possible: `workspace.setState` is on
  // it, so the one write that survives a freeze is the one that ends it. A
  // control that locked itself out would be worse than no control.
  await goTo(page, "/admin/general");
  await expect(page.getByTestId("workspace-state-banner")).toBeVisible();
  await page.getByTestId("set-state-active").click();

  await expect(page.getByTestId("workspace-state-current")).toContainText(
    "Active",
    { timeout: 15_000 },
  );
  await goTo(page, "/");
  await expect(page.getByTestId("workspace-state-banner")).toHaveCount(0);
});
