import { expect, test } from "@playwright/test";

/**
 * The typeface is self-hosted, and stays that way.
 *
 * UIUX-PLAN.md §2 says Geist is self-hosted and PLAN.md requires an install
 * that works air-gapped. Both are easy to break without noticing: swapping
 * `next/font/local` back to `next/font/google`, or adding a stylesheet that
 * pulls a face from a CDN, leaves the product looking identical on a
 * developer machine with a network and broken on a customer's isolated one.
 *
 * Runs against the built standalone server, so it sees what ships.
 */
test("no request leaves this origin, and the font is ours", async ({
  page,
}) => {
  const external: string[] = [];
  const fonts: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(request.url());
    }
    if (url.pathname.includes(".woff")) {
      fonts.push(url.pathname);
    }
  });

  await page.goto("/sign-in");
  await page.evaluate(() => document.fonts.ready);

  // Not "no font CDN" — no third-party request of any kind.
  expect(external).toEqual([]);

  // One variable file covering 100 to 900, served by us. Nine static weights
  // would be nine requests, and a Google-hosted build would be none from here
  // and several from fonts.gstatic.com.
  expect(fonts).toHaveLength(1);
  expect(fonts[0]).toMatch(/^\/_next\/static\/media\/Geist_Variable/);
});

test("the face is really in use, not merely declared", async ({ page }) => {
  await page.goto("/sign-in");
  await page.evaluate(() => document.fonts.ready);

  const loaded = await page.evaluate(() =>
    [...document.fonts].map((face) => `${face.family}:${face.status}`),
  );
  expect(loaded).toContain("geistSans:loaded");

  const stack = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(stack.split(",")[0]).toContain("geistSans");

  // A declared-but-unloaded face silently falls back and every assertion above
  // still passes. Measuring the same string in both faces is what separates
  // "the CSS is right" from "the glyphs on screen are Geist".
  const { geist, fallback } = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.textContent = "Handgloves 0123456789";
    probe.style.cssText =
      "position:absolute;left:-9999px;font-size:40px;white-space:nowrap";
    document.body.append(probe);
    probe.style.fontFamily = "geistSans";
    const withGeist = probe.getBoundingClientRect().width;
    probe.style.fontFamily = "Arial";
    const withFallback = probe.getBoundingClientRect().width;
    probe.remove();
    return { geist: withGeist, fallback: withFallback };
  });

  expect(geist).toBeGreaterThan(0);
  expect(Math.abs(geist - fallback)).toBeGreaterThan(1);
});
