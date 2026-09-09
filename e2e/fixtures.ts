import {
  expect as baseExpect,
  type Locator,
  type Page,
  test as base,
} from "@playwright/test";

/**
 * The suite's own `test` and `expect`, which never assert against a document
 * that is still arriving (P6-G24c).
 *
 * **Why this exists.** A `loading.tsx` makes Next stream the segment behind a
 * Suspense boundary, and React resolves an out-of-order boundary by putting
 * the finished subtree in `<div hidden id="S:0">` at the end of the body, then
 * running an inline script that moves it where it belongs. Between those two
 * steps the document holds the content twice. Playwright's strict mode counts
 * every match including the hidden one, so an unscoped locator resolves to two
 * elements and fails.
 *
 * P6-G24a met that as "a duplicate render" it could not explain and pulled
 * twenty-two loading states back out. P6-G24c took a trace: the visible copy
 * in `main`, the second inside that hidden element. It is not a defect in the
 * product and nobody ever sees the staged copy.
 *
 * **Three attempts, and only the third converged.** Waiting inside `goTo` took
 * the run from 187 passing to 191: better and not closed, because plenty of
 * specs call `page.goto` directly. Patching `page.goto` and `page.reload` here
 * took it to 214, and scoping the failures that remained took it to 239 with a
 * *different* set failing each run. That is the tell: the offending set is not
 * stable, because a click the App Router handles also streams and no
 * navigation hook can see it. Fixing the ones that failed was never going to
 * finish.
 *
 * So the wait moved to where the question is actually asked. Every assertion
 * on a locator settles the document first, whatever navigated to it. The next
 * person to write a spec inherits that without knowing this file exists, which
 * is the point: a convention nobody is told about is a convention that lapses.
 *
 * **Bounded and never fatal.** A page with no Suspense boundary answers in one
 * round trip, and one still streaming after the timeout is a slow page rather
 * than a broken one, which the assertion itself reports better than this
 * could.
 */

const SETTLE_TIMEOUT_MS = 10_000;

async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => document.querySelector('div[hidden][id^="S:"]') === null,
      undefined,
      { timeout: SETTLE_TIMEOUT_MS },
    )
    .catch(() => undefined);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);

    // Kept alongside the assertion wrapper below rather than replaced by it: a
    // spec that navigates and then reads `page.url()` or takes a screenshot
    // asserts nothing, and should still see a finished document.
    page.goto = async (url, options) => {
      const response = await goto(url, options);
      await settle(page);
      return response;
    };
    page.reload = async (options) => {
      const response = await reload(options);
      await settle(page);
      return response;
    };

    await use(page);
  },
});

const isLocator = (value: unknown): value is Locator =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Locator).page === "function" &&
  typeof (value as Locator).elementHandle === "function";

/**
 * Wraps a matcher object so every matcher settles the page before running.
 *
 * `.not`, `.resolves` and `.rejects` are matcher objects of their own, so the
 * wrapper recurses into them rather than losing the wait on `expect(x).not`.
 */
function settling<T extends object>(matchers: T, page: Page): T {
  return new Proxy(matchers, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key === "not" || key === "resolves" || key === "rejects") {
        return typeof value === "object" && value !== null
          ? settling(value as object, page)
          : value;
      }
      if (typeof value !== "function") {
        return value;
      }
      return async (...args: unknown[]) => {
        await settle(page);
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as T;
}

export const expect = new Proxy(baseExpect, {
  apply(target, thisArg, args: unknown[]) {
    const matchers = Reflect.apply(target, thisArg, args);
    const [subject] = args;
    // Only a locator has a page to settle. Everything else — a string, a
    // number, a `page` for `toHaveURL` — goes straight through.
    return isLocator(subject)
      ? settling(matchers as object, subject.page())
      : matchers;
  },
}) as typeof baseExpect;
