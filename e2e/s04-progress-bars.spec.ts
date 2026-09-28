/**
 * Every progress bar draws the value it announces (completeness review H-15).
 *
 * A bar's width is an inline `style` attribute, and the production content
 * security policy refused every inline attribute, so on a server-rendered page
 * the browser dropped the width and the bar filled its whole track: 0% drew
 * as 100%. Development allowed inline styles for the bundler, so nobody saw
 * it, and no test ever compared what a bar says with what it draws. This one
 * does, against the standalone server, which serves the production policy.
 *
 * The cycle screen always carries at least one bar, the phase rail's own
 * completion, and a cycle that has just begun is nowhere near full.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test("every progress bar draws the value it announces", async ({ page }) => {
  // No animation to wait out: a bar that grows on mount is measured grown.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);

  for (const path of ["/cycle", "/"]) {
    await goTo(page, path);
    const bars = page.locator('[role="progressbar"]');
    if (path === "/cycle") {
      await expect(bars.first()).toBeVisible();
    }

    const measured = await bars.evaluateAll((elements) =>
      elements.map((track) => {
        const fill = track.firstElementChild as HTMLElement | null;
        const max = Number(track.getAttribute("aria-valuemax") ?? "100");
        const now = Number(track.getAttribute("aria-valuenow") ?? "0");
        const trackWidth = track.getBoundingClientRect().width;
        return {
          label: track.getAttribute("aria-label") ?? "",
          expected: max > 0 ? now / max : 0,
          drawn:
            fill && trackWidth > 0
              ? fill.getBoundingClientRect().width / trackWidth
              : null,
        };
      }),
    );

    for (const bar of measured) {
      if (bar.drawn === null) {
        continue;
      }
      // A rounded end cap and whole pixels allow a little; a bar at 0% drawn
      // across its whole track is off by a hundred percent.
      expect(
        Math.abs(bar.drawn - bar.expected),
        `${path}: "${bar.label}" announces ${Math.round(bar.expected * 100)}% and draws ${Math.round(bar.drawn * 100)}%`,
      ).toBeLessThan(0.05);
    }
  }
});

test("the page is served with a policy that allows style attributes and still nonces style elements", async ({
  page,
}) => {
  const response = await page.goto("/sign-in");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("style-src-attr 'unsafe-inline'");
  expect(policy).toMatch(/style-src 'self' 'nonce-[^']+'/);
});
