/**
 * Setup 1: OKRGoal, the cloud OKR Institute runs (PLAN.md §5.2,
 * docs/design/hosting-test-matrix.md).
 *
 * The cloud flag on, OKRGoal's catalogue with a free default plan, Stripe, open
 * sign-up, and a retention window for closed workspaces. Anybody signs up and
 * gets a free workspace, pays to grow it, and can close it.
 *
 * | Person | Who they are here |
 * |---|---|
 * | Operator | OKR Institute's staff, granted the role by the deployment |
 * | Company administrator | The customer who signed up, owns the workspace and pays for it |
 * | Workspace administrator | Appointed by the customer |
 * | Member | Works in the customer's workspace |
 *
 * **The plans' seats and credits are the suite's, not OKRGoal's**, and they name
 * no Stripe price, so the plan screen never asks Stripe for one. What does reach
 * the server from Stripe here is a webhook, signed exactly as Stripe signs it,
 * which needs no network. A checkout, a subscription and the customer portal do
 * need Stripe, and are proved in `packages/core/test` and by the test-mode run
 * the matrix records.
 */
import type { BrowserContext, Page } from "@playwright/test";
import type pg from "pg";
import { expect, test } from "./fixtures.ts";
import {
  applySecret,
  applySettings,
  clearSettings,
  expectNotFound,
  grantOperator,
  instancePool,
  inviteByEmail,
  joinAsNewcomer,
  MailCatcher,
  makeAdministrator,
  memberIdIn,
  onlyWorkspaceOf,
  operatorMoves,
  operatorSetsPlan,
  type Person,
  personContext,
  RUN,
  revokeOperator,
  roleIn,
  signUp,
  stripeSignature,
  writeObjective,
} from "./hosting.ts";
import { goTo } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const OPERATOR: Person = {
  name: "Olivia Ong",
  email: `olivia.${RUN}@okr-institute.example`,
};
const COMPANY_ADMIN: Person = {
  name: "Chen Wei",
  email: `chen.${RUN}@acme-sdn-bhd.example`,
};
const WORKSPACE_ADMIN: Person = {
  name: "Aisha Rahman",
  email: `aisha.${RUN}@acme-sdn-bhd.example`,
};
const MEMBER: Person = {
  name: "Ravi Nair",
  email: `ravi.${RUN}@acme-sdn-bhd.example`,
};
const ONE_TOO_MANY = `extra.${RUN}@acme-sdn-bhd.example`;
const WORKSPACE = `${COMPANY_ADMIN.name}'s workspace`;

const WEBHOOK_SECRET = `whsec_e2e_${RUN}`;
const SETTINGS = {
  "cloud.enabled": true,
  "instance.name": "OKRGoal",
  "instance.termsUrl": "https://okrgoal.com/terms",
  "instance.privacyUrl": "https://okrgoal.com/privacy",
  "instance.supportEmail": "support@okrgoal.com",
  "cloud.plans": [
    { key: "free", name: "Free", seats: 3, aiCredits: 100 },
    { key: "team", name: "Team", seats: 10, aiCredits: 2000, aiTopUps: true },
    {
      key: "business",
      name: "Business",
      seats: 50,
      aiCredits: 10000,
      aiTopUps: true,
    },
  ],
  "cloud.defaultPlan": "free",
  "cloud.closureRetentionDays": 30,
  "billing.provider": "stripe",
};
const SECRETS = {
  // Never sent anywhere: nothing on these screens asks Stripe for anything.
  "billing.stripe.secretKey": "sk_test_e2e_never_sent",
  "billing.stripe.webhookSecret": WEBHOOK_SECRET,
};

let pool: pg.Pool;
let mail: MailCatcher;
const contexts: BrowserContext[] = [];
let operator: Page;
let companyAdmin: Page;
let workspaceAdmin: Page;
let member: Page;
let workspaceId = "";

/** A credit pack paid at Stripe, as its checkout's completion arrives. */
function creditPackEvent(): string {
  return JSON.stringify({
    id: `evt_e2e_${RUN}`,
    object: "event",
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `cs_e2e_${RUN}`,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        customer: `cus_e2e_${RUN}`,
        metadata: {
          workspace_id: workspaceId,
          credits: "1000",
          credit_months: "12",
        },
      },
    },
  });
}

test.beforeAll(async ({ browser }) => {
  pool = instancePool();
  mail = await MailCatcher.start();
  await applySettings(pool, { ...SETTINGS, ...mail.settings() });
  for (const [key, secret] of Object.entries(SECRETS)) {
    await applySecret(pool, key, secret);
  }
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
    if (workspaceId) {
      // Each step below puts the workspace back; this is the net under them.
      await pool.query("update workspaces set state = 'active' where id = $1", [
        workspaceId,
      ]);
      await pool.query(
        "update tenants set state = 'active', closed_at = null where workspace_id = $1",
        [workspaceId],
      );
    }
    await clearSettings(pool, [
      ...Object.keys(SETTINGS),
      ...Object.keys(SECRETS),
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

test("a visitor meets OKRGoal's own name and legal pages", async ({
  browser,
}) => {
  const visitor = await personContext(browser);
  const page = await visitor.newPage();
  await goTo(page, "/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in to OKRGoal" }),
  ).toBeVisible({ timeout: 15_000 });
  await goTo(page, "/sign-up");
  await expect(
    page.getByRole("link", { name: "Terms of service" }),
  ).toHaveAttribute("href", "https://okrgoal.com/terms");
  await expect(
    page.getByRole("link", { name: "Privacy policy" }),
  ).toHaveAttribute("href", "https://okrgoal.com/privacy");
  await visitor.close();
});

test("company administrator: signs up and gets a workspace on the free plan", async () => {
  await signUp(companyAdmin, COMPANY_ADMIN);
  workspaceId = await onlyWorkspaceOf(pool, COMPANY_ADMIN.email);
  expect(await roleIn(pool, workspaceId, COMPANY_ADMIN.email)).toBe("owner");

  await goTo(companyAdmin, "/admin/plan");
  await expect(
    companyAdmin.getByRole("heading", { level: 1, name: "Plan and seats" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    companyAdmin.getByText("Free", { exact: true }).first(),
  ).toBeVisible();
  await expect(companyAdmin.getByText("1 of 3", { exact: true })).toBeVisible();
  // Billing is on, so the catalogue is the billing panel, with this plan marked.
  await expect(
    companyAdmin
      .getByRole("listitem")
      .filter({ hasText: "Free" })
      .getByText("Current plan", { exact: true }),
  ).toBeVisible();
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

test("company administrator: a second free workspace is refused, naming the limit", async () => {
  await goTo(companyAdmin, "/workspaces/new");
  await companyAdmin
    .getByLabel("Name", { exact: true })
    .fill(`Side project ${RUN}`);
  await companyAdmin.getByRole("button", { name: "Create workspace" }).click();
  await expect(companyAdmin.getByRole("main").getByRole("alert")).toHaveText(
    "You already own 1 free workspace, which is the limit here. Move one to a paid plan to start another.",
    { timeout: 15_000 },
  );
});

test("company administrator: two people join, and the plan shows every seat taken", async () => {
  const adminPath = await inviteByEmail(companyAdmin, WORKSPACE_ADMIN.email);
  const memberPath = await inviteByEmail(companyAdmin, MEMBER.email);
  await joinAsNewcomer(workspaceAdmin, adminPath, WORKSPACE_ADMIN);
  await joinAsNewcomer(member, memberPath, MEMBER);

  await goTo(companyAdmin, "/admin/plan");
  await expect(companyAdmin.getByText("3 of 3", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(companyAdmin.getByText(/^Every seat is taken\./)).toBeVisible();
});

test("company administrator: the next invitation is refused, naming the seats", async () => {
  await goTo(companyAdmin, "/admin/invitations");
  await companyAdmin
    .getByLabel("Email address", { exact: true })
    .fill(ONE_TOO_MANY);
  await companyAdmin
    .getByRole("button", { name: "Create the invitation" })
    .click();
  await expect(
    companyAdmin.getByText(
      "This workspace has 3 of 3 seats in use. Free one, or add seats, before inviting anybody else.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(companyAdmin.getByTestId("invite-link")).toHaveCount(0);
});

test("company administrator: makes one of them an administrator", async () => {
  await makeAdministrator(
    companyAdmin,
    await memberIdIn(pool, workspaceId, WORKSPACE_ADMIN.email),
  );
  expect(await roleIn(pool, workspaceId, WORKSPACE_ADMIN.email)).toBe("admin");
  expect(await roleIn(pool, workspaceId, MEMBER.email)).toBe("member");
});

test("workspace administrator: reads the plan and seats, and runs invitations", async () => {
  await goTo(workspaceAdmin, "/admin/plan");
  await expect(workspaceAdmin.getByText("3 of 3", { exact: true })).toBeVisible(
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

test("member: does the work, and meets no plan or billing anywhere", async () => {
  await goTo(member, "/");
  await expect(
    member.getByRole("heading", { level: 1, name: "My week" }),
  ).toBeVisible({ timeout: 20_000 });
  await writeObjective(member, pool, `Win ten new accounts ${RUN}`);
  await expectNotFound(member, "/admin/plan");
  await expectNotFound(member, "/admin");
  await expectNotFound(member, "/operator");
});

test("operator: finds the customer, and moves them to Team after an invoice", async () => {
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
    "team",
    "Paid by invoice for a year.",
  );
});

test("company administrator: sees Team, its seats and its credits", async () => {
  await goTo(companyAdmin, "/admin/plan");
  await expect(companyAdmin.getByText("3 of 10", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(companyAdmin.getByText(/of 2,000 used$/)).toBeVisible();
});

test("a credit pack paid at Stripe reaches the plan screen, with when it expires", async ({
  request,
}) => {
  const body = creditPackEvent();
  const forged = await request.post("/api/billing/webhook", {
    data: body,
    headers: {
      "content-type": "application/json",
      "stripe-signature": stripeSignature(body, "whsec_somebody_else"),
    },
  });
  expect(forged.status()).toBe(400);

  for (let delivery = 0; delivery < 2; delivery += 1) {
    // Stripe delivers at least once, so the second is the same event again.
    const answer = await request.post("/api/billing/webhook", {
      data: body,
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripeSignature(body, WEBHOOK_SECRET),
      },
    });
    expect(answer.status()).toBe(200);
  }

  await goTo(companyAdmin, "/admin/plan");
  await expect(
    companyAdmin.getByText(
      /^1,000 purchased credits left\. 1,000 of these expire on \w+ \d{1,2}, \d{4}\.$/,
    ),
  ).toBeVisible({ timeout: 15_000 });
});

test("operator: suspends the workspace; the member is told, and the owner cannot lift it", async () => {
  await operatorMoves(
    operator,
    workspaceId,
    WORKSPACE,
    "suspended",
    "Your invoice is thirty days overdue. Reply to billing to restore it.",
  );
  await goTo(member, "/");
  await expect(member.getByTestId("workspace-state-banner")).toContainText(
    "Only the provider can lift it.",
    { timeout: 15_000 },
  );
  await goTo(companyAdmin, "/admin/general");
  await expect(
    companyAdmin.getByTestId("workspace-state-current"),
  ).toContainText("Suspended by the provider", { timeout: 15_000 });
  await expect(companyAdmin.getByTestId("set-state-active")).toHaveCount(0);

  await operatorMoves(
    operator,
    workspaceId,
    WORKSPACE,
    "active",
    "The invoice was paid. Thank you.",
  );
  await goTo(member, "/");
  await expect(member.getByTestId("workspace-state-banner")).toHaveCount(0, {
    timeout: 15_000,
  });
});

test("company administrator: closes the workspace; administrators get the email; everybody sees the date", async () => {
  await goTo(companyAdmin, "/admin/general");
  const card = companyAdmin.getByTestId("close-workspace-card");
  await expect(card).toContainText("it is deleted for good on", {
    timeout: 15_000,
  });
  const label = await card.getByText(/^Type .+ to confirm$/).innerText();
  const slug = label.replace(/^Type /, "").replace(/ to confirm$/, "");
  await companyAdmin.getByTestId("close-workspace-slug").fill(slug);
  await companyAdmin.getByTestId("close-workspace-submit").click();
  await expect(
    companyAdmin.getByTestId("workspace-state-banner"),
  ).toContainText(
    /was closed on .+ and will be deleted on .+\. Export it before then\./,
    { timeout: 15_000 },
  );

  for (const person of [COMPANY_ADMIN, WORKSPACE_ADMIN]) {
    await mail.waitFor(person.email, new RegExp(`${WORKSPACE} is closed`));
  }

  await goTo(member, "/");
  await expect(member.getByTestId("workspace-state-banner")).toContainText(
    /will be deleted on/,
    { timeout: 15_000 },
  );
  await goTo(operator, `/operator/${workspaceId}`);
  await expect(operator.getByText(/^Closed on /).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("company administrator: reopens it, and nobody sees a closure", async () => {
  await goTo(companyAdmin, "/admin/general");
  await companyAdmin.getByTestId("reopen-workspace").click();
  await expect(companyAdmin.getByTestId("workspace-state-banner")).toHaveCount(
    0,
    { timeout: 15_000 },
  );
  await goTo(member, "/");
  await expect(member.getByTestId("workspace-state-banner")).toHaveCount(0, {
    timeout: 15_000,
  });
});

/**
 * **Found by this file, and not fixed by it.** plans-and-seats.md §2 makes an
 * invited person a seat, "the load-bearing choice", and the plan screen tells
 * the administrator so. But a personal invitation writes no member row until
 * it is accepted, and seats count member rows, so while seats are free any
 * number of invitations succeed and the surplus is refused at the link
 * instead. docs/design/hosting-test-matrix.md records it as a defect. Last in
 * the file so its invitation holds nothing a later test needs, and on Team, so
 * there are seats to hold.
 */
test.fixme("company administrator: a pending invitation holds a seat, as plans-and-seats.md §2 says", async () => {
  await inviteByEmail(companyAdmin, `pending.${RUN}@acme-sdn-bhd.example`);
  await goTo(companyAdmin, "/admin/plan");
  await expect(companyAdmin.getByText("4 of 10", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
});
