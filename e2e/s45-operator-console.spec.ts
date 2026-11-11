/**
 * The cloud operator console, and the customer's plan screen, in a browser
 * (completeness review L-17, UIUX-PLAN.md §4 S-45 to S-47 and S-49,
 * P8-T03b and P8-T02b).
 *
 * **The suite builds a self-hosted instance, and this file makes it a cloud
 * one for its own length.** Every cloud screen answers not-found with
 * `cloud.enabled` off, which is why none had a path and why the route
 * coverage test carried a reason for each. The flag is an instance setting
 * resolved on every request, so writing it turns the same running server into
 * a cloud instance with no restart, and deleting it turns it back. Nothing
 * else about the instance changes.
 *
 * **Two new people, never the instance account's workspace.** Registration is
 * open on a cloud instance, so a customer and an operator each sign up and
 * each gets a workspace with a tenant row, which is what the console lists.
 * The instance account is the one who grants the operator, because the grant
 * refuses a person granting themselves, and it is also the proof that a
 * member without a grant meets not-found rather than a hint.
 *
 * **The grant is written to the table, not through `pnpm cloud:operator`.**
 * That command is the deployment's door and is proved in
 * `packages/core/test`; this file is about what the operator sees once they
 * are through it. The flag and the grant are both undone in `afterAll`, and
 * the suspension this file makes is lifted by the operator in its last step.
 */
import { readFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { fillDateTime } from "./date-time.ts";
import { expect, test } from "./fixtures.ts";
import { getStarted, goTo, INSTANCE_ACCOUNT, signIn, skipOnboarding } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const PASSWORD = "correct horse battery staple";
const CUSTOMER = { name: "Grace Hopper", email: "grace@example.net" } as const;
const OPERATOR = { name: "Olu Operator", email: "olu@example.net" } as const;
const CUSTOMER_WORKSPACE = `${CUSTOMER.name}'s workspace`;

// The superuser: `system_settings` and `instance_operators` sit above the
// tenant floor, and writing either is instance administration.
const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      testDbEnv.superuser,
    );

let pool: pg.Pool;
let customer: BrowserContext;
let operator: BrowserContext;
let customerPage: Page;
let operatorPage: Page;
let workspaceId = "";

const userId = async (email: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    "select id from users where email = $1",
    [email],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`${email} has no account`);
  }
  return id;
};

/**
 * Signs a new person up, or signs them in on a retry.
 *
 * Continuous integration retries once, and an address can register once.
 */
async function arrive(
  page: Page,
  person: { readonly name: string; readonly email: string },
): Promise<void> {
  const known = await pool.query("select 1 from users where email = $1", [
    person.email,
  ]);
  if (known.rowCount === 0) {
    await goTo(page, "/sign-up");
    await page.getByLabel("Name").fill(person.name);
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await getStarted(page);
    await skipOnboarding(page);
  } else {
    await goTo(page, "/sign-in");
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .first()
      .click();
  }
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  await pool.query(
    `insert into system_settings (key, value, source)
     values ('cloud.enabled', 'true'::jsonb, 'admin')
     on conflict (key) do update set value = excluded.value`,
  );
  // A plan screen needs a plan to read (docs/design/hosting-profiles.md §5).
  await pool.query(
    `insert into system_settings (key, value, source)
     values ('cloud.plans', $1::jsonb, 'admin')
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify([{ key: "team", name: "Team", seats: 20 }])],
  );
  customer = await browser.newContext();
  // The operator's browser is in São Paulo: UTC-3 all year since Brazil
  // dropped summer time, and the zone of neither the machine running this
  // nor continuous integration, so a time read in the server's zone fails.
  operator = await browser.newContext({ timezoneId: "America/Sao_Paulo" });
  customerPage = await customer.newPage();
  operatorPage = await operator.newPage();
});

test.afterAll(async () => {
  // Undone whatever happened above, so no later spec runs against a cloud.
  if (pool) {
    await pool.query(
      "delete from system_settings where key in ('cloud.enabled', 'cloud.plans')",
    );
    await pool.query(
      `update instance_operators set revoked_at = now()
        where user_id = (select id from users where email = $1)
          and revoked_at is null`,
      [OPERATOR.email],
    );
    await pool.end();
  }
  await customer?.close();
  await operator?.close();
});

test("a customer signs up and gets a workspace of their own", async () => {
  await arrive(customerPage, CUSTOMER);
  await expect(customerPage.getByText(CUSTOMER_WORKSPACE).first()).toBeVisible();
});

test("the customer's administrator reads their plan, which only a cloud has", async () => {
  await goTo(customerPage, "/admin/plan");
  await expect(
    customerPage.getByRole("heading", { level: 1, name: "Plan and seats" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    customerPage.getByRole("heading", { level: 2, name: "Current plan" }),
  ).toBeVisible();
  // No plan chosen is the free tier with no seat limit, so a signup is never
  // refused for a plan nobody picked.
  await expect(
    customerPage.getByText("This workspace has no seat limit."),
  ).toBeVisible();
});

test("an operator creates a workspace for somebody with no account yet", async () => {
  await arrive(operatorPage, OPERATOR);
  await pool.query(
    `insert into instance_operators (user_id, granted_by_user_id, note)
     values ($1, $2, 'granted by the end-to-end suite')
     on conflict (user_id) do update set revoked_at = null`,
    [await userId(OPERATOR.email), await userId(INSTANCE_ACCOUNT.email)],
  );
  await goTo(operatorPage, "/operator");
  const name = `Northwind Malaysia ${Date.now()}`;
  await operatorPage.getByLabel("Workspace name").fill(name);
  await operatorPage
    .getByLabel("First administrator's email")
    .fill("new.owner@example.net");
  await operatorPage.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    operatorPage.getByText("Created. An invitation went to new.owner@example.net."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(operatorPage.getByRole("link", { name })).toBeVisible();
});

test("a member without a grant is told the console does not exist", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/operator");
  await expect(
    page.getByRole("heading", { level: 1, name: "Not found" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);
});

test("an operator lists the tenants and opens one, and sees counts only", async () => {
  await arrive(operatorPage, OPERATOR);
  await pool.query(
    `insert into instance_operators (user_id, granted_by_user_id, note)
     values ($1, $2, 'granted by the end-to-end suite')
     on conflict (user_id) do update set revoked_at = null`,
    [await userId(OPERATOR.email), await userId(INSTANCE_ACCOUNT.email)],
  );

  await goTo(operatorPage, "/operator");
  await expect(
    operatorPage.getByRole("heading", { level: 1, name: "Workspaces" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    operatorPage.getByText(/^\d+ tenants? on this instance\./),
  ).toBeVisible();
  const row = operatorPage.getByRole("link", { name: CUSTOMER_WORKSPACE });
  await expect(row).toBeVisible();
  // Seats used, as the limit counts them, rather than active people
  // (operator-console.md §11, plan 0.7.0 P3).
  await expect(
    operatorPage.getByRole("columnheader", { name: "Seats used" }),
  ).toBeVisible();
  workspaceId = ((await row.getAttribute("href")) ?? "").split("/").pop() ?? "";
  expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);

  await goTo(operatorPage, `/operator/${workspaceId}`);
  await expect(
    operatorPage.getByRole("heading", { level: 1, name: CUSTOMER_WORKSPACE }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    operatorPage.getByText(/^Counts only\. Nothing a member of this workspace wrote/),
  ).toBeVisible();
  // Both counts from a measured snapshot: who works here, and what the plan
  // counts, where an invitation still waiting holds a seat (§11 P4). Written
  // here rather than waiting for the hourly measure.
  await pool.query(
    `insert into operator_workspace_usage (workspace_id, member_count, seat_count)
     values ($1, 1, 3)
     on conflict (workspace_id) do update
       set member_count = 1, seat_count = 3, measured_at = now()`,
    [workspaceId],
  );
  await operatorPage.reload();
  const seats = operatorPage
    .getByText("seats used", { exact: true })
    .locator("..");
  await expect(seats).toContainText(/^3( \/ \d+)?seats used$/);
});

test("the operator suspends the workspace with a reason, and lifts it again", async () => {
  expect(workspaceId, "the list named no workspace").not.toBe("");
  await goTo(operatorPage, `/operator/${workspaceId}`);

  // By id: the plan form above it has a field called Reason too.
  const moveTo = operatorPage.locator("#lifecycle-state");
  const reason = operatorPage.locator("#lifecycle-reason");
  const apply = operatorPage.getByRole("button", {
    name: `Apply to ${CUSTOMER_WORKSPACE}`,
  });
  await moveTo.selectOption("suspended");
  await reason.fill(
    "Your invoice is thirty days overdue. Reply to billing to restore it.",
  );
  await apply.click();
  await expect(
    operatorPage.getByText("This workspace is suspended"),
  ).toBeVisible({ timeout: 15_000 });
  // And the form says it was done, rather than simply being there again.
  await expect(
    operatorPage.getByText("Applied. The workspace's members see the change now."),
  ).toBeVisible();

  // The last step puts it back, so the tenant this file made is left active.
  await moveTo.selectOption("active");
  await reason.fill("The invoice was paid. Thank you.");
  await apply.click();
  await expect(
    operatorPage.getByText("This workspace is suspended"),
  ).toHaveCount(0, { timeout: 15_000 });
});

/**
 * guided-inputs §5, F5: a refused lifecycle change left the form as it was
 * and said nothing, which read as a change still on its way.
 */
/**
 * A trial on S-46 (docs/design/tenant-lifecycle.md §11 T2, plan 0.7.0 P4):
 * set to a day, shown as a fact, then removed. Keeps the current plan, so it
 * needs no catalogue.
 */
test("an operator sets a trial's end, sees it, and removes it", async () => {
  expect(workspaceId, "the list named no workspace").not.toBe("");
  await goTo(operatorPage, `/operator/${workspaceId}`);

  // By id: other forms on the page have a Reason field too.
  await operatorPage.locator("#trial-ends").fill("2030-01-31");
  await operatorPage
    .locator("#trial-reason")
    .fill("A month's trial while procurement signs.");
  await operatorPage.getByRole("button", { name: "Set the trial" }).click();
  await expect(operatorPage.getByText("Trial saved.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(operatorPage.getByText("Trial ends", { exact: true })).toBeVisible();

  await operatorPage
    .locator("#trial-reason")
    .fill("Signed today, so no trial is needed.");
  await operatorPage.getByRole("button", { name: "Remove the trial" }).click();
  await expect(
    operatorPage.getByText("Trial ends", { exact: true }),
  ).toBeHidden({ timeout: 15_000 });
});

test("a lifecycle change with no real reason is refused in words, and nothing moves", async () => {
  await goTo(operatorPage, `/operator/${workspaceId}`);
  const moveTo = operatorPage.locator("#lifecycle-state");
  const lifecycle = operatorPage.locator("form").filter({ has: moveTo });
  await moveTo.selectOption("suspended");
  // Spaces pass the browser's `required` and not the domain's trim.
  await operatorPage.locator("#lifecycle-reason").fill("   ");
  await operatorPage
    .getByRole("button", { name: `Apply to ${CUSTOMER_WORKSPACE}` })
    .click();

  await expect(lifecycle.getByRole("alert")).toHaveText(
    "A lifecycle change needs a reason.",
    { timeout: 15_000 },
  );
  await expect(operatorPage.getByText("This workspace is suspended")).toHaveCount(
    0,
  );
  // What was chosen is still chosen, to be corrected rather than redone.
  await expect(moveTo).toHaveValue("suspended");
});

test("the instance page says what is true of the deployment", async () => {
  await goTo(operatorPage, "/operator/instance");
  await expect(
    operatorPage.getByRole("heading", { level: 1, name: "This instance" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(operatorPage.getByRole("heading", { name: "Flags" })).toBeVisible();
  await expect(
    operatorPage.getByRole("heading", { name: "Messages" }),
  ).toBeVisible();

  // Plan 0.8.0 V2: the operator is told which release runs. The suite turns
  // the update check off so CI never calls GitHub, and the card says so
  // rather than claiming nothing is newer.
  const { version } = JSON.parse(
    readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8"),
  ) as { version: string };
  await expect(operatorPage.getByTestId("operator-version-running")).toHaveText(
    `This instance runs v${version}.`,
  );
  await expect(operatorPage.getByTestId("operator-version-off")).toBeVisible();
});

/**
 * guided-inputs §7: a site message's window is read on the operator's own
 * clock. The form posts the browser's zone beside each time, where it used to
 * post the time alone and the server read it in its own zone.
 */
test("a site message's window is read on the operator's own clock", async () => {
  await goTo(operatorPage, "/operator/instance");
  const body = `Planned maintenance ${Date.now()}`;
  await operatorPage.getByLabel("Message", { exact: true }).fill(body);
  // Years ahead, so the message is never live for a later spec.
  await fillDateTime(operatorPage, "Shows from", "2031-03-04T09:00");
  await fillDateTime(operatorPage, "Stops at", "2031-03-04T10:30");
  await expect(
    operatorPage.getByText("In America/Sao_Paulo time.").first(),
  ).toBeVisible();
  await operatorPage.getByRole("button", { name: "Show this message" }).click();
  await expect(
    operatorPage.getByText("Saved. It shows in the window you set."),
  ).toBeVisible({ timeout: 15_000 });

  await expect(async () => {
    const { rows } = await pool.query<{ starts: string; ends: string }>(
      `select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as starts,
              to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as ends
         from site_messages where body = $1`,
      [body],
    );
    expect(rows).toEqual([
      { starts: "2031-03-04T12:00", ends: "2031-03-04T13:30" },
    ]);
  }).toPass({ timeout: 15_000 });
  await pool.query("delete from site_messages where body = $1", [body]);
});

test("a site message that ends before it starts is refused in words, and keeps what was typed", async () => {
  await goTo(operatorPage, "/operator/instance");
  const body = `Refused window ${Date.now()}`;
  const message = operatorPage.getByLabel("Message", { exact: true });
  await message.fill(body);
  await fillDateTime(operatorPage, "Shows from", "2031-03-04T10:00");
  await fillDateTime(operatorPage, "Stops at", "2031-03-04T09:00");
  await operatorPage.getByRole("button", { name: "Show this message" }).click();

  const form = operatorPage.locator("form").filter({ has: message });
  await expect(form.getByRole("alert")).toHaveText(
    "The message has to end after it starts.",
    { timeout: 15_000 },
  );
  await expect(message).toHaveValue(body);
  const { rows } = await pool.query(
    "select 1 from site_messages where body = $1",
    [body],
  );
  expect(rows).toHaveLength(0);
});

test("an operator is told what is overdue for erasure, and sees one being erased", async () => {
  // The workspace this file's operator created above, so no other spec meets it.
  const { rows } = await pool.query<{ id: string; name: string }>(
    `select t.workspace_id as id, w.name from tenants t
       join workspaces w on w.id = t.workspace_id
      where w.name like 'Northwind Malaysia %' order by t.created_at desc limit 1`,
  );
  const target = rows[0];
  expect(target).toBeDefined();
  const id = (target as { id: string }).id;
  await pool.query(
    `insert into system_settings (key, value, source)
     values ('cloud.closureRetentionDays', '30'::jsonb, 'admin')
     on conflict (key) do update set value = excluded.value`,
  );
  await pool.query(
    `update tenants set state = 'closed', closed_at = now() - interval '40 days'
      where workspace_id = $1`,
    [id],
  );
  await pool.query("update workspaces set state = 'frozen' where id = $1", [
    id,
  ]);
  try {
    await goTo(operatorPage, "/operator");
    await expect(
      operatorPage.getByText(
        /past (its|their) retention window and (has|have) not been erased/,
      ),
    ).toBeVisible({ timeout: 15_000 });

    await pool.query(
      "update tenants set erasing_at = now() where workspace_id = $1",
      [id],
    );
    await goTo(operatorPage, `/operator/${id}`);
    await expect(operatorPage.getByText(/^Being erased since /)).toBeVisible({
      timeout: 15_000,
    });
    await expect(operatorPage.locator("#lifecycle-state")).toHaveCount(0);
  } finally {
    await pool.query(
      `update tenants set state = 'active', closed_at = null, erasing_at = null
        where workspace_id = $1`,
      [id],
    );
    await pool.query("update workspaces set state = 'active' where id = $1", [
      id,
    ]);
    await pool.query(
      "delete from system_settings where key = 'cloud.closureRetentionDays'",
    );
  }
});

/**
 * Workspaces with no plan (plan 0.8.0 O2,
 * docs/design/workspaces-without-a-plan.md §5).
 *
 * The catalogue above holds Team with no AI credits, so the review warns that
 * moving gives no AI back. Whatever this moves is put back afterwards, so no
 * later spec meets a plan it did not choose.
 */
test("workspaces with no plan are marked, reviewed and moved onto the default plan", async () => {
  const before = await pool.query<{ workspace_id: string }>(
    "select workspace_id from tenants where plan_key is null and deleted_at is null",
  );
  const unplanned = before.rows.map((row) => row.workspace_id);
  try {
    // No default plan yet: the console says what having none costs, and
    // what to set.
    await goTo(operatorPage, "/operator");
    const notice = operatorPage.getByTestId("no-plan-notice");
    await expect(notice).toContainText("no AI on the provider's key");
    await expect(notice).toContainText("Set cloud.defaultPlan");
    await expect(operatorPage.getByText("No plan").first()).toBeVisible();

    await pool.query(
      `insert into system_settings (key, value, source)
       values ('cloud.defaultPlan', '"team"'::jsonb, 'admin')
       on conflict (key) do update set value = excluded.value`,
    );
    await goTo(operatorPage, "/operator");
    await operatorPage
      .getByRole("link", { name: "Review putting them on Team" })
      .click();
    await expect(
      operatorPage.getByRole("heading", { name: "Workspaces with no plan" }),
    ).toBeVisible({ timeout: 15_000 });
    // The link lands on the review page itself, which is also how
    // route-coverage.test.ts sees the route opened.
    expect(new URL(operatorPage.url()).pathname).toBe("/operator/default-plan");
    await expect(
      operatorPage.getByTestId("default-plan-no-credits"),
    ).toContainText("Team includes no AI credits");
    await expect(
      operatorPage.getByTestId("default-plan-will-move"),
    ).toContainText(CUSTOMER_WORKSPACE);

    await operatorPage.getByTestId("default-plan-confirm").click();
    await expect(operatorPage.getByTestId("default-plan-result")).toContainText(
      "moved to Team",
      { timeout: 15_000 },
    );
    const after = await pool.query<{ plan_key: string | null }>(
      "select plan_key from tenants where workspace_id = $1",
      [workspaceId],
    );
    expect(after.rows[0]?.plan_key).toBe("team");
  } finally {
    await pool.query(
      "update tenants set plan_key = null, seats = null where workspace_id = any($1)",
      [unplanned],
    );
    await pool.query(
      "delete from system_settings where key = 'cloud.defaultPlan'",
    );
  }
});
