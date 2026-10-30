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
  // Five areas since the OKRGoal UX review (navigation-five-areas.md): Home,
  // Updates, Goals and Work are the tabs, and the sheet holds the rest. KPIs,
  // the Board and the Inbox are tabs inside their areas, and Admin is in the
  // avatar menu. The claimer administers, so Cycle is theirs to see.
  for (const name of ["Spaces", "Cycle"]) {
    await expect(bar.getByRole("link", { name, exact: true })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toBeFocused();

  // A choice navigates and closes the sheet behind it.
  await more.click();
  await bar.getByRole("link", { name: "Spaces", exact: true }).click();
  await page.waitForURL(/\/spaces$/);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // On the screen it opened, More is where the reader is.
  await expect(more).toHaveClass(/text-brand-text/);
});
