/**
 * The account that claims the application instance in the end-to-end run.
 *
 * **Why one shared constant rather than a constant per spec.** The suite runs
 * `workers: 1, fullyParallel: false` against a single application instance that
 * `e2e/prepare-database.ts` deliberately leaves unclaimed, "so it stays open
 * until a spec claims it". Whichever spec runs first claims it, registration
 * closes behind them, and every later spec can only sign in as that same
 * person. Files run alphabetically, so today that is
 * `registration-to-dashboard.spec.ts`.
 *
 * That coupling already existed and was invisible: `sessions.spec.ts` was
 * written for a developer's own machine, where its author had run the wizard
 * with `session-qa@example.com`, and it signed in with that address. On
 * continuous integration the instance belongs to somebody else, so the sign-in
 * failed and the whole file failed with it, from the day it landed. The
 * passwords were already identical; only the address differed, which is exactly
 * the kind of accidental agreement a shared constant turns into a real one.
 *
 * The first-run wizard spec is not a caller. It runs against its own separate
 * instance, one that has never been set up, which is the entire point of the
 * second database.
 */

/**
 * The signed-in cookies, kept for the rest of the run (P5-T07a).
 *
 * A module variable rather than a file, because the suite runs single-worker in
 * one process and nothing outside it should inherit a session.
 */
let cachedState: Awaited<
  ReturnType<import("@playwright/test").BrowserContext["storageState"]>
>["cookies"] | null = null;

/** The person every application-instance spec signs in as. */
export const INSTANCE_ACCOUNT = {
  email: "ada@example.com",
  password: "correct horse battery staple",
  name: "Ada Lovelace",
} as const;

/**
 * Signs in as that person, and refuses to be the one who claims the instance.
 *
 * **The claim belongs to exactly one spec, and it is not this function's.**
 * `registration-to-dashboard.spec.ts` claims it, and its first test *is* the
 * registration path: a spec that registered before it turns that test red,
 * because `/sign-up` is shut behind the first account. Learned by doing it:
 * `copilot.spec.ts` sorted before `registration-` and broke it, which is why
 * that file is now `s39-copilot.spec.ts`.
 *
 * So a spec that runs before the claimer gets a clear failure naming the rule,
 * rather than quietly claiming and breaking a file somewhere else. Order still
 * matters and is still alphabetical; what changes is that getting it wrong says
 * so.
 *
 * Not yet used by `reviews.spec.ts` or `sessions.spec.ts`, which still carry
 * their own sign-in. Both would be better for adopting it, and neither is this
 * task's to change.
 */
export async function signIn(
  page: import("@playwright/test").Page,
): Promise<void> {
  const { expect } = await import("@playwright/test");

  // **Authenticate once for the whole run, then reuse the cookies.**
  // Better Auth allows ten sign-ins per address per minute (TECHNICAL-PLAN
  // §8.2, and P2-T09 built it), the suite runs `workers: 1` in one process, and
  // by P5-T07a ten spec files sign in as the same person. The eleventh gets
  // refused, and the failure lands on whichever file happens to be running,
  // which is how this looked like flakiness in `sessions.spec.ts` twice.
  // Restoring the cookies is what a browser does anyway, and it means the
  // limit is exercised by the specs that are about it rather than by every
  // other spec's setup.
  if (cachedState) {
    await page.context().addCookies(cachedState);
    await page.goto("/");
    if (!page.url().includes("/sign-in")) {
      await page.waitForLoadState("load");
      return;
    }
    // The session went away. Fall through and authenticate again.
    cachedState = null;
  }

  await page.goto("/");

  if (page.url().includes("/setup")) {
    throw new Error(
      "This instance has never been set up. The wizard spec runs against its " +
        "own instance; an application spec must not claim this one.",
    );
  }
  if (!page.url().includes("/sign-in")) {
    // Already signed in, which is what a second call in the same context sees.
    return;
  }

  await page.getByLabel("Email").fill(INSTANCE_ACCOUNT.email);
  await page.getByLabel("Password").fill(INSTANCE_ACCOUNT.password);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();

  await page.waitForURL("/", { timeout: 10_000 }).catch(() => {
    throw new Error(
      "Nobody has claimed this instance yet, so there is no account to sign " +
        "in as. An application spec must sort after " +
        "registration-to-dashboard.spec.ts, which is the one that registers.",
    );
  });
  await expect(page).toHaveURL("/");
  // **Settled, not merely arrived.** `waitForURL` resolves while the sign-in
  // navigation is still finishing, and a `goto` issued in the next line then
  // supersedes it and fails with `net::ERR_ABORTED`. Two specs hit that on
  // separate runs before this line existed.
  await page.waitForLoadState("load");
  cachedState = (await page.context().storageState()).cookies;
}

/**
 * Navigates, retrying once.
 *
 * `net::ERR_ABORTED` means a navigation was superseded rather than a page that
 * does not work, and it happens on a first `goto` after signing in. The
 * assertion that follows a `goto` is what proves the page loaded; this only
 * stops a race deciding whether the spec runs at all.
 */
export async function goTo(
  page: import("@playwright/test").Page,
  url: string,
): Promise<void> {
  await page.goto(url).catch(async () => {
    await page.goto(url);
  });
}
