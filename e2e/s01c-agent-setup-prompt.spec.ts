/**
 * The agent setup prompt (docs/design/agent-setup-prompt.md §6).
 *
 * Acceptance criteria:
 *   Given a member on the Work Map with no dismissal stored, when they click
 *   the pill, then the clipboard holds the OAuth prompt with this instance's
 *   endpoint and no token.
 *   Given a member closed the pill, when they reload in the same login
 *   session, then it is not shown; when they sign out and in again, it is.
 *   Given a member mints an agent token, when they click the copy button in
 *   the answer, then the clipboard holds the line with that token in it.
 *   Given no session, when the instructions the line names are fetched, then
 *   they answer 200 as Markdown and hold no token (§9).
 *
 * A spec because the claim is about the browser: the clipboard, the storage
 * the dismissal lives in, and a real sign-out. What the prompt says is proved
 * in `apps/web/test/agent-setup-prompt.test.ts`.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
const pill = () => page.getByTestId("agent-setup-pill");

test("the Work Map pill copies the OAuth prompt", async () => {
  await signIn(page);
  await goTo(page, "/");
  await expect(pill()).toBeVisible({ timeout: 10_000 });

  await pill()
    .getByRole("button", { name: /Connect your AI agent/ })
    .click();
  await expect(pill().getByRole("status")).toHaveText("Copied");

  // §9.1: one line, the way Cloudflare's agent setup reads.
  const prompt = await clipboard();
  expect(prompt).toMatch(
    /^Fetch and execute the appropriate instructions to set me up for .+ from https?:\/\/\S+\/agent-setup\/prompt\.md$/,
  );
});

test("the instructions it names answer without a session", async ({
  browser,
}) => {
  // §9.2: the agent fetching them has no cookie, so a fresh context.
  const prompt = await clipboard();
  const address = prompt.slice(prompt.lastIndexOf(" ") + 1);
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(address, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/markdown");
  const body = await response.text();
  expect(body).toContain("/api/mcp");
  expect(body).toContain("claude mcp add --transport http openokr");
  expect(body).not.toMatch(/Bearer (?!<token>)/);
  await anonymous.close();
});

test("closing it holds for the login session", async () => {
  await pill().getByRole("button", { name: "Hide for this session" }).click();
  await expect(pill()).toHaveCount(0);

  await page.reload();
  await page.waitForLoadState("load");
  await expect(
    page.getByRole("heading", { level: 1 }).first(),
  ).toBeVisible();
  await expect(pill()).toHaveCount(0);
});

test("a new sign-in brings it back", async () => {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page);
  await goTo(page, "/");
  await expect(pill()).toBeVisible({ timeout: 10_000 });
});

test("the tokens screen copies the OAuth prompt", async () => {
  await goTo(page, "/account/api-tokens");
  await page
    .getByRole("button", { name: "Copy setup prompt", exact: true })
    .click();
  const prompt = await clipboard();
  expect(prompt).toContain("/agent-setup/prompt.md");
  expect(prompt).not.toContain("token");
});

test("a minted agent token comes with a prompt that carries it", async () => {
  await page.getByLabel("Name").fill("Setup prompt e2e");
  await page.getByRole("radio", { name: /An AI agent/ }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  const token = ((await shown.textContent()) ?? "").trim();

  await page
    .getByRole("button", { name: "Copy setup prompt with this token" })
    .click();
  const prompt = await clipboard();
  expect(prompt).toContain("/agent-setup/prompt.md");
  expect(prompt).toContain(`: ${token}`);
});

test("a REST token gets no setup prompt", async () => {
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Setup prompt REST e2e");
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByTestId("minted-token")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", { name: "Copy setup prompt with this token" }),
  ).toHaveCount(0);
});
