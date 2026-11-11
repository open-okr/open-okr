/**
 * Setup 4: one organisation with several workspaces (PLAN.md §5.2,
 * docs/design/hosting-test-matrix.md).
 *
 * The cloud flag on, no plans, no billing, invitation only. One company runs its
 * own instance and splits itself into workspaces, one per division. Its IT team
 * is the operator, so workspaces come from them and nobody else.
 *
 * | Person | Who they are here |
 * |---|---|
 * | Operator | The company's IT, a member of its first workspace, granted the operator role by the deployment |
 * | Company administrator | Owns every division's workspace |
 * | Workspace administrator | Administers Sales, and is an ordinary member of Engineering |
 * | Member | Works in Sales only |
 *
 * The first workspace is the one the suite's claim made, and the IT person
 * joins it through an invitation, because sign-up is closed here as it is on a
 * real instance of this shape.
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
  joinWhileSignedIn,
  MailCatcher,
  makeAdministrator,
  memberIdIn,
  type Person,
  personContext,
  RUN,
  revokeOperator,
  roleIn,
  switcherOptions,
  switchWorkspace,
  workspaceIdNamed,
  writeObjective,
} from "./hosting.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OPERATOR: Person = {
  name: "Tara Tan",
  email: `tara.${RUN}@acme-group.example`,
};
const COMPANY_ADMIN: Person = {
  name: "Helen Ho",
  email: `helen.${RUN}@acme-group.example`,
};
const WORKSPACE_ADMIN: Person = {
  name: "Sam Sharma",
  email: `sam.${RUN}@acme-group.example`,
};
const MEMBER: Person = {
  name: "Lee Lim",
  email: `lee.${RUN}@acme-group.example`,
};
const SALES = `Acme Sales ${RUN}`;
const ENGINEERING = `Acme Engineering ${RUN}`;

const SETTINGS = {
  "cloud.enabled": true,
  "registration.policy": "invite_only",
};

let pool: pg.Pool;
let mail: MailCatcher;
const contexts: BrowserContext[] = [];
let operator: Page;
let companyAdmin: Page;
let workspaceAdmin: Page;
let member: Page;
let salesId = "";
let engineeringId = "";
let salesObjective = "";
let engineeringObjective = "";

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
  companyAdmin = await open();
  workspaceAdmin = await open();
  member = await open();
});

// Undone whatever happened above, so no later spec runs against a cloud.
test.afterAll(async () => {
  if (pool) {
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

test("a visitor finds sign-up closed: people arrive by invitation", async ({
  browser,
}) => {
  const visitor = await personContext(browser);
  const page = await visitor.newPage();
  await goTo(page, "/sign-up");
  await expect(
    page.getByRole("heading", { name: "Registration is closed" }),
  ).toBeVisible({ timeout: 15_000 });
  await visitor.close();
});

test("operator: the company's IT joins its first workspace and is granted the console", async ({
  page,
}) => {
  await signIn(page);
  const joinPath = await inviteByEmail(page, OPERATOR.email);
  await joinAsNewcomer(operator, joinPath, OPERATOR);
  await expectNotFound(operator, "/operator");

  await grantOperator(pool, OPERATOR);
  await goTo(operator, "/operator");
  await expect(
    operator.getByRole("heading", { level: 1, name: "Workspaces" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("operator: a workspace for Sales, for somebody with no account yet, goes out by email", async () => {
  await goTo(operator, "/operator");
  await operator.getByLabel("Workspace name").fill(SALES);
  await operator
    .getByLabel("First administrator's email")
    .fill(COMPANY_ADMIN.email);
  await operator.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    operator.getByText(
      `Created. An invitation went to ${COMPANY_ADMIN.email}.`,
    ),
  ).toBeVisible({ timeout: 15_000 });
  salesId = await workspaceIdNamed(pool, SALES);
});

test("company administrator: follows the email and owns Sales", async () => {
  const invitation = await mail.waitFor(COMPANY_ADMIN.email, /\/join\//);
  await joinAsNewcomer(companyAdmin, joinPathIn(invitation), COMPANY_ADMIN);
  await expect(companyAdmin.getByText(SALES).first()).toBeVisible();
  expect(await roleIn(pool, salesId, COMPANY_ADMIN.email)).toBe("owner");
  // The operator made it and is still outside it.
  expect(await roleIn(pool, salesId, OPERATOR.email)).toBeNull();
});

test("operator: a second workspace for the same person is theirs straight away", async () => {
  await goTo(operator, "/operator");
  await operator.getByLabel("Workspace name").fill(ENGINEERING);
  await operator
    .getByLabel("First administrator's email")
    .fill(COMPANY_ADMIN.email);
  await operator.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    operator.getByText(`Created. ${COMPANY_ADMIN.email} owns it.`),
  ).toBeVisible({ timeout: 15_000 });
  engineeringId = await workspaceIdNamed(pool, ENGINEERING);
  expect(await roleIn(pool, engineeringId, COMPANY_ADMIN.email)).toBe("owner");
});

test("company administrator: moves between the company's workspaces", async () => {
  await goTo(companyAdmin, "/");
  expect(await switcherOptions(companyAdmin)).toEqual(
    expect.arrayContaining([SALES, ENGINEERING]),
  );
  await switchWorkspace(companyAdmin, ENGINEERING);
  await switchWorkspace(companyAdmin, SALES);
});

test("company administrator: no plan, no seat limit, no way to start a workspace, no instance settings", async () => {
  await expectNotFound(companyAdmin, "/admin/plan");
  await expectNotFound(companyAdmin, "/workspaces/new");
  await expectNotFound(companyAdmin, "/operator");
  await goTo(companyAdmin, "/admin/general");
  await expect(
    companyAdmin.getByRole("heading", { level: 1, name: "General" }),
  ).toBeVisible({ timeout: 15_000 });
  for (const card of ["This instance", "Registration", "Update check"]) {
    await expect(
      companyAdmin.getByRole("heading", { level: 2, name: card, exact: true }),
    ).toHaveCount(0);
  }
});

test("company administrator: appoints an administrator for Sales and invites a member", async () => {
  // Two whole sign-ups, each through its own welcome (plan 0.8.0 S4).
  test.setTimeout(90_000);
  // Sales is the active workspace after the switch above.
  const adminPath = await inviteByEmail(companyAdmin, WORKSPACE_ADMIN.email);
  const memberPath = await inviteByEmail(companyAdmin, MEMBER.email);
  await joinAsNewcomer(workspaceAdmin, adminPath, WORKSPACE_ADMIN);
  await joinAsNewcomer(member, memberPath, MEMBER);

  await makeAdministrator(
    companyAdmin,
    await memberIdIn(pool, salesId, WORKSPACE_ADMIN.email),
  );
  expect(await roleIn(pool, salesId, WORKSPACE_ADMIN.email)).toBe("admin");
  expect(await roleIn(pool, salesId, MEMBER.email)).toBe("member");
});

test("company administrator: asks the Sales administrator into Engineering as an ordinary member", async () => {
  await switchWorkspace(companyAdmin, ENGINEERING);
  const joinPath = await inviteByEmail(companyAdmin, WORKSPACE_ADMIN.email);
  await joinWhileSignedIn(workspaceAdmin, joinPath, ENGINEERING);
  expect(await roleIn(pool, engineeringId, WORKSPACE_ADMIN.email)).toBe(
    "member",
  );
  engineeringObjective = await writeObjective(
    companyAdmin,
    pool,
    `Ship the platform release ${RUN}`,
  );
});

test("workspace administrator: runs Sales, and holds no admin in Engineering", async () => {
  await goTo(workspaceAdmin, "/");
  await switchWorkspace(workspaceAdmin, SALES);
  await goTo(workspaceAdmin, "/admin/invitations");
  await expect(
    workspaceAdmin.getByLabel("Email address", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expectNotFound(workspaceAdmin, "/operator");

  await goTo(workspaceAdmin, "/");
  await switchWorkspace(workspaceAdmin, ENGINEERING);
  await expectNotFound(workspaceAdmin, "/admin/invitations");
});

test("member: works in Sales and has nowhere else to go", async () => {
  await goTo(member, "/");
  await expect(
    member.getByRole("heading", { level: 1, name: "My week" }),
  ).toBeVisible({ timeout: 20_000 });
  expect(await switcherOptions(member)).toEqual([]);
  salesObjective = await writeObjective(
    member,
    pool,
    `Grow repeat orders ${RUN}`,
  );
  await expectNotFound(member, "/admin");
  await expectNotFound(member, "/operator");
});

test("member: Engineering's objective is not found, even with its address and a forged workspace cookie", async () => {
  await expectNotFound(member, `/goals/${engineeringObjective}`);
  // A hand-edited choice of workspace picks nothing the member could not reach.
  await member.context().addCookies([
    {
      name: "openokr_workspace",
      value: engineeringId,
      url: new URL(member.url()).origin,
    },
  ]);
  await goTo(member, "/");
  await expect(member.getByText(ENGINEERING)).toHaveCount(0);
  await expectNotFound(member, `/goals/${engineeringObjective}`);
  // Their own objective still opens.
  await goTo(member, `/goals/${salesObjective}`);
  await expect(
    member.getByText(`Grow repeat orders ${RUN}`).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("operator: sees the company's workspaces as counts, and cannot open what is inside", async () => {
  await goTo(operator, "/operator");
  await expect(operator.getByRole("link", { name: SALES })).toBeVisible({
    timeout: 15_000,
  });
  await expect(operator.getByRole("link", { name: ENGINEERING })).toBeVisible();
  await expectNotFound(operator, `/goals/${salesObjective}`);
});
