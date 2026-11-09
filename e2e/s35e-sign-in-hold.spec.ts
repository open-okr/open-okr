/**
 * Holding password sign-in after too many failures (screen S-35,
 * docs/design/account-lockout.md, plan 0.7.0 P10).
 *
 * The acceptance criterion a person sees: five wrong passwords from one
 * address, and the sixth attempt shows the wait and a way to reset.
 *
 * **An address with no account, on purpose.** The answer is the same either
 * way (D5), which a unit test proves, so this spec never holds an account
 * another spec signs in with. And it carries its own caller address, from
 * RFC 5737's documentation range, so its six attempts count against nobody
 * else's share of the address limiter.
 */
import { expect, test } from "./fixtures.ts";

const NOBODY = `nobody-${Date.now()}@example.com`;

test("the sixth wrong password from one address shows the wait and a reset link", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "203.0.113.35" },
  });
  const page = await context.newPage();
  await page.goto("/sign-in");

  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password");
  const signIn = page
    .getByRole("button", { name: "Sign in", exact: true })
    .first();
  // The form's own alert. Next.js keeps a route announcer with the same
  // role on every page, so an unscoped one matches two.
  const alert = page.getByRole("main").getByRole("alert");
  // Each attempt waits for its own answer: the alert from the one before reads
  // the same, so waiting on the text alone could pass early.
  const attempt = async (guess: string) => {
    await email.fill(NOBODY);
    await password.fill(guess);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/auth/sign-in/email")),
      signIn.click(),
    ]);
    return response.status();
  };

  for (let index = 1; index <= 5; index++) {
    expect(await attempt(`not-the-password-${index}`)).toBe(401);
    await expect(alert).toHaveText(
      "Those details did not match. Check them and try again.",
    );
  }

  expect(await attempt("not-the-password-6")).toBe(429);
  await expect(alert).toContainText(
    "Too many attempts for this address. Try again in a minute, or",
  );
  const reset = alert.getByRole("link", { name: "reset your password." });
  await expect(reset).toHaveAttribute("href", "/forgot-password");

  await reset.click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await context.close();
});
