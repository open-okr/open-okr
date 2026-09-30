/**
 * The audit trail on a screen (P8-T10, screen S-36).
 *
 * Acceptance criterion, first half:
 *   Given a tampered audit row, when verification runs, then it is detected
 *   and located.
 *
 * The detection itself is proved against a real database in
 * `packages/core/test/audit-admin.test.ts`, including the tamper, which needs
 * the append-only trigger turned off and so cannot be staged from a browser.
 * What only a browser can show is the half this row exists for: that an
 * administrator can ask the question and take the file away without a shell on
 * the server.
 */
import type { BrowserContext, Download, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ acceptDownloads: true });
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("the screen is reachable from the admin navigation, not only by url", async () => {
  await goTo(page, "/admin");
  await expect(
    page.getByRole("link", { name: "Audit trail" }).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("verifying says the chain is intact and how much it checked", async () => {
  await goTo(page, "/admin/audit");
  await page.getByRole("button", { name: "Verify the audit chain" }).click();

  const verdict = page.getByTestId("chain-verdict");
  await expect(verdict).toBeVisible({ timeout: 15_000 });
  await expect(verdict).toContainText("The chain is intact");
  // The count is the part that makes it a verdict rather than a reassurance.
  await expect(verdict).toContainText("rows checked");
});

test("the trail comes out as a file, with the columns an auditor needs", async () => {
  await goTo(page, "/admin/audit");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: "Export as CSV" }).click(),
  ]);

  expect((download as Download).suggestedFilename()).toMatch(
    /^audit-\d{4}-\d{2}-\d{2}\.csv$/,
  );

  const path = await (download as Download).path();
  expect(path).toBeTruthy();
  const { readFile } = await import("node:fs/promises");
  const csv = await readFile(path as string, "utf8");

  for (const column of ["seq", "at", "action", "row_hash"]) {
    expect(csv).toContain(`"${column}"`);
  }
  // The position and the hash are in the file, which is what lets somebody
  // line the export up against a verification run later.
  await expect(page.getByTestId("export-note")).toContainText("rows");
});

test("a filter that matches nothing says so rather than handing over everything", async () => {
  await goTo(page, "/admin/audit");
  await page.getByLabel("Action").fill("nothing.everHappened");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: "Export as CSV" }).click(),
  ]);
  expect(download).toBeTruthy();

  await expect(page.getByTestId("export-note")).toHaveText("0 rows.");
});

test("the export is itself in the trail", async () => {
  await goTo(page, "/admin/audit");
  await page.getByLabel("Action").fill("audit.export");

  await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: "Export as CSV" }).click(),
  ]);

  // The exports above are in the trail by now, so filtering for them finds
  // rows: taking a copy of who did what is itself an act worth recording.
  await expect(page.getByTestId("export-note")).not.toHaveText("0 rows.");
});

/**
 * Completeness review L-19: the trail could be verified and exported and not
 * read. The filters, the cursor and the refusal below `full` are proved in
 * `packages/core/test/audit-admin.test.ts`; this is the table a person sees.
 */
test("the trail can be read on the screen, narrowed by the same filter as the file", async () => {
  await goTo(page, "/admin/audit");

  const table = page.getByTestId("audit-log");
  await expect(table).toBeVisible({ timeout: 15_000 });
  for (const header of ["Who", "Action", "Target", "Chain"]) {
    await expect(
      table.getByRole("columnheader", { name: header, exact: true }),
    ).toBeVisible();
  }
  // The zone is in the header, so a timestamp is never a guess.
  await expect(
    table.getByRole("columnheader", { name: /^When \(.+\)$/ }),
  ).toBeVisible();

  await page.getByLabel("Action").fill("audit.export");
  await page.getByRole("button", { name: "Show matching rows" }).click();

  // The exports this spec took are in the trail, and nothing else matches.
  const rows = page.getByTestId("audit-row");
  await expect(rows.first()).toContainText("audit.export", {
    timeout: 15_000,
  });
  await expect(rows.filter({ hasNotText: "audit.export" })).toHaveCount(0, {
    timeout: 15_000,
  });
  // The person who took them is named, not an id.
  await expect(rows.first().getByRole("cell").nth(1)).not.toHaveText(
    /^[0-9a-f-]{36}$/,
  );
});

test("a filter the trail has nothing for says so on the screen", async () => {
  await goTo(page, "/admin/audit");
  await page.getByLabel("Action").fill("nothing.everHappened");
  await page.getByRole("button", { name: "Show matching rows" }).click();

  await expect(page.getByTestId("audit-log-empty")).toHaveText(
    "No rows match this filter.",
    { timeout: 15_000 },
  );
});
