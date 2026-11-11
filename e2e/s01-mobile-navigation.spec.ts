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

// Q-10b (0.8.0 acceptance test): the footer band was sticky on a phone too, so
// its two lines took 63px of every screen on top of the tab bar. On a phone
// it ends the page; on a wide screen it still stays put
// (s36q-version-footer.spec.ts).
test("on a phone the footer ends the page rather than staying on screen", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/");
  const footer = page.getByTestId("app-footer");
  await expect(footer).toBeAttached();
  await expect(footer).toHaveCSS("position", "static");
});

// Q-10c (0.8.0 acceptance test): at 390px the "Connect your AI agent" pill
// was wider than the screen and, centred, was cut off on both sides.
test.describe("at 390 pixels", () => {
  // A touch screen, so the close button's slot is open as on a phone: it has
  // no width until hover where something can hover.
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("the agent setup pill fits inside the screen, close button included", async ({
    page,
  }) => {
    await signIn(page);
    await goTo(page, "/");
    const pill = page.getByTestId("agent-setup-pill");
    await expect(pill).toBeVisible({ timeout: 10_000 });

    for (const part of [
      pill.getByRole("button", { name: /Connect your AI agent/ }),
      pill.getByRole("button", { name: "Hide for this session" }),
    ]) {
      const box = await part.boundingBox();
      if (!box) {
        throw new Error("A part of the pill has no box to measure.");
      }
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    // And the content pane does not scroll sideways. `main` scrolls on its
    // own, so an overflow lands there rather than on the document.
    const pane = await page.evaluate(() => {
      const main = document.getElementById("main-content");
      return { scroll: main?.scrollWidth ?? 0, client: main?.clientWidth ?? 0 };
    });
    expect(pane.scroll).toBeLessThanOrEqual(pane.client);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});
