import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Registration to dashboard, in a real browser (P1-T08).
 *
 * The one path that touches everything Phase 1 built: Better Auth creates the
 * account, the after-create hook provisions a workspace through the Operation
 * pipeline, the tenant floor scopes the request, and the dashboard reads it
 * back through the action contract registry.
 *
 * The instance is fresh for every run, so this file gets the single
 * registration an unclaimed instance allows. That is also why one browser
 * context is shared across these tests rather than Playwright's default of a
 * clean context each time: there is one account, and this is its session.
 */

const EMAIL = "ada@example.com";
const PASSWORD = "correct horse battery staple";
const NAME = "Ada Lovelace";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test("registering provisions a workspace and lands on the dashboard", async () => {
  await page.goto("/sign-up");

  await page.getByLabel("Name").fill(NAME);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Provisioning runs between the account committing and this page rendering,
  // so arriving here at all means the workspace and its first member exist.
  await expect(page).toHaveURL("/");
  // The Work Map is the front door from P3-T11. It replaced the proving
  // dashboard P1-T08 put here, which asserted a "Signed in as" panel and two
  // `<strong>` elements; that panel was scaffolding and STATUS.md said so from
  // the start. What still has to be true is the same thing it was proving:
  // provisioning ran between the account committing and this page rendering, so
  // a named workspace exists and the member is inside it.
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible();
  await expect(
    page.getByText(`${NAME}'s workspace`).first(),
  ).toBeVisible();
  // A brand new workspace has no goals, and the map says so with the way out
  // rather than an empty box.
  await expect(page.getByText("Nothing in this cycle yet.")).toBeVisible();

  // The context strip and the statistics, which the front door gained when it
  // was drawn to its mockup. A workspace with nothing in it reads "not yet"
  // rather than zero, because zero is an answer and this is the absence of one.
  await expect(page.getByText(/Phase 1/)).toBeVisible();
  await expect(page.getByText("no measures yet")).toBeVisible();
  await expect(page.getByText("not scored yet")).toBeVisible();
  // The scope tabs: the company, then the default space provisioning made.
  await expect(page.getByRole("navigation", { name: "Scope" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Company", exact: true }),
  ).toBeVisible();
});

test("the front door shows what provisioning resolved, with nothing configured", async () => {
  await page.goto("/");

  // This used to read the §4.14 defaults off the proving dashboard's definition
  // list: timezone UTC, state active, primary channel email. P3-T11 replaced
  // that page with the Work Map, so the same property is proven by what the map
  // itself needs to exist at all. Nobody chose this cycle: provisioning
  // generated it from the rhythm settings, which is what "no setting must be
  // answered before the product is usable" means in practice.
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Q[1-4] \d{4}$/ })).toBeVisible();
  // And the three ways out of it, which is the front door's other job.
  await expect(
    page.getByRole("link", { name: "Filter and search in the explorer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "See the cascade" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "What you owe" })).toBeVisible();
});

test("hydrates, so a write happens without loading a new document", async () => {
  await page.goto("/admin/general");

  // A hydrated React form posts the server action in the background and
  // patches the result in. An unhydrated one does a plain form POST and the
  // browser loads a new document. Counting loads is what tells them apart,
  // which is how "server-rendered with client hydration" gets proved rather
  // than assumed.
  let documentLoads = 0;
  page.on("load", () => {
    documentLoads++;
  });

  // The workspace rename this used to drive lived on the proving dashboard,
  // which P3-T11 replaced. Admin general is where a workspace setting is edited
  // now, and it is the same kind of proof: a real form, a real write, and the
  // page still standing afterwards without the browser fetching a document.
  await page.getByLabel("Language").fill("en");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByLabel("Language")).toBeVisible();
  expect(documentLoads).toBe(0);
});

test("both seeded agents are in admin, with their schedules and an empty log", async () => {
  // P4-T05a seeded the Champion and P4-T06a the Coach. Both are created at
  // provisioning, so a workspace that has answered no questions still has
  // both, and this is the page that says what they are and what they have
  // done.
  //
  // **Scoped per row rather than per page.** This test asserted a bare
  // `getByText("propose")` while one agent existed; the moment a second was
  // seeded it matched twice and Playwright refused it under strict mode. Both
  // agents propose and neither is "the" one, so every assertion below names
  // the row it is about.
  await page.goto("/admin/agents");

  await expect(
    page.getByRole("heading", { name: "Agents and runs" }),
  ).toBeVisible();

  const champion = page
    .getByRole("listitem")
    .filter({ hasText: "OKR Champion" });
  await expect(champion).toHaveCount(1);
  await expect(champion.getByText("On the hour")).toBeVisible();
  await expect(champion.getByText("propose")).toBeVisible();

  const coach = page.getByRole("listitem").filter({ hasText: "OKR Coach" });
  await expect(coach).toHaveCount(1);
  await expect(coach.getByText("On every write")).toBeVisible();
  await expect(coach.getByText("propose")).toBeVisible();

  // Nothing schedules a run on this instance, and the page says so rather
  // than showing an empty list that reads like a bug.
  await expect(page.getByText(/No run yet/)).toBeVisible();
});

test("registration is closed once the instance has been claimed", async () => {
  await page.goto("/sign-up");
  await expect(page.getByText(/invitation-only/i)).toBeVisible();
});

test("the first paint is server-rendered, with no JavaScript at all", async ({
  browser,
}) => {
  // The dashboard's own session, carried into a context with JavaScript
  // switched off entirely. Whatever appears came from the server, which is the
  // other half of the hydration claim: the content is there before React runs,
  // not painted by it.
  //
  // The session is reused rather than signed in again because the S-35 screens
  // drive authentication through the client, so they need JavaScript. That is
  // a property of those screens, not of this page, and mixing the two would
  // make this test prove neither.
  const plain = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await context.storageState(),
  });
  const plainPage = await plain.newPage();
  try {
    await plainPage.goto("/");
    const html = await plainPage.content();
    // The Work Map, rendered by the server before React runs. The workspace name
    // and the heading are both in the markup; nothing here was painted by a
    // client bundle, because there is no client bundle running.
    expect(html).toContain("Work map");
    expect(html).toContain(NAME);
  } finally {
    await plain.close();
  }
});

/**
 * The cycle workspace (P3-T03). Same session, because the instance allows one
 * registration and this is its account.
 *
 * What only a browser can settle here: the eight phases render from computed
 * completion rather than a stored flag, ticking a pack item moves the count
 * through the Operation pipeline and back, and opening a blocked phase names
 * what is blocking it. That last one is the task's acceptance criterion.
 */
test("the cycle workspace computes the eight phases from the rows", async () => {
  await page.goto("/cycle");

  await expect(
    page.getByRole("heading", { name: "Phase 1 · Prepare" }),
  ).toBeVisible();
  // A quarterly cycle, so phase 0 does not apply. Three states, not two.
  await expect(
    page.getByRole("img", { name: "Phase 0 does not apply to this cycle" }),
  ).toBeVisible();
  // Every word of the guidance comes from packages/method.
  await expect(
    page.getByText("Refuse to run Phase 4 without a complete input pack"),
  ).toBeVisible();
});

test("ticking a pack item moves the count", async () => {
  await page.goto("/cycle");

  await expect(page.getByText("0 of 7", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: 'Mark "Mission, vision and current strategy documents" as gathered',
    })
    .click();
  await expect(page.getByText("1 of 7", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 10", { exact: true })).toBeVisible();

  // It is a row in the database, not component state: a fresh document reads
  // the same answer back.
  await page.reload();
  await expect(page.getByText("1 of 7", { exact: true })).toBeVisible();
});

test("opening phase 4 names what is blocking drafting", async () => {
  // The acceptance criterion: "Given a quarterly cycle whose input pack has two
  // items missing, when the facilitator opens Phase 4, then drafting is blocked
  // with the two missing items named and a link to gather them."
  await page.goto("/cycle?phase=4");

  await expect(page.getByText("This phase is blocked by earlier work")).toBeVisible();
  await expect(
    page.getByText(/Input pack item 4 is missing: Customer feedback/),
  ).toBeVisible();
  await expect(
    page.getByText(/Input pack item 7 is missing: Open risks/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go and gather what is missing" }).click();
  await expect(page).toHaveURL("/cycle?phase=1");
});

/**
 * Goals and key results (P3-T04).
 *
 * The task's acceptance criterion end to end: a goal with a champion, a reviewer
 * and key results persists at zero percent and pending, and closing it requires
 * and produces a retrospective. The refusal is checked on the server rather than
 * through the browser's own `required` attribute, which would never let the
 * request leave.
 */
test("drafting a goal with key results persists at zero percent and pending", async () => {
  await page.goto("/cycle?phase=4");

  await page
    .getByRole("textbox", { name: "The objective" })
    .fill("Make mobile the way our customers prefer to reach us");
  await page
    .getByRole("textbox", { name: "What it contributes to" })
    .fill("Carries the annual mobile thrust");
  await page.getByRole("button", { name: "Add objective" }).click();

  // Level 2, because the quality panel in the rail groups its issues under an
  // h3 carrying the same title. Two headings with one name is the panel doing
  // its job, not an ambiguity worth removing.
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Make mobile the way our customers prefer to reach us",
    }),
  ).toBeVisible();

  for (const [title, baseline, target] of [
    ["Raise mobile activation from 41% to 60%", "41", "60"],
    ["Cut median first response from 6h to 2h", "6", "2"],
  ] as const) {
    await page.getByRole("textbox", { name: "The key result" }).fill(title);
    await page.getByRole("spinbutton", { name: "Baseline" }).fill(baseline);
    await page.getByRole("spinbutton", { name: "Target" }).fill(target);
    await page.getByRole("button", { name: "Add key result" }).click();
    // Exact, because the row's own title is also inside the label of the field
    // that records a new value for it.
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  // The current value starts at the baseline, so progress is 0 rather than
  // undefined, and health is pending because no check-in has been published.
  // The progress bar carries the number as an accessible value, which is a
  // single element where the rendered "0%" is not.
  await expect(page.getByText("pending")).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});

/**
 * The Draft Coach (P4-T02b).
 *
 * The acceptance criterion end to end: an objective beginning with an output
 * verb fails its rule inline, with the coaching prompt and the §4.6 example, and
 * the strength score drops. Driven through the browser rather than the unit
 * suite because the thing worth proving is that the browser evaluates at all:
 * the same package, the workspace's own thresholds, and no round trip.
 */
test("the coach fails a rule as you type, and the score moves with it", async () => {
  await page.goto("/cycle?phase=4");

  const title = page
    .getByRole("textbox", { name: /Objective, checked as you type/ })
    .first();
  await expect(title).toBeVisible();

  const meter = page.getByText(/OKR strength ·/).first();
  const before = (await meter.textContent()) ?? "";

  await title.fill("Launch the new mobile app");

  // OBJ-1 fires on the output verb, with no save and no request.
  const chip = page
    .getByRole("button", { name: "OBJ-1 · Outcome, not output" })
    .first();
  await expect(chip).toBeVisible();
  expect((await meter.textContent()) ?? "").not.toBe(before);

  // The card carries the prompt, what was seen, and §4.6's pair.
  await chip.click();
  await expect(
    page.getByText(/Your objective starts with a deliverable, not a destination/),
  ).toBeVisible();
  await expect(page.getByText(/What was seen\./)).toBeVisible();
  // The weak half of §4.6's pair, not the strong half: the strong half is the
  // sentence the drafting test above used as its objective, so asserting it
  // here would match the goal's own heading as well as the card.
  await expect(
    page.getByText(/Launch the new mobile app by end of Q3/),
  ).toBeVisible();

  // Every verdict links to the rule itself.
  await page.getByRole("link", { name: "See the rule in METHOD" }).first().click();
  await expect(page).toHaveURL("/method/OBJ-1");
  await expect(
    page.getByRole("heading", { name: "OBJ-1 · Outcome, not output" }),
  ).toBeVisible();
  await expect(page.getByText("How it judges, in order")).toBeVisible();
});

/**
 * The quality panel (P4-T02c).
 *
 * The acceptance criterion: every open issue across the set, grouped by its
 * objective, each linking at the field that fixes it. The link is the half worth
 * driving in a browser: an issue list that lands somebody at the top of a page
 * has moved the work of finding the row from the panel to the reader.
 */
test("the quality panel groups every issue and links at the field", async () => {
  await page.goto("/cycle?phase=4");

  const panel = page.getByRole("region").filter({ hasText: "Quality panel" });
  await expect(
    page.getByRole("heading", { name: "Quality panel" }),
  ).toBeVisible();
  await expect(page.getByText(/issues? across .* objectives?/)).toBeVisible();

  // Grouped under the objective they belong to.
  await expect(
    panel.getByRole("heading", {
      name: "Make mobile the way our customers prefer to reach us",
    }),
  ).toBeVisible();

  // KR-3 fires on both key results: neither carries a date or an owner.
  const issue = panel.getByRole("link", { name: /KR-3/ }).first();
  await expect(issue).toBeVisible();
  const href = await issue.getAttribute("href");
  expect(href).toMatch(/#kr-/);

  await issue.click();
  // The anchor resolves to a real row rather than to the top of the page.
  const anchored = (href ?? "").split("#")[1] ?? "";
  await expect(page.locator(`[id="${anchored}"]`)).toBeVisible();
});

test("closing a goal requires a retrospective and keeps it on reopen", async () => {
  await page.goto("/cycle?phase=4");
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/goals\//);

  // The server refuses an empty retrospective. The textarea's own `required`
  // would stop the request, so the field is filled with whitespace, which passes
  // the browser and fails the rule.
  await page.getByRole("textbox", { name: "The retrospective" }).fill("   ");
  await page.getByRole("button", { name: "Close this goal" }).click();
  // Filtered rather than the bare role: Next's own route announcer is also an
  // alert, so the page has two and only one of them is ours.
  await expect(
    page.getByRole("alert").filter({ hasText: "retrospective" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "The retrospective" })
    .fill("Activation moved. Onboarding did the work, not the campaign.");
  await page.getByRole("button", { name: "Close this goal" }).click();

  await expect(page.getByText("closed · achieved")).toBeVisible();
  await expect(
    page.getByText("Activation moved. Onboarding did the work"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reopen this goal" }).click();
  // Exact: the page also explains that every goal reads pending until P3-T05.
  await expect(page.getByText("pending", { exact: true })).toBeVisible();
  // The account of what happened survives the reopen.
  await expect(
    page.getByText("Activation moved. Onboarding did the work"),
  ).toBeVisible();
});

/**
 * The check-in walker (P3-T07).
 *
 * What a browser settles here is that the walker reports honestly rather than
 * inventing work: it lists only goals the reader champions that are due, and a
 * goal reached directly shows its own history even when it is not.
 *
 * The publish path is deliberately not driven from here. Making a goal due needs
 * the database, which this suite has no access to by design, and a goal created
 * today with a Monday anchor is due next Monday, so the assertion would pass or
 * fail depending on the day it ran. That path is covered by the core suite against
 * real rows instead.
 */
test("the check-in walker lists only what is actually due", async () => {
  await page.goto("/check-in");

  await expect(page.getByRole("heading", { name: "Check in" })).toBeVisible();
  // The goal created earlier is due next Monday, so nothing is inside the
  // two-day window and the walker says so rather than offering it.
  await expect(page.getByText("Nothing of yours is due.")).toBeVisible();
  await expect(page.getByText("0 due")).toBeVisible();
});

test("a goal reached directly shows its history and refuses a draft", async () => {
  await page.goto("/cycle?phase=4");
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/goals\//);
  const goalId = new URL(page.url()).pathname.split("/").pop() as string;

  await page.goto(`/check-in?goal=${goalId}`);
  await expect(page.getByText("This goal is not due")).toBeVisible();
  // No composer, because opening one on a goal already reported on would leave an
  // empty draft behind every time somebody looked at the page.
  await expect(
    page.getByRole("button", { name: "Publish" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Check-in history" }),
  ).toBeVisible();
});

/**
 * The review inbox (P3-T08, S-02).
 *
 * What only a browser settles: that the obligation is computed from the goal
 * created earlier in this file and reaches the screen with an action attached,
 * and that the four sources no phase has built are named on the page rather than
 * quietly missing.
 *
 * The acknowledgement half is not driven here, for the reason P3-T07 recorded
 * about publishing: it needs a goal that is actually due, and a goal created
 * today with a Monday anchor is due next Monday, so the assertion would pass or
 * fail depending on the day it ran. The core suite covers that path against real
 * rows, including the reassignment case no browser test could set up.
 */
test("the review inbox lists what this member owes, with an action on each", async () => {
  await page.goto("/review");

  await expect(
    page.getByRole("heading", { name: "What you owe", level: 1 }),
  ).toBeVisible();

  const row = page.getByText(
    'Post your check-in on "Make mobile the way our customers prefer to reach us"',
  );
  await expect(row).toBeVisible();
  // Scoped to `main`: the sidebar's own nav item is also called "Check in", and
  // an unscoped role locator matches both. Worth keeping as a named collision
  // rather than renaming either, because both labels are the right words.
  await expect(
    page.getByRole("main").getByRole("link", { name: "Check in" }),
  ).toBeVisible();

  // Named, not hidden. A page that showed two of six sources without saying so
  // would look complete while failing to mention a blocker somebody owns.
  await expect(page.getByText("Blockers you own")).toBeVisible();
  await expect(page.getByText("Sessions to run")).toBeVisible();
});

test("the review action opens the composer for that goal", async () => {
  await page.goto("/review");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Check in" })
    .first()
    .click();
  // The goal id, not the bare walker: the row's action opens the goal it names.
  await expect(page).toHaveURL(/\/check-in\?goal=/);
});

/**
 * The KPI recovery loop, end to end (P3-T14, METHOD.md §6.4 to §6.6).
 *
 * The database-backed suite proves the drafter against rows. What only a
 * browser can settle is that the three screens agree with each other: a value
 * typed into the grid puts the KPI on the recovery board, one click there
 * produces a real objective, and the tree draws the result.
 */
test("a KPI recorded below the corridor reaches the recovery board", async () => {
  await page.goto("/kpis");
  await page.getByLabel("What is being measured").fill("Operating margin");
  await page.getByLabel("Standing target").fill("100");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add", exact: true })
    .first()
    .click();

  // The period the cell belongs to is the workspace's own answer, so the
  // locator matches on the KPI rather than on a date this spec would have to
  // compute the same way the server does.
  const cell = page.getByRole("textbox", {
    name: /^Operating margin, period beginning/,
  });
  await expect(cell).toBeVisible();
  await cell.fill("60");
  await cell.press("Enter");

  // Wait for the standing figure to come back before leaving the page. Enter
  // commits through a server action, and navigating while it is still in
  // flight abandons it: the value never lands, the KPI stays at no data, and
  // the recovery board is empty for a reason that has nothing to do with the
  // recovery board. It passed here in under a second and failed on a CI runner
  // at the full ten-second timeout, which is what a race looks like from the
  // outside.
  await expect(
    page.getByRole("row").filter({ hasText: "Operating margin" }),
  ).toContainText("60%");

  await page.goto("/kpis/recovery");
  await expect(
    page.getByRole("heading", { level: 2, name: "Operating margin" }),
  ).toBeVisible();
  // Sixty of a hundred is below the seventy percent watch floor.
  await expect(page.getByText("unhealthy").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Launch recovery" }),
  ).toBeVisible();
});

test("launching recovery creates the objective and flips the KPI", async () => {
  await page.goto("/kpis/recovery");
  await page.getByRole("button", { name: "Launch recovery" }).click();

  // The objective is named from the KPI and its target, per METHOD.md §6.5.
  await expect(
    page.getByRole("link", { name: "Bring Operating margin back to 100" }),
  ).toBeVisible();
  await expect(page.getByText("recovering").first()).toBeVisible();
  // The subtree holds no leading driver yet, so §6.5's placeholder is the one
  // key result rather than the product inventing a driver nobody named.
  await expect(page.getByText("1 key result")).toBeVisible();
});

test("the tree draws the driver added under a node, and the detail reads it back", async () => {
  await page.goto("/kpis/trees?tree=none");
  const row = page.getByRole("listitem").filter({ hasText: "Operating margin" });
  await row.getByRole("link", { name: "add driver" }).click();

  await page.getByLabel("What the driver measures").fill("Qualified leads");
  await page.getByRole("button", { name: "Add the driver" }).click();

  const driver = page.getByRole("listitem").filter({ hasText: "Qualified leads" });
  await expect(driver).toBeVisible();
  // A driver is leading and input tier: something a team can act on this week.
  await expect(driver.getByText("leading · input")).toBeVisible();

  await driver.getByRole("link", { name: "open" }).click();
  await expect(page).toHaveURL(/\/kpis\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Qualified leads" }),
  ).toBeVisible();
  // The corridor is stated in words, not only in colour.
  await expect(page.getByText(/healthy at 90%, watch at 70%/)).toBeVisible();
  await expect(page.getByText("Nothing recorded yet.")).toBeVisible();
});

test("signing out ends the session", async () => {
  await page.goto("/");
  // The app shell (P2-T10) moved sign-out behind the topbar's avatar menu.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a signed-out request never reaches the dashboard", async ({ browser }) => {
  const stranger = await browser.newContext();
  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/");
    await expect(strangerPage).toHaveURL(/\/sign-in/);
  } finally {
    await stranger.close();
  }
});
