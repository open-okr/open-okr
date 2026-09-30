import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

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
  "/setup":
    "the first-run wizard, which redirects on a claimed instance and has no app shell; first-run-wizard.spec.ts drives it on the unclaimed second instance",
  "/setup/account": "the second wizard step, same instance and same reason",
  // **The four P8 screens this instance does not have** (P8-G01). The scan
  // walks the route tree, which is what makes a screen added tomorrow
  // scanned tomorrow, and it picked these up the moment P8 landed them. None
  // of the four renders here: the plan screen calls notFound() with the cloud
  // flag off, and an operator route answers not-found to anybody without a
  // live grant, which on a self-hosted instance is everybody, because
  // instance_operators holds no rows there by design (P8-T01b §7). The scan
  // was waiting fifteen seconds for an application shell that a 404 never
  // draws. Scanning them needs a cloud fixture, which is P8's own row.
  "/admin/plan":
    "cloud only, and notFound() with the flag off, so this instance does not have the screen",
  "/operator":
    "an operator route, and not-found to everybody on a self-hosted instance",
  "/operator/[workspaceId]":
    "an operator route, and not-found to everybody on a self-hosted instance",
  "/operator/instance":
    "an operator route, and not-found to everybody on a self-hosted instance",
};

/**
 * The detail screens, each opened on a real row (completeness review M-20).
 *
 * Twenty-six routes used to be skipped here as "needs an id", which was true
 * and was not a reason: the goal, key result, space, session, task, person and
 * initiative pages are where members spend their time. Each is now opened on
 * the first row of its kind in the instance account's workspace. The suite
 * runs in file order and earlier specs make every one of these, so a missing
 * row is a failure that names which, never a quiet skip.
 *
 * `$1` is the workspace. Read as the superuser, for the reason every spec here
 * records: the forced tenant policy would otherwise answer with nothing.
 */
const SESSION_IN_MY_SPACE = `select s.id::text as id
    from okr_sessions s
   where s.workspace_id = $1
     and s.deleted_at is null
     and (s.space_id is null
          or exists (select 1
                       from space_members sm
                       join workspace_members m on m.id = sm.member_id
                       join users u on u.id = m.user_id
                      where sm.space_id = s.space_id
                        and sm.deleted_at is null
                        and u.email = $2))`;

const DETAIL: Readonly<Record<string, string>> = {
  "/goals/[id]":
    "select id::text from goals where workspace_id = $1 and deleted_at is null order by created_at limit 1",
  "/initiatives/[id]":
    "select id::text from initiatives where workspace_id = $1 and deleted_at is null order by created_at limit 1",
  "/kpis/[id]":
    "select id::text from kpis where workspace_id = $1 and deleted_at is null order by created_at limit 1",
  "/spaces/[id]":
    "select id::text from spaces where workspace_id = $1 and deleted_at is null order by created_at limit 1",
  "/tasks/[id]":
    "select id::text from tasks where workspace_id = $1 and deleted_at is null order by created_at limit 1",
  "/people/[id]":
    "select id::text from workspace_members where workspace_id = $1 and deleted_at is null and kind = 'human' and status = 'active' order by created_at limit 1",
  // A session is its space's, and opens only for somebody in it (M-21), so
  // one in a space the account belongs to. `$2` is the account's email.
  "/session/[id]": `${SESSION_IN_MY_SPACE} order by s.created_at limit 1`,
  // The minutes are a quarterly review's record, a closed one first.
  "/session/[id]/minutes": `${SESSION_IN_MY_SPACE} and s.kind = 'quarterly' order by (s.state = 'closed') desc, s.created_at limit 1`,
  // A published document, which every reader may open; a draft is its
  // author's alone.
  "/documents/[id]":
    "select id::text from documents where workspace_id = $1 and deleted_at is null and state = 'published' order by created_at limit 1",
  // A rule is METHOD.md's, not a row: the first objective check.
  "/method/[id]": "select 'OBJ-1' as id",
};

/**
 * The two screens a visitor meets before signing in, scanned signed out.
 *
 * Every spec signs in through `/sign-in`, which made it the most visited page
 * in the suite and one this file never scanned.
 */
const SIGNED_OUT: readonly string[] = ["/sign-in", "/forgot-password"];

/** Screens drawn without the application shell, for a room rather than a desk. */
const FOCUS_SCREENS: readonly string[] = ["/session/"];

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

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
 * Regenerate after fixing some: `A11Y_WRITE_BASELINE=1 pnpm test:e2e`, then
 * read the diff before committing it. The whole suite rather than this file
 * alone, since M-20: the detail screens open on rows the earlier specs make. A baseline that grows in a commit is a
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
  (route) =>
    NOT_CHECKED_HERE[route] === undefined && !SIGNED_OUT.includes(route),
);

// **Not serial, deliberately.** A serial file stops at the first failing
// screen, so a run reports one finding and hides the other nineteen, and
// whoever is fixing them pays a full build and boot per screen. The suite
// runs single-worker anyway, so these still execute in order on one page.
let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let workspaceId: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  const member = await pool.query<{ workspace_id: string }>(
    `select m.workspace_id
       from workspace_members m
       join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null
      -- The workspace the account made, which is the one its browser opens:
      -- by the time this runs, other specs have made it a member of more.
      order by m.created_at
      limit 1`,
    [INSTANCE_ACCOUNT.email],
  );
  workspaceId = member.rows[0]?.workspace_id ?? "";
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

/** The url to open for a route: itself, or its detail page on a real row. */
async function urlFor(route: string): Promise<string> {
  const query = DETAIL[route];
  if (query === undefined) {
    return route;
  }
  const rows = await pool.query<{ id: string }>(
    query,
    query.includes("$2")
      ? [workspaceId, INSTANCE_ACCOUNT.email]
      : query.includes("$1")
        ? [workspaceId]
        : [],
  );
  const id = rows.rows[0]?.id;
  expect(
    id,
    `${route}: no row of its kind in the workspace, so an earlier spec that makes one did not run`,
  ).toBeTruthy();
  return route.replace(/\[[^\]]+\]/, id ?? "");
}

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

  // Every detail route either has its row or an excuse (M-20): a new
  // `[id]` screen joins the scan the day it lands, or says why not.
  const dynamic = CHECKED.filter((route) => route.includes("["));
  expect(dynamic.filter((route) => DETAIL[route] === undefined)).toEqual([]);
  expect(
    [...Object.keys(DETAIL), ...SIGNED_OUT].filter(
      (route) => !ALL_ROUTES.includes(route),
    ),
  ).toEqual([]);
});

/**
 * The words no screen may show, and axe's serious findings against the
 * baseline, for whatever is on the page now.
 */
async function assertAccessible(route: string, on: Page): Promise<void> {
  // **No screen tells a user that part of it arrives at a task**
  // (completeness review H-24). The first-run wizard said channels and AI
  // were "not in this build" long after both shipped, and the cycle phases
  // said "arrives at P4-T03". A plan task's id is a note between the people
  // building this, and a screen that shows one is showing the build rather
  // than the product. Checked on every screen this walks.
  const text = await on.locator("body").innerText();
  expect(
    text.match(/\bP[1-8]-[TG]\d+[a-z]?\b/g) ?? [],
    `${route} shows a plan task id`,
  ).toEqual([]);
  expect(text, `${route} says something is not in this build`).not.toMatch(
    /not in this build/i,
  );

  const results = await new AxeBuilder({ page: on })
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
  const introduced = fatal.filter((violation) => !allowed.has(violation.id));
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
}

for (const route of CHECKED) {
  test(`${route} has no serious accessibility findings`, async () => {
    await goTo(page, await urlFor(route));
    // The shell, so a screen that threw and rendered its error boundary is a
    // failure here rather than a clean scan of an error page. A session is
    // the one screen drawn without it, full width for the room, so there the
    // page's own heading is the sign, and it must not be the not-found one.
    if (FOCUS_SCREENS.some((prefix) => route.startsWith(prefix))) {
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("h1").first()).not.toHaveText("Not found");
    } else {
      await expect(
        page.getByRole("navigation", { name: "Primary" }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

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
    // A focus screen has no `main` of its own; its heading was waited for
    // above, and its content streams inside the same response.
    if (!FOCUS_SCREENS.some((prefix) => route.startsWith(prefix))) {
      await expect(page.locator("main").first()).not.toBeEmpty({
        timeout: 15_000,
      });
    }

    await assertAccessible(route, page);
  });
}

for (const route of SIGNED_OUT) {
  test(`${route}, signed out, has no serious accessibility findings`, async ({
    browser,
  }) => {
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(route);
    // These have no shell; the page's own heading is the sign it rendered.
    await expect(visitor.getByRole("heading").first()).toBeVisible({
      timeout: 15_000,
    });
    await assertAccessible(route, visitor);
    await visitorContext.close();
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
