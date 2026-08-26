/**
 * The copilot panel — P4-T14a-b (screen S-39, AI-NATIVE-PLAN.md §2.4).
 *
 * Acceptance criterion:
 *   Given a member stopping an answer halfway, when they reopen the thread,
 *   then what had arrived is there, marked as stopped, and the conversation
 *   can continue.
 *
 * **The stop control is not what this file can prove, and saying so is the
 * point.** This instance has no AI provider, so there is no stream to stop:
 * `streamGrounded` is absent, the panel never shows a stop control, and there
 * is nothing to interrupt. The stop path is proved in
 * `packages/core/test/copilot-stream.test.ts`, both ways a reader can stop one,
 * against a scripted provider. What this file proves is the state every
 * self-hosted instance without a key actually runs in, which is the one a
 * browser can reach here: the panel opens, says why it cannot write prose, still
 * records the question, and the conversation reads back.
 *
 * **The file name carries the run order, and has to.** Specs run alphabetically
 * against one instance, and `registration-to-dashboard.spec.ts` is the spec that
 * claims it: its first test is the registration path, so anything that registers
 * before it turns that test red. This file was `copilot.spec.ts` for one run and
 * did exactly that. `s39` is screen S-39, and it sorts after `registration-`.
 *
 * There is a second reason a live answer is out of reach in a browser today, and
 * it is worth writing down rather than discovering later: **nothing consumes the
 * `content.embed` outbox topic in a running instance.** No relay host exists yet
 * (nothing constructs `OutboxRelay` anywhere), so no goal is indexed, so
 * retrieval finds nothing to cite even with a key configured. That is a gap in
 * the product, not in this spec.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const QUESTION = "How is mid-market activation going this quarter?";

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

test("the topbar offers the copilot with its shortcut", async () => {
  const ask = page.getByRole("button", { name: "Ask the copilot" });
  await expect(ask).toBeVisible();
  // The slot in `Topbar` was deliberately left empty until S-39 existed. This
  // is the assertion that it no longer is.
  await expect(ask).toContainText("⌘J");
});

test("⌘J opens the panel, and it says the copilot cannot write prose", async () => {
  await page.keyboard.press("ControlOrMeta+j");

  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();
  // The AI-off state, which is a working panel and not an error.
  await expect(panel.getByText("AI off")).toBeVisible();
  await expect(
    panel.getByText("Ask about this workspace's goals", { exact: false }),
  ).toBeVisible();
  // The box still invites a question, and its placeholder says what asking will
  // actually do here: search, not answer.
  await expect(panel.getByPlaceholder("Search your workspace")).toBeVisible();
});

test("⌘J closes it again", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeHidden();
});

test("a question is recorded and answered with what is there to find", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();

  await panel.getByPlaceholder("Search your workspace").fill(QUESTION);
  await panel.getByRole("button", { name: "Send the question" }).click();

  // The question is a turn in the thread, straight away and then again from the
  // server once the request lands.
  await expect(panel.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
  // And the panel explains itself rather than sitting silent: no provider, so
  // no prose, and it says which.
  await expect(
    panel.getByText("No AI provider is configured", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
});

test("the conversation is there when the panel is reopened", async () => {
  // Closed and reopened rather than reloaded, because that is the path a reader
  // takes: the panel re-reads its threads on every open.
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();

  // The thread's title is the question, shortened. A fresh panel opens empty
  // with the earlier conversations listed, which is where it is.
  await expect(panel.getByText("Earlier conversations")).toBeVisible({
    timeout: 15_000,
  });
  const earlier = panel.getByRole("button", {
    name: QUESTION.slice(0, 40),
    exact: false,
  });
  await expect(earlier.first()).toBeVisible();

  await earlier.first().click();
  await expect(panel.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
});

/**
 * **A bug found here and deliberately not fixed here.** The next assertion was
 * going to be that the `?` overlay lists the copilot, because a shortcut nobody
 * can discover is half a feature. It cannot be written: `ShortcutOverlay`
 * registers `{ key: "?" }` with no `shift`, and `useKeyboardShortcut` reads a
 * missing `shift` as "shift must not be held". On a keyboard where `?` is a
 * shifted key, which is most of them, the overlay's own shortcut can never fire.
 *
 * That belongs to P2-T10's component and not to this task, so it is recorded on
 * the P4-T14a-b row rather than changed under cover of a copilot task. The
 * copilot's own registration is asserted the only other way available: the
 * shortcut itself works, which the tests above prove.
 */
test("⌘J still works after a reload, so the shortcut is really registered", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeVisible();
});
