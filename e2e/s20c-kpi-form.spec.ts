/**
 * The KPI form (P9-T17b-b, METHOD.md §6.2, §6.4).
 *
 * Acceptance:
 *   Given a new KPI with no thresholds, when its form is read, then it says
 *   the ratio does not suit uptime, ratings, NPS or anything that can be
 *   negative.
 *
 * And the form sets everything P9-T17a stores: a range with its band and red
 * boundary, the named owner, no tier; then the KPI page changes the type.
 * KPIs cannot be deleted, so this one stays, with a stamped title.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const TITLE = `Platform uptime ${STAMP}`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let kpiId = "";

const authed = () => ({ authorization: `Bearer ${token}` });
const addForm = () =>
  page
    .locator("form")
    .filter({ has: page.getByLabel("What is being measured") });

async function detail() {
  const response = await api.get(
    `/api/v1/kpis/detail?kpiId=${kpiId}&periods=12`,
    { headers: authed() },
  );
  expect(response.status()).toBe(200);
  return (await response.json()).data.kpi as {
    targetType: string;
    greenLow: number | null;
    greenHigh: number | null;
    redLow: number | null;
    basis: string;
    tier: string | null;
    namedOwnerName: string | null;
  };
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

test("sign in", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("KPI form e2e");
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();
});

test("acceptance: a KPI with no thresholds is told what the ratio does not suit", async () => {
  await goTo(page, "/kpis");
  const note = addForm().getByTestId("kpi-fallback-note");
  await expect(note).toBeVisible({ timeout: 15_000 });
  await expect(note).toContainText(
    "It does not suit uptime, a rating, a net promoter score, or anything that can go negative",
  );
});

test("adds a range with its band and red boundary, owned by the person adding it", async () => {
  const form = addForm();
  await form.getByLabel("What is being measured").fill(TITLE);
  await form.getByLabel("Target", { exact: true }).selectOption("range");
  // A range asks for its band rather than one green value.
  await expect(form.getByTestId("kpi-fallback-note")).toContainText(
    "A range needs its band",
  );
  await form.getByLabel("Green from").fill("99.9");
  await form.getByLabel("to", { exact: true }).fill("100");
  await form.getByLabel("Red below").fill("99.5");
  await expect(form.getByTestId("kpi-fallback-note")).toHaveCount(0);
  await form.getByRole("button", { name: "Add", exact: true }).click();

  await expect
    .poll(
      async () => {
        const listed = await api.get("/api/v1/kpis/list", {
          headers: authed(),
        });
        const kpis = (await listed.json()).data.kpis as {
          id: string;
          title: string;
        }[];
        kpiId = kpis.find((kpi) => kpi.title === TITLE)?.id ?? "";
        return kpiId;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");
  const added = await detail();
  expect(added).toMatchObject({
    targetType: "range",
    greenLow: 99.9,
    greenHigh: 100,
    redLow: 99.5,
    basis: "thresholds",
    tier: null,
  });
  expect(added.namedOwnerName).not.toBeNull();
});

test("the KPI page changes how it is judged, and its tier", async () => {
  await goTo(page, `/kpis/${kpiId}`);
  await expect(page.getByTestId("kpi-basis")).toContainText(
    "By its green and red values",
    { timeout: 15_000 },
  );
  await page.getByLabel("Target", { exact: true }).selectOption("at_least");
  await page.getByLabel("Green at or above").fill("99.9");
  await page.getByLabel("Red below").fill("99.5");
  await page.getByLabel("Tier").selectOption("outcome");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect
    .poll(async () => (await detail()).targetType, { timeout: 15_000 })
    .toBe("at_least");
  expect(await detail()).toMatchObject({
    greenLow: 99.9,
    greenHigh: null,
    redLow: 99.5,
    tier: "outcome",
  });
});
