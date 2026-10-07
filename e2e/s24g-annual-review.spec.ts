/**
 * The annual review (P9-T20b-b, METHOD.md §8).
 *
 * Acceptance:
 *   Given an annual cycle ending on 31 December, when it is booked, then its
 *   review falls before the next year's drafting opens and no weekly
 *   check-in is booked on it.
 *
 * The year's own annual cycle is booked for a space this spec makes, so the
 * sessions it books reach no other spec; they are deleted and the space
 * archived afterwards. Where the review lands is proved to the day in
 * `packages/method`; this is the booking through the instance and the
 * session it leaves behind.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let token = "";
let spaceId = "";
let cycleId = "";
let cycleEndsOn = "";

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (spaceId) {
    await pool.query(
      "update okr_sessions set deleted_at = now() where space_id = $1",
      [spaceId],
    );
    if (token) {
      await api.post("/api/v1/spaces/archive", {
        headers: authed(),
        data: { id: spaceId },
      });
    }
  }
  await api?.dispose();
  await pool?.end();
  await context?.close();
});

test("sign in, with this year's annual cycle and a space of its own", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Annual review e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
         from workspace_members m join users u on u.id = m.user_id
        where u.email = $1 limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  const annual = (
    await pool.query<{ id: string; ends_on: string }>(
      `select id, ends_on::text from cycles
        where workspace_id = $1 and mode = 'annual' and status <> 'closed'
          and deleted_at is null and ends_on >= current_date
        order by starts_on limit 1`,
      [member.workspace_id],
    )
  ).rows[0];
  test.skip(!annual, "The instance has no open annual cycle to book.");
  cycleId = annual?.id as string;
  cycleEndsOn = annual?.ends_on as string;

  spaceId = (
    await post<{ id: string }>("spaces.create", { name: `Leadership ${STAMP}` })
  ).id;
  await post("sessions.bookCycle", {
    spaceId,
    cycleId,
    weekday: 3,
    time: "10:00",
    facilitatorId: member.id,
  });
});

test("acceptance: the year books its review before the next year's drafting, and nothing else", async () => {
  const rows = (
    await pool.query<{ id: string; kind: string; title: string; on: string }>(
      `select id, kind, title, scheduled_for::date::text as on
         from okr_sessions
        where space_id = $1 and cycle_id = $2 and deleted_at is null`,
      [spaceId, cycleId],
    )
  ).rows;
  expect(rows.map((row) => row.kind)).toEqual(["quarterly"]);
  const review = rows[0];
  // The next year's drafting opens three weeks before it starts.
  const draftingOpens = new Date(
    Date.parse(`${cycleEndsOn}T00:00:00Z`) + (1 - 21) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  expect((review?.on ?? "") < draftingOpens).toBe(true);

  await goTo(page, `/session/${review?.id}`);
  await expect(
    page.getByRole("heading", { name: "Annual review" }),
  ).toBeVisible({ timeout: 15_000 });
});
