/**
 * The annual frame is reference during a quarterly cycle (METHOD.md §2.1 and
 * §2.2, docs/design/okr-core-domain.md §3.1, plan 0.7.0 O1).
 *
 * Phase 0 runs only in an annual cycle. A quarterly cycle's phase 0 address
 * still draws the frame, so that the facilitator can read it, but without the
 * form, and points at the annual cycle where it is written. `frame.set`
 * refuses the quarterly cycle as well, which the unit suite proves.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test("a quarterly cycle shows the annual frame without its form, and points at the annual cycle", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/cycle?phase=0");

  await expect(
    page.getByText(
      "The annual frame is reference during a quarterly cycle, and this cycle's phase 3 revalidates it.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: /^(Write|Replace) the frame$/ }),
  ).toHaveCount(0);

  const annual = page.getByRole("link", { name: "the annual cycle." });
  await expect(annual).toHaveAttribute("href", "/cycle?mode=annual&phase=0");
});
