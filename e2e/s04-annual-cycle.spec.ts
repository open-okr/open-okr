/**
 * The annual cycle can be made and opened from the cycle screen, and the
 * mid-cycle calibration recorded on it (completeness review M-06, UIUX-PLAN
 * S-04 and S-11, METHOD.md §2.1 and §7.6).
 *
 * **Three things no browser could do.** The page read the quarter and nothing
 * else, so an annual cycle could exist and never be opened. The create control
 * passed no cadence, so it only ever made the quarter. And
 * `workflow.calibrate` had no caller, while phase 6 read "not calibrated" from
 * a hardcoded null.
 *
 * **The file name carries the run order.** Specs run alphabetically against
 * one instance and `registration-to-dashboard.spec.ts` claims it, so this one
 * sorts after it.
 *
 * **What it leaves behind is chosen so later specs read the same thing.** The
 * annual cycle is the current year's, which starts on or before the quarter
 * containing today, and the cadence a bare create or "ensure current" takes
 * reads the quarterly cycles first (M-06), so nothing that asks for "this
 * quarter" is moved. The calibration is on the annual cycle, not the quarter.
 *
 * **Retry-safe on purpose.** Continuous integration retries once, and a year
 * and a calibration can each be made only once. So each step makes its thing
 * when it is missing and asserts on it either way.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const REASON =
  "The regulator moved the launch window from September to November.";

test("the annual cycle is made, opened and calibrated from the cycle screen", async ({
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
  // §7.6 itself, from packages/method, above the form.
  await expect(page.getByTestId("calibration-rule")).toHaveText(
    /^Once per cycle, optional\. .* Not for difficulty, not for mood\. /,
  );
  if ((await page.getByTestId("calibration-reason").count()) === 0) {
    await calibration
      .getByLabel("What changed outside, and how somebody could check it")
      .fill(REASON);
    await calibration
      .getByRole("button", { name: "Record the calibration" })
      .click();
  }

  // What the calibration recorded, in place of the form. §7.6 allows one,
  // so the form is gone once it is used.
  await expect(page.getByTestId("calibration-reason")).toHaveText(REASON, {
    timeout: 15_000,
  });
  await expect(calibration).toContainText(
    "This cycle has used its one calibration",
  );
  await expect(
    calibration.getByRole("button", { name: "Record the calibration" }),
  ).toHaveCount(0);
  await expect(page.getByText(/^calibrated \d{4}-\d{2}-\d{2}$/)).toBeVisible();

  // And the toggle goes back to the quarter.
  await page.getByTestId("cycle-mode-quarterly").click();
  await expect(page).toHaveURL(/\/cycle\?mode=quarterly/);
  await expect(page.getByTestId("cycle-mode-quarterly")).toHaveAttribute(
    "aria-current",
    "true",
  );
});
