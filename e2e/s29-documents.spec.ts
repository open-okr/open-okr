/**
 * Documents on a goal, drafts and their history (UIUX-PLAN.md §6 S-29,
 * TECHNICAL-PLAN §4.9, P5-T12).
 *
 * Acceptance criterion:
 *   Given a document drafted on a goal and then published, when a space member
 *   opens the goal, then they see it with a readable history of changes, and
 *   before publication they saw nothing.
 *
 * **A browser rather than a unit test, because the claim is about what somebody
 * sees on a page.** That a draft is invisible to another member, including
 * through a direct identifier probe, is proved against a real database in
 * `packages/core/test/documents.test.ts`, where a second account is cheap. What
 * this proves is that the panel is on the goal, that the two buttons are two
 * decisions, and that the history appears with the difference in it.
 *
 * **The file name carries the run order:** specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` claims it, so anything that
 * signs in sorts after `registration-`.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let workspaceId: string;
let goalId: string;

const TITLE = "How we will win activation";

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("sign in and find a goal to write about", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });

  const member = (
    await pool.query<{ workspace_id: string }>(
      `select m.workspace_id from workspace_members m
         join users u on u.id = m.user_id
        where u.email = $1
        limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  workspaceId = member.workspace_id;

  const goal = (
    await pool.query<{ id: string }>(
      "select id from goals where workspace_id = $1 and deleted_at is null order by created_at limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!goal) {
    throw new Error("No goal to hang a document on.");
  }
  goalId = goal.id;
});

test("the goal carries a documents panel, and it says nothing is written yet", async () => {
  await goTo(page, `/goals/${goalId}`);
  await expect(page.getByTestId("document-count")).toHaveText("None yet", {
    timeout: 15_000,
  });
  await expect(page.getByText("A document starts as a draft")).toBeVisible();
});

test("starting one makes a draft, and the draft says it is private", async () => {
  await page.getByLabel("Start a document").fill(TITLE);
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByTestId("documents")).toContainText(TITLE, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("documents")).toContainText(
    "Draft, yours only",
  );

  await page.getByRole("link", { name: TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(page.getByText("Only you can see this")).toBeVisible();
  // Nothing to compare yet, because a version is written when you publish.
  await expect(page.getByTestId("doc-versions")).toHaveCount(0);
});

/**
 * The editor itself, by the class ProseMirror always puts on its own element.
 *
 * `getByRole("paragraph")` matched a paragraph on the page rather than one
 * inside the editor, so the typing went nowhere and two published versions came
 * out identical. The difference panel then said "0 added, 0 removed", which was
 * true about the data and wrong about what the test meant to do.
 */
const editor = () => page.locator(".ProseMirror").first();

test("saving keeps the words without telling anybody", async () => {
  await editor().click();
  await page.keyboard.type("First draft.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Saved. Not published yet.")).toBeVisible({
    timeout: 15_000,
  });

  await expect(async () => {
    const { rows } = await pool.query<{
      state: string;
      count: string;
      body: unknown;
    }>(
      `select d.state, d.body, (select count(*) from document_versions v where v.document_id = d.id) as count
         from documents d
        where d.workspace_id = $1 and d.title = $2 and d.deleted_at is null`,
      [workspaceId, TITLE],
    );
    expect(rows[0]?.state).toBe("draft");
    // Saving is not publishing, so there is still no version.
    expect(Number(rows[0]?.count)).toBe(0);
    // And the words are really in the row, which is what the wrong selector
    // hid the first time this was written.
    expect(JSON.stringify(rows[0]?.body)).toContain("First draft.");
  }).toPass({ timeout: 15_000 });
});

test("acceptance: publishing shows it with a readable history", async () => {
  await page.getByRole("button", { name: "Publish" }).click();

  await expect(page.getByTestId("doc-versions")).toContainText("Version 1", {
    timeout: 15_000,
  });
  await expect(page.getByText("Only you can see this")).toHaveCount(0);

  await goTo(page, `/goals/${goalId}`);
  await expect(page.getByTestId("documents")).toContainText("Published", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("documents")).toContainText("1 version");
});

test("a second publish shows what changed between the two", async () => {
  await page.getByRole("link", { name: TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible(
    { timeout: 15_000 },
  );

  await editor().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Second draft.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Not published yet.")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Publish a new version" }).click();

  const difference = page.getByTestId("doc-difference");
  await expect(difference).toBeVisible({ timeout: 15_000 });
  await expect(difference).toContainText("version 1 and 2");
  await expect(difference).toContainText("Second draft.");
});

/**
 * Files on a document, and the cycle controls (P6-G27b, GAP-AUDIT §5).
 *
 * Seven attachment actions and three cycle actions shipped and none of them
 * was reachable from a screen. The upload goes through the storage port on the
 * server rather than a presigned URL, because the port has two drivers and
 * only one of them can sign anything: an instance on local disk has no object
 * store to redirect to.
 */
test("a document carries files, and one survives a reload", async () => {
  // **Reached from its goal, because there is no document index.** Every
  // earlier case in this file navigates the same way: a document belongs to a
  // subject and is linked from it.
  await goTo(page, `/goals/${goalId}`);
  await page.getByRole("link", { name: TITLE }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: TITLE }),
  ).toBeVisible({ timeout: 15_000 });
  const href = new URL(page.url()).pathname;

  await expect(page.getByTestId("attachment-input")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("attachment-input").setInputFiles({
    name: "brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("What this document is about."),
  });
  await page.getByTestId("attachment-upload").click();

  const list = page.getByTestId("attachment-list");
  await expect(list).toContainText("brief.txt", { timeout: 20_000 });

  // It survives a reload, which is what "stored" means rather than "held in
  // this page's state".
  await goTo(page, href);
  await expect(page.getByTestId("attachment-list")).toContainText("brief.txt", {
    timeout: 15_000,
  });

  // And the bytes come back through the route that checks access first.
  const link = page.getByRole("link", { name: "brief.txt" });
  const target = await link.getAttribute("href");
  expect(target).toMatch(/^\/api\/blobs\/[0-9a-f-]{36}$/);
  const response = await page.request.get(target as string);
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("What this document is about.");
});

test("the cycle screen can reach the next quarter", async () => {
  // `cycles.create`, `update` and `archive` had no browser caller, so a
  // workspace could plan exactly one cycle: the one provisioning made. The
  // controls are asserted rather than pressed: creating a second cycle here
  // would move what every later spec reads.
  await goTo(page, "/cycle");
  await expect(page.getByTestId("create-cycle")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("set-publication-deadline")).toBeVisible();
  await expect(page.getByTestId("archive-cycle")).toBeVisible();
  // Create is refused until a date is chosen, because the action takes a day
  // inside the period rather than a period.
  await expect(page.getByTestId("create-cycle")).toBeDisabled();
});
