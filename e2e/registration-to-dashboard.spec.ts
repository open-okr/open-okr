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
  // The heading role, not a text match. `getByText("Signed in as")` matched two
  // elements under Playwright 1.62: the panel streams in behind a Suspense
  // boundary, and for an instant the pre-hydration and post-hydration headings
  // both exist. The role locator names one element and cannot race that.
  await expect(
    page.getByRole("heading", { level: 1, name: /Signed in as/ }),
  ).toBeVisible();
  // Exact, because "Ada Lovelace" is also a prefix of the workspace name
  // and a loose match would find two elements.
  await expect(
    page.getByRole("strong").filter({ hasText: new RegExp(`^${NAME}$`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("strong").filter({ hasText: `${NAME}'s workspace` }),
  ).toBeVisible();
});

test("the dashboard shows what the registry action returned", async () => {
  await page.goto("/");

  // None of these were chosen by anybody: provisioning resolved them from the
  // §4.14 settings map, which is what "no setting must be answered before the
  // product is usable" means in practice.
  await expect(page.getByRole("definition").filter({ hasText: "UTC" })).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "active" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "email" }),
  ).toBeVisible();
});

test("hydrates, so a write happens without loading a new document", async () => {
  await page.goto("/");

  // A hydrated React form posts the server action in the background and
  // patches the result in. An unhydrated one does a plain form POST and the
  // browser loads a new document. Counting loads is what tells them apart,
  // which is how "server-rendered with client hydration" gets proved rather
  // than assumed.
  let documentLoads = 0;
  page.on("load", () => {
    documentLoads++;
  });

  await page.getByLabel("Workspace name").fill("Lovelace Analytics");
  await page.getByRole("button", { name: "Rename" }).click();

  await expect(
    page.getByRole("strong").filter({ hasText: "Lovelace Analytics" }),
  ).toBeVisible();
  expect(documentLoads).toBe(0);
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
    expect(html).toContain("Lovelace Analytics");
    expect(html).toContain(NAME);
    expect(html).toContain("UTC");
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

  await expect(
    page.getByRole("heading", {
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
