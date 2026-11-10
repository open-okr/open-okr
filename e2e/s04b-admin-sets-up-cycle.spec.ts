/**
 * An Admin sets up a cycle (plan 0.8.0 R1, docs/design/workspace-roles.md §12).
 *
 * Acceptance criteria:
 *   Given a Member on Phase 1, then the Roles and planning sessions card is
 *   not drawn for them.
 *   Given the Owner gives them the Admin role, when they open Phase 1 again,
 *   then the card is drawn and the sponsor they choose is saved, and the
 *   archive control, which stays with the Owner, is not drawn.
 *
 * "Make administrator" on a person's page is not used here: it grants `full`
 * on the workspace, the Owner's level, so it would prove nothing about the
 * Admin role.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  inviteByEmail,
  joinAsNewcomer,
  personContext,
  RUN,
} from "./hosting.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";
import { choose } from "./pickers.ts";

test.describe.configure({ mode: "serial" });

const person = {
  name: `Cycle Admin ${RUN}`,
  email: `cycle-admin-${RUN}@example.com`,
};

let ownerContext: BrowserContext;
let owner: Page;
let adminContext: BrowserContext;
let admin: Page;

test.beforeAll(async ({ browser }) => {
  ownerContext = await browser.newContext();
  owner = await ownerContext.newPage();
  await signIn(owner);
  const joinPath = await inviteByEmail(owner, person.email);
  adminContext = await personContext(browser);
  admin = await adminContext.newPage();
  await joinAsNewcomer(admin, joinPath, person);
});

test.afterAll(async () => {
  await adminContext?.close();
  await ownerContext?.close();
});

const setupCard = (page: Page) =>
  page.locator("form", { has: page.getByLabel("Sponsor") });

test("a Member does not get the cycle's setup card", async () => {
  await goTo(admin, "/cycle?phase=1");
  await expect(
    admin.getByRole("heading", { name: "Roles and planning sessions" }),
  ).toHaveCount(0);
  await expect(setupCard(admin)).toHaveCount(0);
});

test("given the Admin role, they name the sponsor", async () => {
  await goTo(owner, "/admin/roles");
  const assign = owner.getByRole("combobox", {
    name: `Role for ${person.name}`,
    exact: true,
  });
  await choose(assign, "Admin");
  await expect(assign).toHaveValue("Admin", { timeout: 15_000 });

  await goTo(admin, "/cycle?phase=1");
  const setup = setupCard(admin);
  await expect(setup).toBeVisible({ timeout: 15_000 });
  await choose(setup.getByLabel("Sponsor"), person.name);
  await setup.getByRole("button", { name: "Save" }).click();
  await goTo(admin, "/cycle?phase=1");
  await expect(setupCard(admin).getByLabel("Sponsor")).toHaveValue(
    person.name,
    { timeout: 15_000 },
  );

  // Archiving stays with the Owner (R1-Q3).
  await expect(admin.getByTestId("archive-cycle")).toHaveCount(0);

  // Back to the instance account, so a spec after this one meets the sponsor
  // the claim named.
  await choose(setupCard(admin).getByLabel("Sponsor"), INSTANCE_ACCOUNT.name);
  await setupCard(admin).getByRole("button", { name: "Save" }).click();
  await goTo(admin, "/cycle?phase=1");
  await expect(setupCard(admin).getByLabel("Sponsor")).toHaveValue(
    INSTANCE_ACCOUNT.name,
    { timeout: 15_000 },
  );
});
