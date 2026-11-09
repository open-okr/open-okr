/**
 * Setup 2: a cloud run by another provider on its own servers (PLAN.md §5.2,
 * docs/design/hosting-test-matrix.md).
 *
 * The cloud flag on, the provider's own catalogue, no payment provider, and sign-up
 * by company email because that is what this provider chose. It invoices by hand,
 * so its operator sets each customer's plan. Nothing on any screen names OpenOKR's
 * makers or OKRGoal: the name, the legal pages, the support address and the source
 * a member is offered are all the provider's.
 *
 * | Person | Who they are here |
 * |---|---|
 * | Operator | The provider's staff, granted the role by the deployment |
 * | Company administrator | The customer who signed up and owns the workspace |
 * | Workspace administrator | Appointed by the customer |
 * | Member | Works in the customer's workspace |
 */
import type { BrowserContext, Page } from "@playwright/test";
import type pg from "pg";
import { fillDateTime } from "./date-time.ts";
import { expect, test } from "./fixtures.ts";
import {
  applySettings,
  clearSettings,
  expectNotFound,
  grantOperator,
  instancePool,
  inviteByEmail,
  joinAsNewcomer,
  makeAdministrator,
  memberIdIn,
  onlyWorkspaceOf,
  operatorSetsPlan,
  PASSWORD,
  type Person,
  personContext,
  RUN,
  revokeOperator,
  roleIn,
  signUp,
  writeObjective,
} from "./hosting.ts";
import { goTo } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OPERATOR: Person = {
  name: "Pat Provider",
  email: `pat.${RUN}@globex-cloud.example`,
};
const COMPANY_ADMIN: Person = {
  name: "Dana Diaz",
  email: `dana.${RUN}@initech.example`,
};
const WORKSPACE_ADMIN: Person = {
  name: "Wen Wu",
  email: `wen.${RUN}@initech.example`,
};
const MEMBER: Person = {
  name: "Mo Musa",
  email: `mo.${RUN}@initech.example`,
};
const WORKSPACE = `${COMPANY_ADMIN.name}'s workspace`;
const OPERATOR_WORKSPACE = `${OPERATOR.name}'s workspace`;
const MESSAGE = `Planned maintenance tonight ${RUN}`;

const SETTINGS = {
  "cloud.enabled": true,
  "instance.name": "Globex Cloud",
  "instance.termsUrl": "https://globex-cloud.example/terms",
  "instance.privacyUrl": "https://globex-cloud.example/privacy",
  "instance.sourceUrl": "https://git.globex-cloud.example/openokr",
  "instance.supportEmail": "help@globex-cloud.example",
  "registration.policy": "company_domains",
  "cloud.plans": [
    { key: "starter", name: "Starter", seats: 5 },
    { key: "growth", name: "Growth", seats: 25 },
  ],
  "cloud.defaultPlan": "starter",
};

let pool: pg.Pool;
const contexts: BrowserContext[] = [];
let operator: Page;
let companyAdmin: Page;
let workspaceAdmin: Page;
let member: Page;
let workspaceId = "";

test.beforeAll(async ({ browser }) => {
  pool = instancePool();
  await applySettings(pool, SETTINGS);
  const open = async (options = {}) => {
    const context = await personContext(browser, options);
    contexts.push(context);
    return context.newPage();
  };
  // The operator works in UTC, so the window typed below is the one stored.
  operator = await open({ timezoneId: "UTC" });
  companyAdmin = await open();
  workspaceAdmin = await open();
  member = await open();
});

// Undone whatever happened above, so no later spec runs against a cloud.
test.afterAll(async () => {
  if (pool) {
    await pool.query("delete from site_messages where body = $1", [MESSAGE]);
    await clearSettings(pool, Object.keys(SETTINGS));
    await revokeOperator(pool, OPERATOR).catch(() => undefined);
    await pool.end();
  }
  for (const context of contexts) {
    await context.close();
  }
});

test("a visitor meets the provider's own name and legal pages", async ({
  browser,
}) => {
  const visitor = await personContext(browser);
  const page = await visitor.newPage();
  await goTo(page, "/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in to Globex Cloud" }),
  ).toBeVisible({ timeout: 15_000 });
  await goTo(page, "/sign-up");
  await expect(
    page.getByRole("link", { name: "Terms of service" }),
  ).toHaveAttribute("href", SETTINGS["instance.termsUrl"]);
  await expect(
    page.getByRole("link", { name: "Privacy policy" }),
  ).toHaveAttribute("href", SETTINGS["instance.privacyUrl"]);
  await visitor.close();
});

test("a visitor with a free mail address is refused, because this provider takes company addresses", async ({
  browser,
}) => {
  const visitor = await personContext(browser);
  const page = await visitor.newPage();
  await goTo(page, "/sign-up");
  await page.getByLabel("Name").fill("Somebody Else");
  await page.getByLabel("Email").fill(`somebody.${RUN}@gmail.com`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(/Use your company email address to start a workspace/),
  ).toBeVisible({ timeout: 15_000 });
  await visitor.close();
});

test("company administrator: signs up with a company address and starts on the provider's default plan", async ({
  request,
}) => {
  await signUp(companyAdmin, COMPANY_ADMIN);
  workspaceId = await onlyWorkspaceOf(pool, COMPANY_ADMIN.email);
  expect(await roleIn(pool, workspaceId, COMPANY_ADMIN.email)).toBe("owner");

  await goTo(companyAdmin, "/admin/plan");
  await expect(
    companyAdmin.getByRole("heading", { level: 1, name: "Plan and seats" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    companyAdmin.getByText("Starter", { exact: true }).first(),
  ).toBeVisible();
  await expect(companyAdmin.getByText("1 of 5", { exact: true })).toBeVisible();
  await expect(companyAdmin.getByText("Growth", { exact: true })).toBeVisible();
  // No payment provider: the screen says who changes the plan, and sells nothing.
  await expect(
    companyAdmin.getByRole("link", {
      name: "To change this plan, contact Globex Cloud.",
    }),
  ).toHaveAttribute("href", "mailto:help@globex-cloud.example");
  await expect(
    companyAdmin.getByRole("button", { name: "Upgrade" }),
  ).toHaveCount(0);
  const webhook = await request.post("/api/billing/webhook", { data: "{}" });
  expect(webhook.status()).toBe(404);
});

test("company administrator: meets none of the instance's own settings", async () => {
  await goTo(companyAdmin, "/admin/general");
  await expect(
    companyAdmin.getByRole("heading", { level: 1, name: "General" }),
  ).toBeVisible({ timeout: 15_000 });
  for (const card of ["This instance", "Registration", "Update check"]) {
    await expect(
      companyAdmin.getByRole("heading", { level: 2, name: card, exact: true }),
    ).toHaveCount(0);
  }
  await expectNotFound(companyAdmin, "/operator");
});

test("company administrator: invites a workspace administrator and a member", async () => {
  const adminPath = await inviteByEmail(companyAdmin, WORKSPACE_ADMIN.email);
  const memberPath = await inviteByEmail(companyAdmin, MEMBER.email);
  await joinAsNewcomer(workspaceAdmin, adminPath, WORKSPACE_ADMIN);
  await joinAsNewcomer(member, memberPath, MEMBER);
  await makeAdministrator(
    companyAdmin,
    await memberIdIn(pool, workspaceId, WORKSPACE_ADMIN.email),
  );
  expect(await roleIn(pool, workspaceId, WORKSPACE_ADMIN.email)).toBe("admin");
  expect(await roleIn(pool, workspaceId, MEMBER.email)).toBe("member");
});

test("workspace administrator: reads the plan and runs invitations", async () => {
  await goTo(workspaceAdmin, "/admin/plan");
  await expect(workspaceAdmin.getByText("3 of 5", { exact: true })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await goTo(workspaceAdmin, "/admin/invitations");
  await expect(
    workspaceAdmin.getByLabel("Email address", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expectNotFound(workspaceAdmin, "/operator");
});

test("member: does the work, and is offered the provider's own source", async () => {
  await goTo(member, "/");
  await expect(
    member.getByRole("heading", { level: 1, name: "My week" }),
  ).toBeVisible({ timeout: 20_000 });
  await writeObjective(member, pool, `Cut onboarding time in half ${RUN}`);
  await goTo(member, "/");
  await member
    .getByRole("button", { name: /account|menu/i })
    .first()
    .click();
  await expect(
    member.getByRole("menuitem", { name: "Source code" }),
  ).toHaveAttribute("href", SETTINGS["instance.sourceUrl"]);
  await expectNotFound(member, "/admin/plan");
  await expectNotFound(member, "/admin");
});

test("operator: moves the customer to Growth once their invoice is paid", async () => {
  await signUp(operator, OPERATOR);
  await grantOperator(pool, OPERATOR);
  await goTo(operator, "/operator");
  await expect(
    operator.locator(`a[href="/operator/${workspaceId}"]`),
  ).toHaveText(WORKSPACE, {
    timeout: 15_000,
  });
  await operatorSetsPlan(
    operator,
    workspaceId,
    WORKSPACE,
    "growth",
    "Invoice 2026-114 was paid.",
  );
});

test("company administrator: sees Growth and its seats", async () => {
  await goTo(companyAdmin, "/admin/plan");
  await expect(companyAdmin.getByText("3 of 25", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test("operator: a site message for one customer reaches its people and nobody else", async () => {
  await goTo(operator, "/operator/instance");
  const at = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 16);
  await operator.getByLabel("Message", { exact: true }).fill(MESSAGE);
  await fillDateTime(operator, "Shows from", at(-5));
  await fillDateTime(operator, "Stops at", at(60));
  await operator.locator(`#target-${workspaceId}`).check();
  await operator.getByRole("button", { name: "Show this message" }).click();
  await expect(
    operator.getByText("Saved. It shows in the window you set."),
  ).toBeVisible({ timeout: 15_000 });

  for (const page of [member, companyAdmin]) {
    await goTo(page, "/");
    await expect(
      page.getByRole("status").filter({ hasText: MESSAGE }),
    ).toBeVisible({ timeout: 15_000 });
  }
  // The operator's own workspace was not named, so it does not see it.
  await goTo(operator, "/");
  await expect(operator.getByText(OPERATOR_WORKSPACE).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(operator.getByText(MESSAGE)).toHaveCount(0);
});
