/**
 * The evaluation set on the AI console (AI-NATIVE-PLAN §4 and §10, plan
 * 0.7.0 A9, docs/design/ai-evaluation.md §10).
 *
 * Acceptance criteria:
 *   Given AI is off, when an administrator opens the AI console, then the
 *   usage card shows each prompt's latest evaluation results.
 *   Given an administrator on S-37, when they save a version of "Objective
 *   drafting" that holds an email address, then it is refused with a message
 *   naming the personal-data check, and no version is stored.
 *   Given a version that passes, when it is saved, then it is stored as the
 *   next version and the usage card reads that version as passing.
 *
 * What the checks do is proved in `packages/agents/test/evaluation.test.ts`,
 * and the gate against a database in `packages/agents/test/prompt-gate.test.ts`.
 * What only a browser proves is that the form an administrator meets posts
 * the text, shows the refusal, and that the card reads what was saved.
 *
 * **No provider is configured on the end-to-end instance**, which is the
 * point of the first test: the evaluation runs against a stand-in model and
 * needs none. The prompt is put back to its built-in text in `afterAll`,
 * whatever happened in between, because the suite shares one workspace.
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const PROMPT = "Objective drafting";

let context: BrowserContext;
let page: Page;

/** The objective prompt's save form, not one of the console's other forms. */
const promptForm = (page: Page): Locator =>
  page.locator("form").filter({
    has: page.getByLabel(`System prompt for ${PROMPT}`),
  });

/** The usage card's line for the objective prompt. */
const resultLine = (page: Page): Locator =>
  page
    .getByRole("region", { name: "Latest evaluation results" })
    .getByRole("listitem")
    .filter({ hasText: PROMPT });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await goTo(page, "/admin/ai");
  // The restore form sits beside the save form, in the same prompt's row,
  // and only while that prompt has a stored version.
  const row = promptForm(page).locator("xpath=..");
  const restore = row.locator("form").filter({
    has: page.getByRole("button", { name: "Restore the built-in" }),
  });
  if ((await restore.count()) > 0) {
    await restore.getByRole("button", { name: "Restore the built-in" }).click();
    await expect(restore.getByRole("status")).toHaveText(
      "Back to the built-in prompt.",
      { timeout: 15_000 },
    );
  }
  await context?.close();
});

test("the usage card shows each prompt's latest evaluation results, with AI off", async () => {
  await goTo(page, "/admin/ai");
  const results = page.getByRole("region", {
    name: "Latest evaluation results",
  });
  await expect(results).toBeVisible();
  await expect(resultLine(page)).toContainText("built in");
  await expect(resultLine(page)).toContainText(/\d+ of \d+ examples pass/);
  await expect(
    results.getByRole("listitem").filter({
      hasText: "Rewriting for a failing rule",
    }),
  ).toContainText(/\d+ of \d+ examples pass/);
});

test("a version with an email address in it is refused by name, and nothing is stored", async () => {
  await goTo(page, "/admin/ai");
  const form = promptForm(page);
  const field = form.getByLabel(`System prompt for ${PROMPT}`);
  const builtIn = await field.inputValue();
  await field.fill(`${builtIn} Questions go to priya@northwind.example.`);
  await form.getByRole("button", { name: "Save a new version" }).click();

  await expect(form.getByRole("alert")).toContainText(
    "Not saved. This version fails",
    { timeout: 15_000 },
  );
  await expect(form.getByRole("alert")).toContainText("personal-data");

  await goTo(page, "/admin/ai");
  await expect(promptForm(page).getByLabel(`System prompt for ${PROMPT}`))
    .toHaveValue(builtIn);
  await expect(resultLine(page)).toContainText("built in");
});

test("a version that passes is saved, and the usage card reads it", async () => {
  await goTo(page, "/admin/ai");
  const form = promptForm(page);
  await form
    .getByLabel(`System prompt for ${PROMPT}`)
    .fill(
      "Draft one objective that names a change, with two or three measures. Use only numbers the writer gave.",
    );
  await form.getByRole("button", { name: "Save a new version" }).click();
  await expect(form.getByRole("status")).toHaveText(
    /^Saved as version \d+\.$/,
    { timeout: 15_000 },
  );

  await goTo(page, "/admin/ai");
  await expect(resultLine(page)).toContainText(/version \d+/);
  await expect(resultLine(page)).toContainText(/\d+ of \d+ examples pass/);
});
