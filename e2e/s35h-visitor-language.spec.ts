/**
 * A signed-out page speaks the browser's language (Q-8, plan 0.8.1).
 *
 * The 0.8.0 acceptance test found a Malay browser reading English sign-in and
 * confirmation pages. Decided by Akmal on 12 November 2026: signed out, the
 * browser's language when the product ships it, otherwise the instance's,
 * otherwise English. Signed in, the member's own choice and then the
 * workspace's still win.
 *
 * Acceptance criteria:
 *   Given a browser that asks for Malay, when it opens the sign-in page
 *   signed out, then the page is in Malay.
 *   Given a browser that asks only for a language the product does not ship,
 *   when it opens the sign-in page, then the page is in the instance's
 *   language, English on this instance.
 *   Given a member in a workspace on English, when they sign in from a Malay
 *   browser, then the screens are in English: the browser decides nothing
 *   once there is a member to ask.
 *
 * The header's own rules (weights, regions, malformed parts) are proved in
 * `apps/web/test/accept-language.test.ts`, and the order of the fallbacks in
 * `apps/web/test/locale.test.ts`.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe("a Malay browser", () => {
  test.use({ locale: "ms-MY" });

  test("reads the sign-in page in Malay", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "ms");
    await expect(
      page.getByRole("heading", { name: /^Log masuk ke / }),
    ).toBeVisible();
  });
});

test("signed in, the member's and the workspace's language still win over a Malay browser", async ({
  page,
  playwright,
  baseURL,
}) => {
  const malay = { "accept-language": "ms-MY,ms;q=0.9" };
  // Signed in from the suite's English browser, because `signIn` fills the
  // form by its English labels, which a Malay browser no longer reads. Then
  // every request asks for Malay, as a Malay browser's would.
  await signIn(page);
  await page.setExtraHTTPHeaders(malay);
  await goTo(page, "/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // The same header with no session does pick Malay, so the English above is
  // the member's and the workspace's answer rather than a header not sent.
  const visitor = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: malay,
  });
  try {
    const signInPage = await visitor.get("/sign-in");
    expect(await signInPage.text()).toMatch(/<html[^>]*\blang="ms"/);
  } finally {
    await visitor.dispose();
  }
});

test.describe("a browser asking for a language the product does not ship", () => {
  test.use({ locale: "fr-FR" });

  test("reads the sign-in page in the instance's language", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { name: /^Sign in to / }),
    ).toBeVisible();
  });
});
