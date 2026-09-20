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
 * The first-run wizard spec does not sign in as this account. It runs against
 * its own separate instance, one that has never been set up, which is the
 * entire point of the second database. It does share `skipOnboarding` below,
 * because both instances owe their first owner the same four questions.
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
 * The two messages Playwright uses for a navigation that was replaced.
 *
 * `net::ERR_ABORTED` is the one a `goto` gets when the browser drops it;
 * "interrupted by another navigation" is the one it gets when the application
 * itself starts a second navigation, which is what a client-side `router.push`
 * after hydration does. Neither says the page is broken, and both were read as
 * flakiness before this list existed (P5-T16, after `s22-weekly-digest` and
 * `s27-board` each failed once on that message).
 */
const SUPERSEDED = ["net::ERR_ABORTED", "interrupted by another navigation"];

function wasSuperseded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return SUPERSEDED.some((fragment) => message.includes(fragment));
}

/**
 * Navigates, retrying a navigation that was superseded rather than refused.
 *
 * Three retries, each after letting the interrupting navigation finish, and
 * only for the messages above: any other failure is thrown where it happened,
 * because a `goto` that fails for a real reason should say so on the first
 * attempt rather than four times over.
 *
 * **What interrupts it is the application arriving at the same address.** The
 * failures all read "interrupted by another navigation to <the same URL>":
 * the App Router settles a freshly loaded page with a navigation of its own,
 * and a `goto` issued inside that window loses. It is a race in the harness
 * rather than a defect in the page, which is why the answer is to wait and ask
 * again rather than to change what the page does.
 *
 * **A `goto` to the address the page is already on is a reload, and it stays
 * one.** Skipping it looked like the fix for `s27-board`'s collision with the
 * application's own navigation, and it broke five specs that reload a page to
 * prove a secret is not shown a second time. The collision is fixed where it
 * happens instead: a spec that is already where it wants to be does not ask.
 */
export async function goTo(
  page: import("@playwright/test").Page,
  url: string,
): Promise<void> {
  const attempts = 4;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      if (attempt === attempts - 1 || !wasSuperseded(error)) {
        throw error;
      }
      // **Let whatever superseded it finish before asking again.** Retrying
      // immediately races the same navigation and loses the same way, which
      // is how three attempts in a row failed on one run. Both waits are
      // bounded and both can fail while the page is mid-flight, so neither
      // is allowed to end the spec.
      await page
        .waitForLoadState("load", { timeout: 5_000 })
        .catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
}



/**
 * Skips every step of onboarding (S-34), synchronised on the wizard's own state.
 *
 * **The wizard is briefly mounted twice on arrival, and a click in that
 * window is a strict-mode violation.** A fresh owner reaches `/welcome`
 * through a chain: sign-up lands on `/`, and the front door answers with a
 * server redirect. Two navigations resolving into one segment is the case the
 * comment on `goTo` describes, the App Router settling a fresh page with a
 * navigation of its own, and since P8-G01 put a `loading.tsx` on this route
 * the segment sits behind a Suspense boundary, which is what lets the previous
 * subtree and the incoming one share the document for a moment. Playwright's
 * `getByTestId("welcome-skip")` then resolves to two buttons and refuses to
 * choose. The snapshot it saves shows one button and `1 / 5` a moment later,
 * so this is a window, not a state, and the click loop that used to live
 * in two specs fell into it on 15 September 2026, taking twenty-six sign-ins
 * with it because nobody had claimed the instance.
 *
 * So arrival is waited out before the first click, and every click after that
 * is placed against the progress counter rather than counted. A click that
 * landed on the subtree being torn down would leave the counter where it was,
 * and the next iteration says so in those terms instead of timing out on the
 * front door.
 *
 * **`template` is the one step that can be answered rather than skipped**
 * (P8-T12). The application instance skips it, because P6-G26's criterion is
 * that skipping everything lands on a working workspace at the documented
 * defaults, and that instance has one workspace to spend. The setup-wizard
 * instance answers it, because its workspace is otherwise unused and applying
 * a template is the only place the P8-T12 criterion can be walked in a
 * browser: an instance has no second workspace to make a fresh one in.
 */
export async function skipOnboarding(
  page: import("@playwright/test").Page,
  options: { readonly template?: "starter" } = {},
): Promise<void> {
  const { expect } = await import("@playwright/test");

  await expect(page).toHaveURL("/welcome");
  // The redirect chain has finished when its fetches have. This page is
  // outside the shell and polls nothing, so idle here means settled.
  await page.waitForLoadState("networkidle");
  const skip = page.getByTestId("welcome-skip");
  await expect(skip).toHaveCount(1);

  const steps = 5;
  // Fourth of five since P8-T12 put the starting templates before the demo.
  const templateStep = 4;
  for (let step = 1; step <= steps; step += 1) {
    await expect(page.getByTestId("welcome-progress")).toContainText(
      `${step} / ${steps}`,
    );
    if (step === templateStep && options.template) {
      await page.getByTestId(`template-${options.template}`).click();
      await page.getByTestId("welcome-continue").click();
      continue;
    }
    await skip.click();
  }
}
