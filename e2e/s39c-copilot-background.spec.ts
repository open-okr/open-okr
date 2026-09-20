/**
 * A copilot run that survives the page that asked for it (P4-T14b-b).
 *
 * Acceptance criterion:
 *   Given a member asking for something that takes a minute, when they reload
 *   the page, then the run is still going and they rejoin it.
 *
 * **What a browser can prove here, and what it cannot.** This instance has no
 * AI provider, so a run halts as soon as it finds there is nothing to answer
 * with: there is no minute to reload in the middle of. What the browser can
 * prove is the half that actually matters and that no unit test can reach,
 * which is that the answer lands in a page the reader has thrown away. The
 * question is asked, the tab is reloaded before anything has come back, and
 * the conversation is reopened to find the run finished and its outcome
 * recorded. Before this row that message did not exist at all: the answer
 * lived inside the request, and reloading took it with it.
 *
 * The run itself, the budget halting before a token is spent, and a
 * redelivered row not charging twice are proved against a scripted provider in
 * `packages/core/test/copilot-background.test.ts`.
 *
 * **The file name carries the run order**, for the reason `s39-copilot.spec.ts`
 * writes out: specs run alphabetically against one instance and
 * `registration-to-dashboard.spec.ts` is what claims it.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const QUESTION = "Which goals are behind, and what is blocking them?";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and land on the Work Map", async () => {
  await signIn(page);

  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("a question is asked and the page is thrown away before anything returns", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();

  await panel.getByPlaceholder("Search your workspace").fill(QUESTION);
  await panel.getByRole("button", { name: "Send the question" }).click();

  // The question is on screen, which is the moment the write landed and the
  // run was enqueued with it.
  await expect(panel.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });

  // **And then the reader leaves.** No wait for an answer: the point is that
  // whatever the run does next, it does with nobody holding the request.
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState("networkidle");
});

test("the run finished anyway, and the conversation says so", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();

  await expect(panel.getByText("Earlier conversations")).toBeVisible({
    timeout: 15_000,
  });
  const earlier = panel.getByRole("button", {
    name: QUESTION.slice(0, 40),
    exact: false,
  });
  await expect(earlier.first()).toBeVisible();
  await earlier.first().click();

  // Wait for the list to go before looking at the conversation, for the reason
  // `s39-copilot.spec.ts` writes out: until then the only thing carrying this
  // text is the entry that was clicked.
  await expect(panel.getByText("Earlier conversations")).toBeHidden({
    timeout: 15_000,
  });
  await expect(panel.getByText(QUESTION)).toBeVisible();

  // **The answer the reader never waited for.** With no provider the run halts
  // and says why, which is the outcome this instance can produce; what matters
  // is that a run reached a conclusion and wrote it into a thread whose
  // request was abandoned several seconds earlier.
  await expect(
    panel.getByText("No AI provider is configured", { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });

  // And it is not still claiming to be writing. A run that halted and left the
  // chip up is a reader waiting for ever.
  await expect(panel.getByText("Still writing")).toBeHidden();
});
