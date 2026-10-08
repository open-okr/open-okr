/**
 * The annual cycle can be made and opened from the cycle screen, and phase 6
 * shows how a target moves (completeness review M-06, UIUX-PLAN S-04 and
 * S-11, METHOD.md §2.1 and §7.6).
 *
 * **Three things no browser could do.** The page read the quarter and nothing
 * else, so an annual cycle could exist and never be opened. The create control
 * passed no cadence, so it only ever made the quarter. And
 * `workflow.calibrate` had no caller, while phase 6 read "not calibrated" from
 * a hardcoded null. METHOD v2 has since retired the calibration (P9-T13-c-b):
 * a target moves at any time under §2.9's one rule, so phase 6 states the
 * rule and records nothing.
 *
 * **The file name carries the run order.** Specs run alphabetically against
 * one instance and `registration-to-dashboard.spec.ts` claims it, so this one
 * sorts after it.
 *
 * **What it leaves behind is chosen so later specs read the same thing.** The
 * annual cycle is the current year's, which starts on or before the quarter
 * containing today, and the cadence a bare create or "ensure current" takes
 * reads the quarterly cycles first (M-06), so nothing that asks for "this
 * quarter" is moved.
 *
 * **Retry-safe on purpose.** Continuous integration retries once, and a year
 * can be made only once. So the step makes it when it is missing and asserts
 * on it either way.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test("the annual cycle is made and opened from the cycle screen, and phase 6 states how a target moves", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/cycle");

  // S-04's mode toggle, where a chip used to say "quarterly mode".
  await page.getByTestId("cycle-mode-annual").click();
  await expect(page).toHaveURL(/\/cycle\?mode=annual/);
  await expect(page.getByTestId("cycle-mode-annual")).toHaveAttribute(
    "aria-current",
    "true",
  );

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  if ((await heading.textContent())?.includes("No annual cycle yet")) {
    // A day in the middle of the year, so the workspace timezone cannot put
    // it in a different one.
    const year = new Date().getUTCFullYear();
    await page
      .getByLabel("A date inside the cycle to create")
      .fill(`${year}-06-30`);
    await page.getByTestId("create-cycle").click();
    // The new cycle opens once it exists.
    await expect(page).toHaveURL(/\/cycle\?cycle=[0-9a-f-]{36}/, {
      timeout: 15_000,
    });
  }

  // An annual cycle starts at phase 0, the one quarterly cycles skip.
  await expect(heading).toHaveText("Phase 0 · Annual strategy");
  await expect(page.getByTestId("cycle-mode-annual")).toHaveAttribute(
    "aria-current",
    "true",
  );

  // The rail keeps the cycle being read. Before M-06 this link was
  // `/cycle?phase=6`, which opened the quarter.
  await page.getByRole("link", { name: /6 · Run the cadence/ }).click();
  await expect(page).toHaveURL(/\/cycle\?cycle=[0-9a-f-]{36}&phase=6/);
  await expect(heading).toHaveText("Phase 6 · Run the cadence");
  await expect(page.getByTestId("cycle-mode-annual")).toHaveAttribute(
    "aria-current",
    "true",
  );

  const calibration = page.getByTestId("calibration");
  await expect(calibration).toBeVisible();
  // §7.6 itself, from packages/method: the one rule a target moves by.
  await expect(page.getByTestId("calibration-rule")).toHaveText(
    /^A target may be changed at any time in the cycle, as §2\.9 says\. Making a target harder needs no reason\. /,
  );
  // Nothing to record once a cycle any more.
  await expect(calibration.getByRole("button")).toHaveCount(0);
  await expect(calibration.getByRole("textbox")).toHaveCount(0);

  // And the toggle goes back to the quarter.
  await page.getByTestId("cycle-mode-quarterly").click();
  await expect(page).toHaveURL(/\/cycle\?mode=quarterly/);
  await expect(page.getByTestId("cycle-mode-quarterly")).toHaveAttribute(
    "aria-current",
    "true",
  );
});
