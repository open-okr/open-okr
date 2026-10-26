/**
 * Recording a key result's value from the Work Map's side panel (S-01).
 *
 * **An empty box recorded 0.** The action read the box with `Number()`, and
 * `Number("")` is 0, so pressing Save on a cleared box wrote a real value of 0
 * into the key result's history. The box is now required, and the action asks
 * for a value rather than reading an empty one, which
 * `apps/web/test/work-map-actions.test.ts` proves without a browser. What only
 * a browser can show is the whole path: the panel records what was typed, and a
 * cleared box leaves the recorded value where it was.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const OBJECTIVE = "Make the Work Map record only what was typed";
const KEY_RESULT = "Readings recorded from the Work Map panel";

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

const panelValue = () => page.getByRole("textbox", { name: "Record a value" });
const panelForm = () => page.locator("form").filter({ has: panelValue() });

async function openThePanel(): Promise<void> {
  await goTo(page, "/");
  await page
    .getByRole("link", { name: new RegExp(KEY_RESULT) })
    .first()
    .click();
  await expect(panelValue()).toBeVisible({ timeout: 15_000 });
}

test("an objective with a key result measured by hand", async () => {
  await signIn(page);
  await goTo(page, "/cycle?phase=4");
  await page.getByLabel("The objective").first().fill(OBJECTIVE);
  await page.getByRole("button", { name: "Add objective" }).first().click();
  await expect(
    page.getByRole("heading", { level: 2, name: OBJECTIVE }),
  ).toBeVisible({ timeout: 15_000 });

  const form = page.getByRole("form", {
    name: `Add a key result to ${OBJECTIVE}`,
  });
  await form.getByRole("textbox", { name: "The key result" }).fill(KEY_RESULT);
  await form.getByRole("textbox", { name: "Baseline" }).fill("0");
  await form.getByRole("textbox", { name: "Target" }).fill("10");
  await form.getByRole("button", { name: "Add key result" }).click();
  await expect(page.getByText(KEY_RESULT, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test("the panel records the value that was typed", async () => {
  await openThePanel();
  // Retried, because a fill that lands before hydration is undone by it.
  await expect(async () => {
    await panelValue().fill("4");
    await expect(panelValue()).toHaveValue("4", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await panelForm().getByRole("button", { name: "Save" }).click();
  await expect(panelForm().getByRole("alert")).toBeHidden();

  // Retried, because a page opened while the write is still in flight can be
  // drawn from the value before it, as `s36-channels` found.
  await expect(async () => {
    await openThePanel();
    await expect(panelValue()).toHaveValue("4", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
});

test("a cleared box records nothing, and the value stays", async () => {
  await openThePanel();
  await expect(panelValue()).toHaveAttribute("required", "");
  await expect(async () => {
    await panelValue().fill("");
    await expect(panelValue()).toHaveValue("", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await panelForm().getByRole("button", { name: "Save" }).click();

  // The browser refuses an empty required box before anything is sent.
  expect(
    await panelValue().evaluate(
      (input) => (input as HTMLInputElement).validity.valueMissing,
    ),
  ).toBe(true);

  await openThePanel();
  await expect(panelValue()).toHaveValue("4", { timeout: 10_000 });
});
