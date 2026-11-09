/**
 * An edit made from a stale read is not saved over somebody else's
 * (docs/design/optimistic-concurrency.md §3, plan 0.7.0 D3).
 *
 * Acceptance criterion, on the space's own manage card:
 *   Given two people with a space open, when both change its name, then the
 *   second save answers with the first one's name and who changed it, and
 *   the screen offers keep mine or take theirs.
 *
 * The other person is a call through the API, made after the page has read
 * the name, so the page is holding exactly the stale read the comparison
 * exists for. The comparison itself, on all six update actions, is proved
 * against the database in `packages/core/test/optimistic-concurrency.test.ts`;
 * what only a browser proves is that the card sends what it read, shows the
 * conflict, and that each way out does what it says.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const SPACE = `Customer Success ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let spaceId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

/** Somebody else renames the space, from the name they read. */
async function renameElsewhere(from: string, to: string): Promise<void> {
  const response = await api.post("/api/v1/spaces/update", {
    headers: authed(),
    data: { id: spaceId, name: to, read: { name: from } },
  });
  expect(response.status(), "the other rename answered").toBe(200);
}

/** The name as it is stored, read through the API. */
async function storedName(): Promise<string> {
  const response = await api.get(`/api/v1/spaces/read?id=${spaceId}`, {
    headers: authed(),
  });
  return (await response.json()).data.name;
}

/** The manage card's form: the one on the page that carries what it read. */
const manage = () => page.locator("form:has(input[name='read'])");
const nameField = () => manage().locator("input[name='name']");

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token && spaceId) {
    await api.post("/api/v1/spaces/archive", {
      headers: authed(),
      data: { id: spaceId },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with a space of its own", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Edit conflict e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const response = await api.post("/api/v1/spaces/create", {
    headers: authed(),
    data: { name: SPACE },
  });
  expect(response.status()).toBe(200);
  spaceId = (await response.json()).data.id;
});

test("take theirs: a name changed since the page read it is not overwritten", async () => {
  await goTo(page, `/spaces/${spaceId}`);
  await expect(nameField()).toHaveValue(SPACE, { timeout: 15_000 });

  const theirs = `Customer Care ${STAMP}`;
  await renameElsewhere(SPACE, theirs);

  await nameField().fill(`Support ${STAMP}`);
  await manage().getByRole("button", { name: "Save", exact: true }).click();

  const conflict = manage().getByTestId("conflict");
  await expect(conflict).toContainText(theirs, { timeout: 15_000 });
  await expect(conflict).toContainText(`You had "Support ${STAMP}"`);
  expect(await storedName()).toBe(theirs);

  await conflict.getByRole("button", { name: "Take theirs" }).click();
  await expect(conflict).toHaveCount(0);
  await expect(nameField()).toHaveValue(theirs, { timeout: 15_000 });
  expect(await storedName()).toBe(theirs);
});

test("keep mine: the same edit, sent again, is saved over theirs", async () => {
  const before = `Customer Care ${STAMP}`;
  const theirs = `Customer Experience ${STAMP}`;
  const mine = `Support ${STAMP}`;
  await expect(nameField()).toHaveValue(before, { timeout: 15_000 });
  await renameElsewhere(before, theirs);

  await nameField().fill(mine);
  await manage().getByRole("button", { name: "Save", exact: true }).click();
  const conflict = manage().getByTestId("conflict");
  await expect(conflict).toContainText(theirs, { timeout: 15_000 });

  await conflict.getByRole("button", { name: "Keep mine" }).click();
  await expect(conflict).toHaveCount(0);
  await expect.poll(storedName, { timeout: 15_000 }).toBe(mine);
  await expect(nameField()).toHaveValue(mine, { timeout: 15_000 });
});

test("a field nobody else touched still saves", async () => {
  const mine = `Support ${STAMP}`;
  // Somebody renames it; this page then changes only the mission it read.
  const theirs = `Support and Success ${STAMP}`;
  await renameElsewhere(mine, theirs);

  const mission = "Every question answered the same day";
  await manage().locator("textarea[name='mission']").fill(mission);
  await manage().getByRole("button", { name: "Save", exact: true }).click();

  await expect
    .poll(
      async () =>
        (
          await (
            await api.get(`/api/v1/spaces/read?id=${spaceId}`, {
              headers: authed(),
            })
          ).json()
        ).data.mission,
      { timeout: 15_000 },
    )
    .toBe(mission);
  await expect(manage().getByTestId("conflict")).toHaveCount(0);
  expect(await storedName()).toBe(theirs);
});
