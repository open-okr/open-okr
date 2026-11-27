import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import {
  type FlowyteamStub,
  STUB_COMPANY,
  STUB_PEOPLE,
  startFlowyteamStub,
} from "./flowyteam-stub.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * S-36 Import, "From FlowyTeam" (docs/design/flowyteam-connect.md §4.5, §7
 * AC 1, 4, 8, 9; card C5).
 *
 * Against a FlowyTeam stand-in (`flowyteam-stub.ts`): connect and come back
 * linked, preview in the background, be held at the restricted-KPI tick,
 * import, close the invite step with "Not now" and find nobody invited, then
 * the linked state with "Import new data".
 *
 * **It relies on the claim and nothing else.** On a retry the workspace may
 * already be connected or imported, so each step accepts the state an earlier
 * attempt left rather than assuming a fresh one.
 */

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let stub: FlowyteamStub;

const card = () => page.getByTestId("flowyteam-card");

test.beforeAll(async ({ browser }) => {
  stub = await startFlowyteamStub();
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
  await stub?.close();
});

test("connects FlowyTeam and comes back connected", async () => {
  await goTo(page, "/admin/imports");
  await expect(card()).toBeVisible();
  const connect = page.getByTestId("flowyteam-connect");
  if (await connect.isVisible()) {
    await expect(page.getByTestId("flowyteam-state")).toHaveText(
      "Not connected",
    );
    await connect.click();
    await page.waitForURL(/\/admin\/imports\?flowyteam=connected/);
    // Said once, by the connection row, not by a banner as well.
    await expect(page.getByTestId("flowyteam-company")).toBeVisible();
    await expect(page.getByTestId("flowyteam-outcome")).toBeHidden();
  }
  await expect(page.getByTestId("flowyteam-state")).toHaveText("Connected");
  await expect(page.getByTestId("flowyteam-company")).toContainText(
    STUB_COMPANY.name,
  );
});

test("previews in the background and holds the import at the KPI tick", async () => {
  const linked = page.getByTestId("flowyteam-linked");
  if (await linked.isVisible()) {
    await page.getByTestId("flowyteam-import-new").click();
  } else if (await page.getByTestId("flowyteam-run-preview").isVisible()) {
    await expect(page.getByTestId("flowyteam-choose")).toContainText(
      "People and teams",
    );
    await page.getByTestId("flowyteam-run-preview").click();
  }

  const preview = page.getByTestId("flowyteam-preview");
  await expect(preview).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("flowyteam-counts")).toContainText("Members");
  await expect(page.getByTestId("flowyteam-not-brought")).toContainText(
    "project_time_logs",
  );

  // AC 4: nothing is pressed until the admin accepts the broader visibility.
  await expect(page.getByTestId("flowyteam-restricted")).toBeVisible();
  const importButton = page.getByTestId("flowyteam-import");
  await expect(importButton).toBeDisabled();
  await page.getByTestId("flowyteam-accept").check();
  await expect(importButton).toBeEnabled();
});

test("imports, then sends no invitation until asked", async () => {
  await page.getByTestId("flowyteam-import").click();

  // The stream opens the invite step when the job ends; a re-read without
  // the stream lands on the linked state, which offers the same step.
  const invite = page.getByTestId("flowyteam-invite");
  const linked = page.getByTestId("flowyteam-linked");
  await expect(invite.or(linked)).toBeVisible({ timeout: 120_000 });
  if (!(await invite.isVisible())) {
    await page.getByTestId("flowyteam-open-invite").click();
  }

  for (const person of STUB_PEOPLE) {
    await expect(invite).toContainText(person.email);
  }
  await expect(page.getByTestId("flowyteam-invite-send")).toBeDisabled();

  // AC 9: "Not now" leaves everyone uninvited.
  await page.getByTestId("flowyteam-invite-not-now").click();
  await expect(invite).toBeHidden();
  await expect(linked).toBeVisible();
  await expect(page.getByTestId("flowyteam-company")).toContainText(
    `Linked to ${STUB_COMPANY.name}`,
  );
  await expect(page.getByTestId("flowyteam-open-invite")).toContainText(
    `(${STUB_PEOPLE.length})`,
  );

  await page.reload();
  await expect(page.getByTestId("flowyteam-open-invite")).toContainText(
    `(${STUB_PEOPLE.length})`,
  );
  await expect(page.getByTestId("flowyteam-import-new")).toBeVisible();
  await expect(page.getByTestId("import-runs")).toContainText("FlowyTeam");
});

test("says FlowyTeam needs an update when the catalogues differ", async () => {
  // AC 6: the run stops before writing and the card says why.
  stub.version = "a-catalogue-flowyteam-has-not-vendored";
  try {
    await page.getByTestId("flowyteam-import-new").click();
    await expect(page.getByTestId("flowyteam-failure")).toHaveText(
      "FlowyTeam needs an update before this import.",
      { timeout: 120_000 },
    );
    await expect(page.getByTestId("flowyteam-linked")).toBeVisible();
  } finally {
    stub.version = null;
  }
});

test("offers Connect again once FlowyTeam revoked the access", async () => {
  // AC 8: the card says the access was revoked; imported data is unchanged.
  stub.revoked = true;
  try {
    await page.getByTestId("flowyteam-import-new").click();
    await expect(page.getByTestId("flowyteam-revoked")).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId("flowyteam-connect")).toHaveText(
      "Connect again",
    );
    await expect(page.getByTestId("flowyteam-state")).toHaveText(
      "Access revoked",
    );
  } finally {
    stub.revoked = false;
  }
  await goTo(page, "/admin/imports");
  await expect(page.getByTestId("import-runs")).toContainText("FlowyTeam");
});
