/**
 * Every destination is reachable on a phone (completeness review H-16).
 *
 * Below 768 pixels the sidebar hides itself and a bottom tab bar takes over.
 * The bar carried the first four sidebar items and nothing else, so on a phone
 * KPIs, Spaces, the board, initiatives, sessions and admin could only be
 * reached by typing an address. A More tab now opens the rest, grouped as the
 * sidebar groups them. This drives it at a phone's width against the
 * standalone server, the way somebody holding one would.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.use({ viewport: { width: 375, height: 812 } });

test("the More tab reaches every screen the hidden sidebar would", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/");

  const bar = page.getByRole("navigation", { name: "Primary" });
  const more = bar.getByRole("button", { name: "More" });
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "false");

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  for (const name of [
    "KPIs",
    "Spaces",
    "Board",
    "Initiatives",
    "Sessions",
    "Scorecard",
    "Admin",
  ]) {
    await expect(bar.getByRole("link", { name, exact: true })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toBeFocused();

  // A choice navigates and closes the sheet behind it.
  await more.click();
  await bar.getByRole("link", { name: "KPIs", exact: true }).click();
  await page.waitForURL(/\/kpis$/);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // On the screen it opened, More is where the reader is.
  await expect(more).toHaveClass(/text-brand-text/);
});
