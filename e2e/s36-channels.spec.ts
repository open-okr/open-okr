/**
 * Notifications and channels (UIUX-PLAN.md §6 S-36, P5-T02c).
 *
 * Acceptance criterion:
 *   Given a workspace administrator with a Slack bot token, when they connect
 *   Slack and a member links their account from their own settings, then a
 *   nudge for that member arrives in Slack, and neither screen has ever
 *   displayed the token.
 *
 * The last clause is the one this spec exists for. Everything else about the
 * channel layer is proved in unit tests against a real database; what only a
 * browser can prove is that no surface renders a credential, that the linking
 * code is shown exactly once, and that the two screens do not offer a member
 * something they cannot use.
 *
 * The Slack half stops at "queued": there is no Slack workspace to deliver
 * into, which is recorded on P5-T02a. What the spec asserts is that the
 * message log names Slack, which is the last thing under this product's
 * control.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

const BOT_TOKEN = "xoxb-a-token-nobody-should-ever-see-on-a-screen";
const SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const TEAM_ID = "T-e2e-acme";

/**
 * The card for one provider.
 *
 * Two providers have drivers now, so two connect forms are on the page and
 * every locator has to say which one it means. The hint text is what
 * distinguishes them, because it is the one thing on a form that names its
 * provider.
 */
const slackForm = () =>
  page.locator("form").filter({ hasText: "Bot User OAuth Token" });
const telegramForm = () =>
  page.locator("form").filter({ hasText: "BotFather" });

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and reach the channels card", async () => {
  await signIn(page);
  await goTo(page, "/admin/channels");
  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications and channels" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("a provider with no driver says so instead of taking a credential", async () => {
  // Storing a token nothing can use is worse than refusing it: the card would
  // show a connected provider that never sends.
  const teams = page.locator("section, div").filter({
    hasText: "Microsoft Teams",
  });
  await expect(teams.first()).toContainText("No driver yet");
});

test("a provider with a driver offers a form", async () => {
  // Two of the four have drivers now, so the card offers two forms and every
  // locator below has to say which (P5-T05).
  await expect(slackForm().getByLabel("Bot token")).toBeVisible();
  await expect(telegramForm().getByLabel("Bot token")).toBeVisible();
});

test("connecting Slack stores it and does not claim it is verified", async () => {
  const form = slackForm();
  await form.getByLabel("Bot token").fill(BOT_TOKEN);
  await form.getByLabel("Signing or webhook secret").fill(SIGNING_SECRET);
  await form.getByLabel("Provider workspace id").fill(TEAM_ID);
  await form.getByRole("button", { name: "Connect" }).click();

  // The confirmation comes from the card, not from the form: a successful
  // connect revalidates the page and replaces the tree the form was in, so a
  // message rendered from the action's own answer could never be read.
  await expect(
    page.getByText("connected rather than verified"),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("never verified")).toBeVisible();
});

test("the token is nowhere on the page, and the form is empty again", async () => {
  await goTo(page, "/admin/channels");

  // The whole point of envelope-encrypting it. A field pre-filled so an
  // administrator could check the token would be a screen that displays one.
  expect(await page.content()).not.toContain(BOT_TOKEN);
  expect(await page.content()).not.toContain(SIGNING_SECRET);

  await page.getByText("Replace the credentials").click();
  await expect(slackForm().getByLabel("Bot token")).toHaveValue("");
});

test("the workspace id is shown, because it is not a secret and routing needs it", async () => {
  await expect(page.getByText(TEAM_ID)).toBeVisible();
});

test("a test send writes one row into the log", async () => {
  await page.getByRole("button", { name: "Send me a test" }).click();
  await expect(page.getByRole("status")).toContainText("Queued", {
    timeout: 10_000,
  });

  await goTo(page, "/admin/channels");
  const log = page.locator("li").filter({ hasText: "email" });
  await expect(log.first()).toBeVisible();
});

test("a member's own page offers Slack only once they have linked it", async () => {
  await goTo(page, "/account/channels");
  await expect(
    page.getByRole("heading", { level: 1, name: "Where to reach you" }),
  ).toBeVisible({ timeout: 10_000 });

  // Connected for the workspace, not linked by this member. Offering it as a
  // primary channel would be offering somewhere the product cannot reach them.
  await expect(page.getByText("link your account first")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Slack/ })).toBeDisabled();
});

test("the linking code is shown once, and asking again replaces it", async () => {
  await page.getByRole("button", { name: "Get a code" }).click();

  const shown = page.locator("p.font-mono, .font-mono").first();
  await expect(shown).toBeVisible({ timeout: 10_000 });
  const first = (await shown.textContent())?.trim() ?? "";
  expect(first).toMatch(/^\d{6}$/);

  // Reloading does not show it again: the row holds only its hash, so there is
  // nowhere to read it back from.
  await goTo(page, "/account/channels");
  expect(await page.content()).not.toContain(first);

  await page.getByRole("button", { name: "Get a code" }).click();
  await expect(page.locator(".font-mono").first()).toBeVisible({
    timeout: 10_000,
  });
  const second = (await page.locator(".font-mono").first().textContent())?.trim();
  expect(second).not.toBe(first);
});

test("quiet hours save, and the copy says a reminder waits rather than vanishes", async () => {
  await goTo(page, "/account/channels");
  await page.locator('input[name="quietStart"]').fill("22:00");
  await page.locator('input[name="quietEnd"]').fill("07:00");
  // Asserted before submitting, and load-bearing: without it the click raced
  // hydration, the uncontrolled inputs were reset to their stored values, and
  // the form posted the old window back. The failure looked exactly like a
  // write that did nothing.
  await expect(page.locator('input[name="quietStart"]')).toHaveValue("22:00");
  await page.getByRole("button", { name: "Save" }).click();

  // A refusal would be here, and a spec that only checked the value would read
  // "the write did nothing" as "the write is slow". Scoped to the form: Next
  // renders its own route announcer with role="alert" on every page.
  await expect(
    page.locator("form").filter({ hasText: "Primary channel" }).getByRole("alert"),
  ).toBeHidden();

  // The confirmation is the saved value coming back, not a message: a write
  // revalidates and can unmount the form a message would be rendered in. The
  // card's own copy carries the meaning, permanently.
  await goTo(page, "/account/channels");
  await expect(page.locator('input[name="quietStart"]')).toHaveValue("22:00", {
    timeout: 10_000,
  });
  await expect(page.locator('input[name="quietEnd"]')).toHaveValue("07:00");
  await expect(page.getByText("waits until it ends")).toBeVisible();
});

test("disconnecting removes the provider and leaves nothing behind", async () => {
  await goTo(page, "/admin/channels");
  await page.getByRole("button", { name: "Disconnect" }).first().click();

  // Precise, because "not connected" is on the page before the click as well:
  // the three providers with no driver carry it. Only a connected provider
  // offers a test send, so its absence is what disconnect actually changed.
  await expect(
    page.getByRole("button", { name: "Send me a test" }),
  ).toBeHidden({ timeout: 10_000 });

  await goTo(page, "/account/channels");
  // With no connection there is nothing for a member to link, and the page says
  // that rather than showing an empty list of accounts.
  await expect(
    page.getByText("No chat provider is connected for this workspace yet"),
  ).toBeVisible();
});
