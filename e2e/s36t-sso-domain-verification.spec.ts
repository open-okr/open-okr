/**
 * Proving a single sign-on domain from the screen
 * (docs/design/sso-domain-verification.md, "Screens").
 *
 * Acceptance criteria this file holds the screen to:
 *   Given a connection that lists a domain, When an administrator opens
 *   Verify, Then the dialog shows the TXT record to publish and copies it.
 *   Given the record is not published, When they press Check now, Then the
 *   refusal is said in the dialog and the domain stays unverified.
 *   Given a domain that is not verified, Then enforcement cannot be turned on
 *   and the screen says why.
 *   Given a self-hosted instance, When the administrator marks the domain
 *   verified with a reason, Then the chip reads Verified and enforcement can
 *   be turned on.
 *
 * **No record can be published from a test**, so the success of a DNS check is
 * proved against a fake resolver in `packages/core/test`. What only a browser
 * can show is the dialog: the record on screen, the copy controls, the failed
 * check's message and the manual override. The domain ends the file verified
 * by hand, which is the path an air-gapped instance takes.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const PROVIDER = {
  providerId: "verify-idp",
  displayName: "Sign in with Verify",
  domain: "verify.test",
};

const row = () => page.getByTestId(`sso-connection-${PROVIDER.providerId}`);
const domainRow = () => row().getByTestId(`sso-domain-${PROVIDER.domain}`);
const dialog = () =>
  page.getByRole("dialog", { name: `Verify ${PROVIDER.domain}` });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  // Not the system's own clipboard: a refused write is a path of its own.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("a listed domain shows as not verified, and enforcement waits for it", async () => {
  await goTo(page, "/admin/sso");

  await page.getByLabel("Protocol").selectOption("oidc");
  await page.getByLabel("Provider ID").fill(PROVIDER.providerId);
  await page.getByLabel("Display name").fill(PROVIDER.displayName);
  await page
    .getByLabel("Authorization URL")
    .fill("https://idp.test/oauth2/authorize");
  await page.getByLabel("Token URL").fill("https://idp.test/oauth2/token");
  await page.getByLabel("Client ID").fill("verify-client");
  await page.getByLabel("Client secret").fill("verify-secret");
  await page
    .getByLabel("Email domains", { exact: true })
    .fill(PROVIDER.domain);
  await page.getByRole("button", { name: "Add provider" }).click();
  await expect(page.getByRole("status")).toContainText("Provider saved");

  await goTo(page, "/admin/sso");
  await expect(domainRow()).toContainText(PROVIDER.domain);
  await expect(domainRow()).toContainText("Not verified");
  await expect(
    domainRow().getByRole("button", { name: `Verify ${PROVIDER.domain}` }),
  ).toBeEnabled();

  // Rule 3: the box is off, with the reason beside it, not a bare grey box.
  await row().getByRole("button", { name: "Edit", exact: true }).click();
  const form = row().getByRole("form", {
    name: `Edit ${PROVIDER.displayName}`,
  });
  const enforce = form.getByLabel(
    "Enforce SSO for the email domains listed above",
  );
  await expect(enforce).toBeDisabled();
  await expect(form).toContainText(`Verify ${PROVIDER.domain} first`);
  await form.getByRole("button", { name: "Cancel" }).click();
});

test("Verify shows the TXT record to publish, with copy controls", async () => {
  await goTo(page, "/admin/sso");
  await domainRow()
    .getByRole("button", { name: `Verify ${PROVIDER.domain}` })
    .click();

  await expect(dialog()).toBeVisible();
  const record = dialog().getByTestId("sso-domain-record");
  await expect(record).toContainText("TXT");
  await expect(dialog().getByTestId("sso-domain-record-name")).toHaveText(
    `_openokr-verify.${PROVIDER.domain}`,
  );
  const value = dialog().getByTestId("sso-domain-record-value");
  await expect(value).toContainText("openokr-verify=");
  const shown = (await value.textContent()) ?? "";

  await dialog().getByRole("button", { name: "Copy value" }).click();
  await expect(dialog().getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
  await dialog().getByRole("button", { name: "Copy name" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `_openokr-verify.${PROVIDER.domain}`,
  );
});

test("a check with no record published says so and verifies nothing", async () => {
  // Still open from the test above: the value is held for as long as it is.
  await dialog().getByRole("button", { name: "Check now" }).click();

  // Scoped to the dialog: Next.js gives every page a route announcer with
  // role=alert. Whether the resolver answers "no record" or says nothing at
  // all depends on the machine's network, and both are refusals to verify.
  await expect(dialog().getByRole("alert")).toContainText(
    /No TXT record was found|does not match|did not answer|no DNS resolver/,
    { timeout: 30_000 },
  );
  await expect(dialog().getByTestId("sso-domain-record-value")).toBeVisible();

  await dialog().getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(dialog()).toHaveCount(0);
  await expect(domainRow()).toContainText("Not verified");
});

test("reopened, the value is not shown again and a new record can be made", async () => {
  // Held in the page while the screen stays, so reloading is what loses it.
  await page.reload();
  await domainRow()
    .getByRole("button", { name: `Verify ${PROVIDER.domain}` })
    .click();
  await expect(dialog().getByTestId("sso-domain-record-value")).toHaveCount(0);
  await expect(dialog()).toContainText("The value was shown once");
  await dialog().getByRole("button", { name: "Make a new record" }).click();
  await expect(dialog().getByTestId("sso-domain-record-value")).toContainText(
    "openokr-verify=",
  );
});

test("an administrator marks the domain verified by hand, with a reason", async () => {
  const mark = dialog().getByRole("button", {
    name: "Mark verified by hand",
  });
  await mark.click();

  const submit = dialog().getByRole("button", {
    name: "Mark verified",
    exact: true,
  });
  // The reason is required: the button waits for one.
  await expect(submit).toBeDisabled();
  await dialog().getByLabel("Reason").fill("Internal network with no public DNS");
  await submit.click();

  await expect(
    dialog().getByText(`${PROVIDER.domain} is marked verified`),
  ).toBeVisible();
  await dialog().getByRole("button", { name: "Close", exact: true }).last().click();

  await goTo(page, "/admin/sso");
  await expect(domainRow()).toContainText("Verified");
  await expect(domainRow()).not.toContainText("Not verified");
  await expect(domainRow()).toContainText("Marked verified by an administrator");
  await expect(
    domainRow().getByRole("button", { name: `Verify ${PROVIDER.domain}` }),
  ).toHaveCount(0);

  // And enforcement is offered now.
  await row().getByRole("button", { name: "Edit", exact: true }).click();
  const form = row().getByRole("form", {
    name: `Edit ${PROVIDER.displayName}`,
  });
  await expect(
    form.getByLabel("Enforce SSO for the email domains listed above"),
  ).toBeEnabled();
  await form.getByRole("button", { name: "Cancel" }).click();
});
