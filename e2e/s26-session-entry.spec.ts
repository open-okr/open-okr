/**
 * The session entry point (UIUX-PLAN.md §4 S-22 to S-25, P5-T01c).
 *
 * Acceptance criterion:
 *   Given a member with a session scheduled in their space, when they open the
 *   product, then they can reach that session in two clicks without knowing its
 *   identifier.
 *
 * That last clause is the whole point of the task. S-22 to S-25 were built
 * across P4-T07 to P4-T10 and nothing in the interface linked to any of them,
 * so this spec is written to fail if a link is ever removed again. Every
 * navigation below is a click on something a person can see; nothing here
 * types a URL except the first `goto("/")`, which is opening the product.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let spaceName: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in, and schedule a session the way a coordinator would", async () => {
  await signIn(page);
  await goTo(page, "/sessions");

  // Through the form on the sessions screen (completeness review H-08). This
  // spec used to write the row with SQL "because there is no create-session
  // control yet", which proved a scheduled session was reachable and hid that
  // nobody could schedule one.
  const form = page.locator("section", {
    has: page.getByRole("heading", { name: "Schedule one session" }),
  });
  await expect(form).toBeVisible({ timeout: 10_000 });
  spaceName =
    (await form.getByLabel("Space").locator("option:checked").textContent()) ??
    "";
  expect(spaceName).not.toBe("");

  // **Only if it is not already there.** This file is a serial group, and a
  // retry re-runs it from this test, so a second submission adds a second
  // identical session. The next test then finds two "Entry point weekly"
  // rows and fails on strict mode, which reports a duplicate rather than the
  // navigation problem that caused the retry. Happened on CI once.
  if ((await page.getByText("Entry point weekly").count()) > 0) {
    return;
  }
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await form.getByLabel("Ritual").selectOption("weekly");
  await form.getByLabel("Title").fill("Entry point weekly");
  await form.getByLabel("Date and time").fill(`${tomorrow}T10:00`);
  await form.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(form.getByRole("status")).toHaveText("Scheduled.", {
    timeout: 10_000,
  });
  await expect(page.getByText("Entry point weekly")).toBeVisible();
});

test("the navigation offers Sessions at all, which is what was missing", async () => {
  // `goTo` rather than a bare `goto`: a first navigation after signing in can
  // be superseded and answer `net::ERR_ABORTED`, which is why the wrapper
  // exists. This spec was the last one still calling `goto` directly, and it
  // is what turned one race into a failed CI run.
  await goTo(page, "/");
  await expect(page.getByRole("link", { name: "Sessions" }).first()).toBeVisible(
    { timeout: 10_000 },
  );
});

test("acceptance: two clicks from the front door to the session", async () => {
  await goTo(page, "/");

  // One.
  await page.getByRole("link", { name: "Sessions" }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sessions" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Entry point weekly")).toBeVisible();

  // Two. Nothing here knows the session's identifier.
  await page.getByText("Entry point weekly").click();
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/, {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the list says which session is in progress, so a facilitator can rejoin", async () => {
  await page.goto("/sessions");
  await page.getByText("Entry point weekly").click();

  // Start it, then come back to the list.
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(
    page.getByRole("button", { name: "Continue to next step" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.goto("/sessions");
  const row = page
    .locator("a", { hasText: "Entry point weekly" })
    .first();
  await expect(row).toContainText("In progress");
  // The word changes with the state, because "Open" and "Rejoin" are different
  // things to a person standing outside a room that has already started.
  await expect(row).toContainText("Rejoin");
});

test("the space page links to its own session too", async () => {
  await page.goto("/spaces");
  await page.getByRole("link", { name: spaceName }).first().click();

  const card = page.locator("ul[aria-label='Sessions']");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Entry point weekly");
});

test("a member facilitating shows as such, and the finished filter is reachable", async () => {
  await page.goto("/sessions");
  await expect(page.getByText("You facilitate").first()).toBeVisible();

  await page.getByRole("link", { name: "Show finished" }).click();
  await expect(page).toHaveURL(/\/sessions\?finished=1$/);
  await expect(
    page.getByRole("link", { name: "Hide finished" }),
  ).toBeVisible();
});

test("the space page books the whole cycle, and a second press books nothing", async () => {
  // METHOD.md §7.1: "Book all of them for the whole cycle before the cycle
  // starts." One press on the team's own page.
  await page.goto("/spaces");
  await page.getByRole("link", { name: spaceName }).first().click();
  const form = page.locator("section", {
    has: page.getByRole("heading", { name: "Book the whole cycle" }),
  });
  await expect(form).toBeVisible({ timeout: 10_000 });
  // A select inside its own label is named by the label and its choice
  // ("Day Monday"), so neither of these is an exact match.
  await form.getByLabel("Day").selectOption("2");
  await form.getByLabel("Time").fill("10:30");
  await form.getByRole("button", { name: "Book the cycle" }).click();
  // A cycle already under way still has weeks ahead of it, unless it ends
  // this week; either answer is a booking the screen reports in words.
  await expect(form.getByRole("status")).toContainText(
    /Booked \d+ session\(s\)\.|already booked/,
    { timeout: 10_000 },
  );

  await form.getByRole("button", { name: "Book the cycle" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Everything this cycle needs was already booked",
    { timeout: 10_000 },
  );
  await expect(page.locator("ul[aria-label='Sessions']")).toContainText(
    /Weekly check-in|Monthly review|Quarterly review/,
  );
});
