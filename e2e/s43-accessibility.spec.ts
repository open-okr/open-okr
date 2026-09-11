import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * Every screen a signed-in member can open, checked against WCAG (P7-T05).
 *
 * **The list is derived, not written down.** A hand-maintained list of screens
 * is a list that stops matching the product: `route-coverage.test.ts` exists
 * because sixteen routes had no end-to-end path and nobody had noticed. This
 * walks `apps/web/app` the same way that test does, so a screen added tomorrow
 * is checked tomorrow without anybody remembering to add it here.
 *
 * **It fails on serious and critical only.** axe reports four impact levels
 * and the two below these are largely advisory (a redundant landmark, a
 * missing `lang` on a fragment). A gate that failed on all four would be
 * turned off within a month, which is worth less than a gate that holds.
 * `FATAL_IMPACTS` says so in one place rather than per screen.
 *
 * **What this cannot do.** axe finds roughly a third to a half of real
 * accessibility defects: it cannot tell whether a label makes sense, whether
 * focus order is logical, or whether a screen reader's announcement is
 * useful. The keyboard walkthrough in `s43b-accessibility-keyboard.spec.ts` and the
 * screen-reader procedure in `docs/design/p7-t05-accessibility.md` are the
 * other two thirds, and neither is replaced by this file.
 */

const APP = fileURLToPath(new URL("../apps/web/app", import.meta.url));

/**
 * Screens this file does not open, each with the reason.
 *
 * Same shape and same discipline as `route-coverage.test.ts`: a route with no
 * reason fails the count assertion below, at the moment somebody can still
 * write one.
 */
const NOT_CHECKED_HERE: Readonly<Record<string, string>> = {
  "/documents/[id]":
    "needs a document id, and the accessible surface is the editor which s29-documents drives directly",
  "/goals/[id]":
    "needs a goal id; the goal page is opened through a link in the goal specs and checked there",
  "/initiatives/[id]": "needs an initiative id, same reason as the goal page",
  "/kpis/[id]": "needs a KPI id, same reason as the goal page",
  "/session/[id]": "needs a live session, which sessions.spec.ts drives",
  "/session/[id]/minutes":
    "exists only once a session has closed, which sessions.spec.ts reaches",
  "/spaces/[id]": "needs a space id, reached by link from the spaces index",
  "/people/[id]": "needs a member id, reached by link from the directory",
  "/tasks/[id]": "needs a task id, reached by opening a card from the board",
  "/method/[id]":
    "needs a rule key, reached by following a rule citation from a coaching message",
  "/join/[token]":
    "needs an unused invite token, and s35-join opens the screen with a real one",
  "/reset-password":
    "needs a token from a delivered email, which this suite has no mailbox for",
  "/backup-code":
    "needs an enrolled second factor and one of its own codes",
  "/dev/components":
    "development only, and notFound() in production, so the built instance has nothing to open",
  "/dev/rich-text": "development only, the same as /dev/components",
  "/sign-up":
    "shut behind the first account, and the instance this suite runs against is already claimed",
  "/forgot-password":
    "unauthenticated, and its own half is covered in s35-join",
  "/sign-in": "unauthenticated, and every spec here signs in through it",
  "/setup":
    "the first-run wizard, which redirects on a claimed instance and has no app shell; first-run-wizard.spec.ts drives it on the unclaimed second instance",
  "/setup/account": "the second wizard step, same instance and same reason",
};

/** The impacts that fail the build. Advisory levels are reported, not fatal. */
const FATAL_IMPACTS = new Set(["serious", "critical"]);

/**
 * The findings this product already had when the gate was introduced.
 *
 * **The acceptance criterion is that continuous integration blocks a change
 * that *introduces* a serious finding**, and that is what a baseline does
 * precisely. Turning the gate on with no baseline gives two options, both
 * bad: fail the build on day one, or quietly widen what counts as serious
 * until it passes. This is the third option, and it is the one a linter
 * added to a mature codebase always takes.
 *
 * A rule listed here for a route is tolerated **on that route only**. The
 * same rule on any other screen fails, a different rule anywhere fails, and
 * an entry that stops occurring fails too, so the list can only shrink. It
 * is a debt register with a test attached, not an exemption.
 *
 * Regenerate after fixing some: `A11Y_WRITE_BASELINE=1 pnpm test:e2e --
 * registration-to-dashboard.spec.ts s43-accessibility.spec.ts`, then read the
 * diff before committing it. A baseline that grows in a commit is a
 * regression somebody has to justify in review.
 */
const BASELINE_PATH = fileURLToPath(
  new URL("./s43-accessibility-baseline.json", import.meta.url),
);
const WRITING_BASELINE = process.env.A11Y_WRITE_BASELINE === "1";

type Baseline = Record<string, string[]>;

function readBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    return {};
  }
}

const BASELINE = readBaseline();
/** Filled as the run goes, and written out only under the flag. */
const OBSERVED: Baseline = {};

function everyRoute(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".next") {
        continue;
      }
      found.push(...everyRoute(path));
      continue;
    }
    if (entry.name !== "page.tsx") {
      continue;
    }
    const relative = path
      .slice(APP.length + 1)
      .split(sep)
      .join("/");
    const segments = relative
      .replace(/\/?page\.tsx$/, "")
      .split("/")
      .filter((segment) => segment !== "" && !segment.startsWith("("));
    found.push(`/${segments.join("/")}`);
  }
  return found;
}

const ALL_ROUTES = everyRoute(APP).sort();
const CHECKED = ALL_ROUTES.filter(
  (route) => NOT_CHECKED_HERE[route] === undefined,
);

// **Not serial, deliberately.** A serial file stops at the first failing
// screen, so a run reports one finding and hides the other nineteen, and
// whoever is fixing them pays a full build and boot per screen. The suite
// runs single-worker anyway, so these still execute in order on one page.
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("the screen list is derived from the route tree and is not empty", () => {
  // The assertion that stops this whole file passing on a glob that matched
  // nothing, which is how a green accessibility gate ends up meaning nothing.
  expect(ALL_ROUTES.length).toBeGreaterThan(40);
  expect(CHECKED.length).toBeGreaterThan(20);
  expect(CHECKED).toContain("/goals");

  // And no excuse outlives the route it excused.
  const stale = Object.keys(NOT_CHECKED_HERE).filter(
    (route) => !ALL_ROUTES.includes(route),
  );
  expect(stale).toEqual([]);
});

for (const route of CHECKED) {
  test(`${route} has no serious accessibility findings`, async () => {
    await goTo(page, route);
    // The shell, so a screen that threw and rendered its error boundary is a
    // failure here rather than a clean scan of an error page.
    await expect(
      page.getByRole("navigation", { name: "Primary" }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // **Wait for the content, or the gate is a coin toss** (found while
    // writing it). Two runs of identical code produced baselines of two
    // routes and of twenty-three, because most of these screens are
    // client-owned (TECHNICAL-PLAN §13.3) and the shell paints long before
    // the table under it does. axe scanning a skeleton finds nothing and
    // reports a clean screen, which is worse than reporting a finding: it
    // makes the gate flaky in the direction of passing.
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {
        // A screen holding a subscription open never goes idle. The main
        // region check below is the real signal; this is the cheap one.
      });
    await expect(page.locator("main").first()).not.toBeEmpty({
      timeout: 15_000,
    });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const fatal = results.violations.filter((violation) =>
      FATAL_IMPACTS.has(violation.impact ?? ""),
    );
    // The message names the rule and the first element, because "3 violations"
    // sends the next person back to the browser to find out what.
    const ruleIds = [...new Set(fatal.map((violation) => violation.id))].sort();
    if (ruleIds.length > 0) {
      OBSERVED[route] = ruleIds;
    }
    if (WRITING_BASELINE) {
      return;
    }

    const allowed = new Set(BASELINE[route] ?? []);
    const introduced = fatal.filter(
      (violation) => !allowed.has(violation.id),
    );
    const described = introduced.map((violation) => {
      const node = violation.nodes[0];
      // axe's own summary carries the numbers a fix needs: the contrast
      // ratio it measured and the one it wanted, or which attribute is
      // missing. Without it the reader gets a rule name and a selector and
      // has to reproduce the whole run to learn anything.
      const why = (node?.failureSummary ?? "").replace(/\s+/g, " ").trim();
      return `${violation.impact} ${violation.id}: ${violation.help} (${node?.target.join(" ")}) ${why}`;
    });
    expect(
      described,
      `${route} has a serious accessibility finding that is not in the baseline`,
    ).toEqual([]);

    // The other direction: a rule the baseline still excuses on this route
    // but that no longer happens. Left in, it would excuse the defect again
    // the day somebody reintroduced it.
    const fixed = [...allowed].filter((id) => !ruleIds.includes(id));
    expect(
      fixed,
      `${route} no longer has these findings, so remove them from the baseline`,
    ).toEqual([]);
  });
}

test.afterAll(() => {
  if (!WRITING_BASELINE) {
    return;
  }
  const sorted = Object.fromEntries(
    Object.entries(OBSERVED).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
});
