/**
 * Setup 3: a group of companies on its own servers, one workspace per company
 * (PLAN.md §5.2, docs/design/hosting-test-matrix.md).
 *
 * The cloud flag on, no plans, no billing, sign-up by company email. The group's
 * IT runs the instance as its operator and gives each company a workspace of its
 * own, so each company's data stays in its own tenant however the group is
 * organised above them.
 *
 * | Person | Who they are here |
 * |---|---|
 * | Operator | The group's IT, signed up with the group's own address and granted the role by the deployment |
 * | Company administrator | Owns one company's workspace: Trading, or Logistics |
 * | Workspace administrator | Appointed by Trading's company administrator |
 * | Member | Works at Trading |
 */
import type { BrowserContext, Page } from "@playwright/test";
import type pg from "pg";
import { expect, test } from "./fixtures.ts";
import {
  applySettings,
  clearSettings,
  expectNotFound,
  grantOperator,
  instancePool,
  inviteByEmail,
  joinAsNewcomer,
  joinPathIn,
  MailCatcher,
  makeAdministrator,
  memberIdIn,
  operatorMoves,
  PASSWORD,
  type Person,
  personContext,
  RUN,
  revokeOperator,
  roleIn,
  signUp,
  switcherOptions,
  workspaceIdNamed,
  writeObjective,
} from "./hosting.ts";
import { goTo } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OPERATOR: Person = {
  name: "Ian Ismail",
  email: `ian.${RUN}@northwind-group.example`,
};
const TRADING_ADMIN: Person = {
  name: "Farah Fauzi",
  email: `farah.${RUN}@northwind-trading.example`,
};
const LOGISTICS_ADMIN: Person = {
  name: "Kumar Krishnan",
  email: `kumar.${RUN}@northwind-logistics.example`,
};
const WORKSPACE_ADMIN: Person = {
  name: "Mei Ling",
  email: `mei.${RUN}@northwind-trading.example`,
};
const MEMBER: Person = {
  name: "Daniel Doss",
  email: `daniel.${RUN}@northwind-trading.example`,
};
const TRADING = `Northwind Trading ${RUN}`;
const LOGISTICS = `Northwind Logistics ${RUN}`;

const SETTINGS = {
  "cloud.enabled": true,
  "registration.policy": "company_domains",
};

let pool: pg.Pool;
let mail: MailCatcher;
const contexts: BrowserContext[] = [];
let operator: Page;
let tradingAdmin: Page;
let logisticsAdmin: Page;
let workspaceAdmin: Page;
let member: Page;
let tradingId = "";
let logisticsId = "";
let tradingObjective = "";
let logisticsObjective = "";

test.beforeAll(async ({ browser }) => {
  pool = instancePool();
  mail = await MailCatcher.start();
  await applySettings(pool, { ...SETTINGS, ...mail.settings() });
  const open = async () => {
    const context = await personContext(browser);
    contexts.push(context);
    return context.newPage();
  };
  operator = await open();
  tradingAdmin = await open();
  logisticsAdmin = await open();
  workspaceAdmin = await open();
  member = await open();
});

// Undone whatever happened above, so no later spec runs against a cloud.
test.afterAll(async () => {
  if (pool) {
    if (logisticsId) {
      // The suspension below is lifted by its own last step; this is the net
      // under it, so no tenant is left read-only for a later spec.
      await pool.query("update workspaces set state = 'active' where id = $1", [
        logisticsId,
      ]);
      await pool.query(
        "update tenants set state = 'active' where workspace_id = $1",
        [logisticsId],
      );
    }
    await clearSettings(pool, [
      ...Object.keys(SETTINGS),
      ...Object.keys(mail?.settings() ?? {}),
    ]);
    await revokeOperator(pool, OPERATOR).catch(() => undefined);
    await pool.end();
  }
  await mail?.close();
  for (const context of contexts) {
    await context.close();
  }
});

test("a visitor with a free mail address is told to use a company one", async ({
  browser,
}) => {
  const visitor = await personContext(browser);
  const page = await visitor.newPage();
  await goTo(page, "/sign-up");
  await expect(page.getByTestId("company-only")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Name").fill("Somebody Else");
  await page.getByLabel("Email").fill(`somebody.${RUN}@gmail.com`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(/Use your company email address to start a workspace/),
  ).toBeVisible({ timeout: 15_000 });
  await visitor.close();
});

test("operator: the group's IT signs up with the group's address and is granted the console", async () => {
  await signUp(operator, OPERATOR, mail);
  await expectNotFound(operator, "/operator");
  await grantOperator(pool, OPERATOR);
  await goTo(operator, "/operator");
  await expect(
    operator.getByRole("heading", { level: 1, name: "Workspaces" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("operator: one workspace per company, each sent to the person who will run it", async () => {
  for (const [name, owner] of [
    [TRADING, TRADING_ADMIN],
    [LOGISTICS, LOGISTICS_ADMIN],
  ] as const) {
    await goTo(operator, "/operator");
    await operator.getByLabel("Workspace name").fill(name);
    await operator.getByLabel("First administrator's email").fill(owner.email);
    await operator.getByRole("button", { name: "Create workspace" }).click();
    await expect(
      operator.getByText(`Created. An invitation went to ${owner.email}.`),
    ).toBeVisible({ timeout: 15_000 });
  }
  tradingId = await workspaceIdNamed(pool, TRADING);
  logisticsId = await workspaceIdNamed(pool, LOGISTICS);
});

test("company administrators: each follows their email and owns their company's workspace", async () => {
  for (const [page, person, id, name] of [
    [tradingAdmin, TRADING_ADMIN, tradingId, TRADING],
    [logisticsAdmin, LOGISTICS_ADMIN, logisticsId, LOGISTICS],
  ] as const) {
    const invitation = await mail.waitFor(person.email, /\/join\//);
    // The invitation reached this inbox, so the address arrives confirmed
    // and the sign-up ends on the welcome, although company domains keep
    // confirmation required here (plan 0.8.0 S5, email-verification.md §12).
    expect(
      await joinAsNewcomer(page, joinPathIn(invitation), person, mail),
    ).toBe("welcome");
    await expect(page.getByText(name).first()).toBeVisible();
    expect(await roleIn(pool, id, person.email)).toBe("owner");
    expect(await roleIn(pool, id, OPERATOR.email)).toBeNull();
  }
});

test("company administrator: one company, with no plan, no seat limit and no instance settings", async () => {
  expect(await switcherOptions(tradingAdmin)).toEqual([]);
  await expectNotFound(tradingAdmin, "/admin/plan");
  await expectNotFound(tradingAdmin, "/operator");
  await goTo(tradingAdmin, "/admin/general");
  await expect(
    tradingAdmin.getByRole("heading", { level: 1, name: "General" }),
  ).toBeVisible({ timeout: 15_000 });
  for (const card of ["This instance", "Registration", "Update check"]) {
    await expect(
      tradingAdmin.getByRole("heading", { level: 2, name: card, exact: true }),
    ).toHaveCount(0);
  }
});

test("company administrator: a company address is offered a workspace of its own here", async () => {
  // docs/design/hosting-profiles.md §3: sign-up is open to a company address,
  // so starting a workspace is too. That none is refused as free with no
  // default plan is criterion 5, proved in packages/core/test.
  await goTo(tradingAdmin, "/workspaces/new");
  await expect(
    tradingAdmin.getByRole("heading", { level: 1, name: "New workspace" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("company administrator: appoints a workspace administrator and invites a member", async () => {
  // Two whole sign-ups, each through its own welcome (plan 0.8.0 S4).
  test.setTimeout(90_000);
  const adminPath = await inviteByEmail(tradingAdmin, WORKSPACE_ADMIN.email);
  const memberPath = await inviteByEmail(tradingAdmin, MEMBER.email);
  // Personal invitations, so each arrives confirmed (plan 0.8.0 S5).
  expect(
    await joinAsNewcomer(workspaceAdmin, adminPath, WORKSPACE_ADMIN, mail),
  ).toBe("welcome");
  expect(await joinAsNewcomer(member, memberPath, MEMBER, mail)).toBe(
    "welcome",
  );
  await makeAdministrator(
    tradingAdmin,
    await memberIdIn(pool, tradingId, WORKSPACE_ADMIN.email),
  );
  expect(await roleIn(pool, tradingId, WORKSPACE_ADMIN.email)).toBe("admin");
  expect(await roleIn(pool, tradingId, MEMBER.email)).toBe("member");
});

test("workspace administrator: runs Trading's people, and nothing above the workspace", async () => {
  await goTo(workspaceAdmin, "/admin/invitations");
  await expect(
    workspaceAdmin.getByLabel("Email address", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expectNotFound(workspaceAdmin, "/admin/plan");
  await expectNotFound(workspaceAdmin, "/operator");
});

test("members: each company writes its own objectives", async () => {
  await goTo(member, "/");
  await expect(
    member.getByRole("heading", { level: 1, name: "My week" }),
  ).toBeVisible({ timeout: 20_000 });
  tradingObjective = await writeObjective(
    member,
    pool,
    `Open two new export markets ${RUN}`,
  );
  logisticsObjective = await writeObjective(
    logisticsAdmin,
    pool,
    `Deliver on time every week ${RUN}`,
  );
});

test("member: another company's objective is not found, and the switcher offers nothing", async () => {
  expect(await switcherOptions(member)).toEqual([]);
  await expectNotFound(member, `/goals/${logisticsObjective}`);
  await expectNotFound(member, "/admin");
});

test("company administrator: cannot open another company's objective either", async () => {
  await expectNotFound(tradingAdmin, `/goals/${logisticsObjective}`);
  await expectNotFound(logisticsAdmin, `/goals/${tradingObjective}`);
});

test("operator: sees every company as counts, and reads none of their work", async () => {
  await goTo(operator, "/operator");
  await expect(operator.getByRole("link", { name: TRADING })).toBeVisible({
    timeout: 15_000,
  });
  await expect(operator.getByRole("link", { name: LOGISTICS })).toBeVisible();
  await goTo(operator, `/operator/${tradingId}`);
  await expect(
    operator.getByText(
      /^Counts only\. Nothing a member of this workspace wrote/,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expectNotFound(operator, `/goals/${tradingObjective}`);
});

test("operator: suspends one company; its administrator is told and cannot lift it; the other company works on", async () => {
  await operatorMoves(
    operator,
    logisticsId,
    LOGISTICS,
    "suspended",
    "The group's audit needs this workspace held for a week.",
  );
  await goTo(logisticsAdmin, "/admin/general");
  await expect(
    logisticsAdmin.getByTestId("workspace-state-current"),
  ).toContainText("Suspended by the provider", { timeout: 15_000 });
  await expect(logisticsAdmin.getByTestId("set-state-active")).toHaveCount(0);
  await expect(
    logisticsAdmin.getByTestId("workspace-state-banner"),
  ).toContainText("Only the provider can lift it.");
  // Trading is a tenant of its own, untouched.
  await goTo(member, "/");
  await expect(member.getByTestId("workspace-state-banner")).toHaveCount(0);

  await operatorMoves(
    operator,
    logisticsId,
    LOGISTICS,
    "active",
    "The audit is finished. Thank you.",
  );
  await goTo(logisticsAdmin, "/");
  await expect(
    logisticsAdmin.getByTestId("workspace-state-banner"),
  ).toHaveCount(0, { timeout: 15_000 });
});
