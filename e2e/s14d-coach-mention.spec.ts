/**
 * Mention the Coach on a goal and it reviews the goal and replies in the
 * thread (plan 0.7.0 A8, AI-NATIVE-PLAN §6.5 "Conversation").
 *
 * Acceptance criterion:
 *   Given a goal whose objective starts with a deliverable, when a member
 *   mentions the OKR Coach in a comment on it, then the relay has the Coach
 *   reply in the same thread with METHOD.md's quality checks, each point
 *   citing its rule, and with no AI provider configured.
 *
 * **This instance has no AI provider, and that is the path proved here.** The
 * review is deterministic; what only a running server shows is that the `@`
 * offers the Coach, and that nothing but the relay posts the answer.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let goalId = "";

/** Unique per run, so a second run on the same database finds its own goal. */
const TITLE = `Launch the coach review page ${Math.random().toString(36).slice(2, 8)}`;
const REVIEWED = "Reviewed against the quality checks in METHOD.md";

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(path: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${path}`, {
    headers: { ...authed(), connection: "close" },
    data,
  });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
  return (await response.json()).data as T;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token && goalId) {
    await api.post("/api/v1/goals/delete", {
      headers: authed(),
      data: { id: goalId },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("a goal whose objective names a deliverable", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Coach mention e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  // Deleting the goal afterwards is destructive.
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const current = await api.get("/api/v1/cycles/current?mode=quarterly", {
    headers: authed(),
  });
  const cycleId = (await current.json()).data.id as string;
  goalId = (
    await post<{ id: string }>("goals/create", {
      title: TITLE,
      cycleId,
      level: "company",
    })
  ).id;
  await post("goals/addKeyResult", {
    goalId,
    title: "Teams finishing onboarding alone",
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 20,
    targetValue: 60,
  });
});

test("mentioning the Coach in the goal's thread gets its review back in that thread", async () => {
  await goTo(page, `/goals/${goalId}`);
  const thread = page.getByTestId("comment-thread");
  await expect(thread).toBeVisible({ timeout: 15_000 });

  const composer = thread.getByRole("textbox", { name: "Your comment" });
  await composer.click();
  // One word: the editor ends a mention's search at a space.
  await composer.pressSequentially("@Coach");
  // The `@` offers the Coach now that it answers (and never the Champion).
  await page.getByRole("button", { name: "OKR Coach" }).click();
  await composer.pressSequentially(" could you review this?");
  await thread.getByRole("button", { name: "Post" }).click();
  await expect(
    thread
      .locator('[id^="comment-"]')
      .filter({ hasText: "could you review this?" }),
  ).toBeVisible({ timeout: 15_000 });

  // The relay answers after the comment commits, so the page is read again
  // until the reply is there.
  await expect(async () => {
    await goTo(page, `/goals/${goalId}`);
    await expect(
      page
        .getByTestId("comment-thread")
        .locator('[id^="comment-"]')
        .filter({ hasText: REVIEWED }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  const reply = page
    .getByTestId("comment-thread")
    .locator('[id^="comment-"]')
    .filter({ hasText: REVIEWED });
  await expect(reply).toContainText("OKR Coach");
  // The objective starts with a deliverable, and the point cites its rule.
  await expect(reply).toContainText("OBJ-1 Outcome, not output");
  await expect(reply).toContainText("Rule: OBJ-1");
});
